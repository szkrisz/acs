/**
 * Warehouse Cooling Control System - Investor Demo
 * app.js - Main application logic
 * 
 * Architecture:
 *  - WarehouseScene   : Three.js 3D scene management
 *  - SensorSystem     : Sensor simulation & physics
 *  - ControlSystem    : Hatch/door/mode state management
 *  - AlertSystem      : Alert generation & display
 *  - ChartManager     : Chart.js integration
 *  - UIController     : DOM bindings & panel updates
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const WAREHOUSE = { W: 20, D: 10, H: 6.25 };
const NUM_HATCHES = 5;
const NUM_SENSORS = 8;
const UPDATE_INTERVAL_MS = 2500;
const CHART_HISTORY_POINTS = 40;

const SENSOR_COLORS_HEX = [
  '#00e5ff', '#00e676', '#ffab00', '#ff6d00',
  '#ea80fc', '#40c4ff', '#69f0ae', '#ff80ab'
];

const SENSOR_DEFS = [
  // [x, y, z, name, description]  — in Three.js coords (x along width, z along depth, y up)
  [ -8,  0.5,  3.5, 'S1', 'Near cooling wall – low'],
  [ -8,  2.5,  3.5, 'S2', 'Near cooling wall – high'],
  [  0,  0.8,  3.0, 'S3', 'Mid warehouse – box stack'],
  [  0,  2.0, -1.0, 'S4', 'Mid warehouse – aisle'],
  [  3,  0.8,  3.5, 'S5', 'Mid-far – box stack'],
  [  7,  0.5,  2.0, 'S6', 'Near door – low'],
  [  7,  2.5, -2.0, 'S7', 'Near door – high'],
  [ -3,  0.8, -3.5, 'S8', 'Side aisle – box stack'],
];

// Alert thresholds
const THRESH = {
  temp: { warn_hi: 8, crit_hi: 10, warn_lo: 0, crit_lo: -2 },
  hum:  { warn_hi: 98, crit_hi: 99, warn_lo: 80, crit_lo: 75 },
  door_warn_sec: 120,
};

// ─────────────────────────────────────────────────────────────────────────────
// SHARED STATE
// ─────────────────────────────────────────────────────────────────────────────
const state = {
  mode: 'auto',            // 'auto' | 'manual'
  setpointTemp: 4.0,       // °C
  setpointHum: 90.0,       // %
  hatches: Array(NUM_HATCHES).fill(50),  // 0–100%
  door: { open: false, openedAt: null },
  sensors: [],
  alerts: [],
  alertHistory: [],
  uptime: 0,
  heatmapVisible: false,
  selectedSensor: null,
  startTime: Date.now(),
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function rnd(lo, hi) { return lo + Math.random() * (hi - lo); }
function noise(amp) { return (Math.random() - 0.5) * 2 * amp; }

function fmtTemp(v) { return v.toFixed(1) + '°C'; }
function fmtHum(v)  { return v.toFixed(1) + '%'; }
function fmtTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function sensorStatusColor(s) {
  if (s.temp >= THRESH.temp.crit_hi || s.temp <= THRESH.temp.crit_lo ||
      s.hum  >= THRESH.hum.crit_hi  || s.hum  <= THRESH.hum.crit_lo) return '#ff1744';
  if (s.temp >= THRESH.temp.warn_hi || s.temp <= THRESH.temp.warn_lo ||
      s.hum  >= THRESH.hum.warn_hi  || s.hum  <= THRESH.hum.warn_lo) return '#ffab00';
  return '#00e676';
}

// ─────────────────────────────────────────────────────────────────────────────
// SENSOR SYSTEM
// ─────────────────────────────────────────────────────────────────────────────
const SensorSystem = (() => {
  function init() {
    state.sensors = SENSOR_DEFS.map(([x, y, z, id, desc], i) => ({
      id, desc, color: SENSOR_COLORS_HEX[i],
      x, y, z,
      temp: 4.0 + noise(0.3),
      hum: 90.0 + noise(1),
      prevTemp: null,
      stuckSince: null,
      malfunctioning: false,
    }));
  }

  // Compute target temperature for a sensor based on physics
  function targetTemp(sensor) {
    // Distance from cooling wall (x = -WAREHOUSE.W/2 = -10)
    const distFromCool = (sensor.x + WAREHOUSE.W / 2) / WAREHOUSE.W; // 0=at wall, 1=far end

    // Base cooling effect based on hatch openness
    const avgHatch = state.hatches.reduce((a, b) => a + b, 0) / NUM_HATCHES;
    const coolingPower = avgHatch / 100;    // 0–1

    // Cooling gradient: wall end = setpoint - offset, far end = setpoint + gradient
    const gradient = 3.5 * (1 - coolingPower * 0.5); // bigger gap when less cooling
    const wallTemp = state.setpointTemp - 1.5 * coolingPower;
    const farTemp  = wallTemp + gradient;
    let baseTemp = lerp(wallTemp, farTemp, distFromCool);

    // Height effect: higher sensors can be slightly warmer
    baseTemp += sensor.y * 0.15;

    // Door effect: sensors near door get warmer when it's open
    if (state.door.open) {
      const distFromDoor = 1 - (sensor.x - 0) / (WAREHOUSE.W / 2); // normalized
      const doorHeatEffect = Math.max(0, distFromDoor) * 4.0;
      baseTemp += doorHeatEffect;
    }

    return baseTemp;
  }

  function targetHum(sensor) {
    let base = state.setpointHum;
    // Slight variation by position
    base += noise(1);
    if (state.door.open) {
      // Opening door can bring in more humid air from outside or drier air
      const distFromDoor = (sensor.x + WAREHOUSE.W / 2) / WAREHOUSE.W;
      base += (1 - distFromDoor) * 3 * (Math.random() > 0.5 ? 1 : -1);
    }
    return clamp(base, 70, 100);
  }

  function update(dt) {
    const thermal_lag = 0.015; // how fast temp adjusts per tick

    state.sensors.forEach((s) => {
      // Occasional malfunction simulation (1% chance per update per sensor)
      if (!s.malfunctioning && Math.random() < 0.005) {
        s.malfunctioning = true;
        s.stuckSince = Date.now();
      }
      if (s.malfunctioning) {
        // Recover after 20–40 seconds
        if (Date.now() - s.stuckSince > rnd(20000, 40000)) {
          s.malfunctioning = false;
          s.stuckSince = null;
        } else {
          return; // frozen reading
        }
      }

      const tgt_t = targetTemp(s);
      const tgt_h = targetHum(s);

      // Apply thermal inertia + noise
      s.prevTemp = s.temp;
      s.temp = lerp(s.temp, tgt_t, thermal_lag) + noise(0.08);
      s.hum  = lerp(s.hum,  tgt_h, thermal_lag * 0.8) + noise(0.2);

      s.temp = clamp(s.temp, -5, 20);
      s.hum  = clamp(s.hum, 60, 100);
    });
  }

  return { init, update };
})();

// ─────────────────────────────────────────────────────────────────────────────
// AUTO CONTROL LOGIC
// ─────────────────────────────────────────────────────────────────────────────
function runAutoControl() {
  if (state.mode !== 'auto') return;
  const avgTemp = getAvgTemp();
  const error = avgTemp - state.setpointTemp;
  const adjustment = clamp(error * 8, -5, 5); // proportional

  state.hatches = state.hatches.map(h => clamp(h + adjustment, 0, 100));
}

function getAvgTemp() {
  return state.sensors.reduce((a, s) => a + s.temp, 0) / state.sensors.length;
}
function getAvgHum() {
  return state.sensors.reduce((a, s) => a + s.hum, 0) / state.sensors.length;
}
function getMinTemp() { return Math.min(...state.sensors.map(s => s.temp)); }
function getMaxTemp() { return Math.max(...state.sensors.map(s => s.temp)); }
function getMinHum()  { return Math.min(...state.sensors.map(s => s.hum)); }
function getMaxHum()  { return Math.max(...state.sensors.map(s => s.hum)); }

// ─────────────────────────────────────────────────────────────────────────────
// ALERT SYSTEM
// ─────────────────────────────────────────────────────────────────────────────
const AlertSystem = (() => {
  const seen = new Set();

  function key(type, id) { return `${type}:${id}`; }

  function raise(severity, msg, source) {
    const k = key(severity, msg);
    if (seen.has(k)) return;
    seen.add(k);

    const a = {
      severity,   // 'critical' | 'warning' | 'info'
      msg,
      source,
      time: new Date().toLocaleTimeString('en-GB'),
    };
    state.alerts.unshift(a);
    state.alertHistory.unshift(a);
    if (state.alerts.length > 20) state.alerts.pop();
    if (state.alertHistory.length > 50) state.alertHistory.pop();

    // Auto-clear key after some time so alert can re-trigger
    setTimeout(() => seen.delete(k), 30000);
    return true;
  }

  function clear(k) { seen.delete(k); }

  function evaluate() {
    const newAlerts = [];

    state.sensors.forEach(s => {
      // Temperature
      if (s.temp >= THRESH.temp.crit_hi)
        newAlerts.push(['critical', `${s.id}: Temp HIGH ${fmtTemp(s.temp)}`, s.id]);
      else if (s.temp <= THRESH.temp.crit_lo)
        newAlerts.push(['critical', `${s.id}: Temp TOO LOW ${fmtTemp(s.temp)}`, s.id]);
      else if (s.temp >= THRESH.temp.warn_hi)
        newAlerts.push(['warning', `${s.id}: Temp elevated ${fmtTemp(s.temp)}`, s.id]);
      else if (s.temp <= THRESH.temp.warn_lo)
        newAlerts.push(['warning', `${s.id}: Temp low ${fmtTemp(s.temp)}`, s.id]);

      // Humidity
      if (s.hum >= THRESH.hum.crit_hi)
        newAlerts.push(['critical', `${s.id}: Humidity critical HIGH ${fmtHum(s.hum)}`, s.id]);
      else if (s.hum <= THRESH.hum.crit_lo)
        newAlerts.push(['critical', `${s.id}: Humidity critical LOW ${fmtHum(s.hum)}`, s.id]);
      else if (s.hum >= THRESH.hum.warn_hi)
        newAlerts.push(['warning', `${s.id}: Humidity high ${fmtHum(s.hum)}`, s.id]);
      else if (s.hum <= THRESH.hum.warn_lo)
        newAlerts.push(['warning', `${s.id}: Humidity low ${fmtHum(s.hum)}`, s.id]);

      // Malfunction
      if (s.malfunctioning)
        newAlerts.push(['warning', `${s.id}: Sensor malfunction – frozen reading`, s.id]);
    });

    // Door open too long
    if (state.door.open && state.door.openedAt) {
      const sec = (Date.now() - state.door.openedAt) / 1000;
      if (sec > THRESH.door_warn_sec)
        newAlerts.push(['warning', `Loading door open ${Math.floor(sec)}s – heat ingress!`, 'DOOR']);
    }

    newAlerts.forEach(([sev, msg, src]) => raise(sev, msg, src));

    // Clear resolved alerts
    state.alerts = state.alerts.filter(a => {
      const stillActive = newAlerts.some(([, m]) => m === a.msg);
      return stillActive;
    });
  }

  return { evaluate, raise };
})();

// ─────────────────────────────────────────────────────────────────────────────
// THREE.JS SCENE
// ─────────────────────────────────────────────────────────────────────────────
const WarehouseScene = (() => {
  let renderer, scene, camera, controls;
  let sensorMeshes = [];
  let hatchMeshes = [];
  let hatchPivots = [];
  let doorMesh, doorPivot;
  let doorStatusLight = null;
  let heatmapPlanes = [];
  let ventParticles = null;
  let clock;

  const MAT = {};

  function buildMaterials() {
    MAT.floor = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
    MAT.wallConcrete = new THREE.MeshLambertMaterial({ color: 0x2a2e38 });
    MAT.wallCool = new THREE.MeshLambertMaterial({ color: 0x1a2a3a });
    MAT.ceiling = new THREE.MeshLambertMaterial({ color: 0x88aacc, transparent: true, opacity: 0.18, side: THREE.DoubleSide });
    MAT.wood = new THREE.MeshLambertMaterial({ color: 0x8b5e3c });
    MAT.woodDark = new THREE.MeshLambertMaterial({ color: 0x6b4423 });
    MAT.door = new THREE.MeshLambertMaterial({ color: 0x607d8b });
    MAT.doorFrame = new THREE.MeshLambertMaterial({ color: 0x455a64 });
    MAT.hatchOpen = new THREE.MeshLambertMaterial({ color: 0x0d2a40, transparent: true, opacity: 0.5 });
    MAT.hatchClosed = new THREE.MeshLambertMaterial({ color: 0x2a3a4a, transparent: true, opacity: 1.0 });
    MAT.ventGlow = new THREE.MeshBasicMaterial({ color: 0x00b0ff, transparent: true, opacity: 0.25 });
    MAT.wireframe = new THREE.MeshBasicMaterial({ color: 0x4a6a8a, wireframe: true });
  }

  function buildRoom() {
    const W = WAREHOUSE.W, D = WAREHOUSE.D, H = WAREHOUSE.H;

    // Floor
    const floorGeo = new THREE.BoxGeometry(W, 0.2, D);
    const floor = new THREE.Mesh(floorGeo, MAT.floor);
    floor.position.set(0, -0.1, 0);
    floor.receiveShadow = true;
    scene.add(floor);

    // Grid on floor
    const grid = new THREE.GridHelper(W, 20, 0x334455, 0x222233);
    grid.position.set(0, 0.01, 0);
    scene.add(grid);

    // Ceiling
    const ceilGeo = new THREE.BoxGeometry(W, 0.2, D);
    const ceil = new THREE.Mesh(ceilGeo, MAT.ceiling);
    ceil.position.set(0, H + 0.1, 0);
    scene.add(ceil);

    // Left wall (cooling wall) at x = -W/2
    buildCoolingWall(-W / 2, H, D);

    // Hatches on back/left long wall near roof
    buildHatches();

    // Right wall (door wall) at x = +W/2
    buildDoorWall(W / 2, H, D);

    // Back wall (z = -D/2)
    const backGeo = new THREE.BoxGeometry(W, H, 0.3);
    const back = new THREE.Mesh(backGeo, MAT.wallConcrete);
    back.position.set(0, H / 2, -D / 2 - 0.15);
    scene.add(back);

    // Front wall (z = +D/2) — partial walls with gap for visibility
    const frontLeft = new THREE.Mesh(new THREE.BoxGeometry(W * 0.35, H, 0.3), MAT.wallConcrete);
    frontLeft.position.set(-W * 0.325, H / 2, D / 2 + 0.15);
    scene.add(frontLeft);
    const frontRight = new THREE.Mesh(new THREE.BoxGeometry(W * 0.35, H, 0.3), MAT.wallConcrete);
    frontRight.position.set(W * 0.325, H / 2, D / 2 + 0.15);
    scene.add(frontRight);
  }

  function buildCoolingWall(x, H, D) {
    const wallGeo = new THREE.BoxGeometry(0.3, H, D);
    const wall = new THREE.Mesh(wallGeo, MAT.wallCool);
    wall.position.set(x - 0.15, H / 2, 0);
    scene.add(wall);

    // Glow strip at top
    const glowGeo = new THREE.BoxGeometry(0.05, H * 0.9, D * 0.9);
    const glowMesh = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
      color: 0x00b0ff, transparent: true, opacity: 0.08
    }));
    glowMesh.position.set(x + 0.05, H / 2, 0);
    scene.add(glowMesh);

    // Point light for cooling glow
    const coolLight = new THREE.PointLight(0x00a8ff, 1.2, 12);
    coolLight.position.set(x + 1, H * 0.6, 0);
    scene.add(coolLight);

    // Cooling vent holes arranged in a grid on the inner face of the end wall
    const ventRows = 3, ventCols = 5;
    const ventW = 0.5, ventH = 0.5;
    for (let r = 0; r < ventRows; r++) {
      for (let c = 0; c < ventCols; c++) {
        const vz = -D / 2 + (D / (ventCols + 1)) * (c + 1);
        const vy = 0.8 + r * (H * 0.28);

        // Dark rectangle simulating the vent opening
        const holeGeo = new THREE.BoxGeometry(0.06, ventH, ventW);
        const holeMat = new THREE.MeshBasicMaterial({ color: 0x000510 });
        const hole = new THREE.Mesh(holeGeo, holeMat);
        hole.position.set(x + 0.13, vy, vz);
        scene.add(hole);

        // Blue glow to indicate active cooling airflow
        const glowPlaneGeo = new THREE.PlaneGeometry(ventW * 0.8, ventH * 0.8);
        const glowPlaneMat = new THREE.MeshBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.45 });
        const glowPlane = new THREE.Mesh(glowPlaneGeo, glowPlaneMat);
        glowPlane.rotation.y = -Math.PI / 2;
        glowPlane.position.set(x + 0.15, vy, vz);
        scene.add(glowPlane);
      }
    }
  }

  function buildHatches() {
    const W = WAREHOUSE.W, D = WAREHOUSE.D, H = WAREHOUSE.H;
    const wallZ = -D / 2;         // back / left long-side wall
    const hatchW = 1.2;
    const hatchH = 0.9;
    // Spread hatches evenly across most of the wall length
    const usableW = W - 4;
    const spacing = usableW / (NUM_HATCHES - 1);
    const yTop = H - 0.2;         // near roof – hinge point
    const yCenter = yTop - hatchH / 2;

    for (let i = 0; i < NUM_HATCHES; i++) {
      const xPos = -W / 2 + 2 + spacing * i;

      // Hatch frame (mounted flush on the inner wall face)
      const frameGeo = new THREE.BoxGeometry(hatchW + 0.12, hatchH + 0.12, 0.08);
      const frame = new THREE.Mesh(frameGeo, new THREE.MeshLambertMaterial({ color: 0x2255aa }));
      frame.position.set(xPos, yCenter, wallZ + 0.12);
      scene.add(frame);

      // Vent glow visible through the opening when hatch is open
      const ventGeo = new THREE.PlaneGeometry(hatchW * 0.85, hatchH * 0.85);
      const vent = new THREE.Mesh(ventGeo, MAT.ventGlow.clone());
      vent.position.set(xPos, yCenter, wallZ + 0.06);
      scene.add(vent);

      // Pivot group at the top hinge of the hatch (inside face of wall)
      const pivot = new THREE.Group();
      pivot.position.set(xPos, yTop, wallZ + 0.16);
      scene.add(pivot);

      // Hatch panel hanging down from pivot
      const hatchGeo = new THREE.BoxGeometry(hatchW, hatchH, 0.07);
      const hatchMat = MAT.hatchClosed.clone();
      const hatch = new THREE.Mesh(hatchGeo, hatchMat);
      hatch.position.set(0, -hatchH / 2, 0);
      pivot.add(hatch);

      hatchPivots.push(pivot);
      hatchMeshes.push(hatch);
    }
  }

  function buildDoorWall(x, H, D) {
    const doorW = 3.5, doorH = 3.8;

    // Wall sections around door
    const sideW = (D - doorW) / 2;
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.3, H, sideW), MAT.wallConcrete);
    left.position.set(x + 0.15, H / 2, -(D - sideW) / 2);
    scene.add(left);
    const right = new THREE.Mesh(new THREE.BoxGeometry(0.3, H, sideW), MAT.wallConcrete);
    right.position.set(x + 0.15, H / 2, (D - sideW) / 2);
    scene.add(right);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.3, H - doorH, doorW), MAT.wallConcrete);
    top.position.set(x + 0.15, (H + doorH) / 2, 0);
    scene.add(top);

    // Door frame
    const frameGeo = new THREE.BoxGeometry(0.2, doorH + 0.2, doorW + 0.2);
    const doorFrame = new THREE.Mesh(frameGeo, MAT.doorFrame);
    doorFrame.position.set(x + 0.1, doorH / 2, 0);
    scene.add(doorFrame);

    // Door panel (with pivot for opening)
    doorPivot = new THREE.Group();
    doorPivot.position.set(x + 0.05, 0, -doorW / 2);
    scene.add(doorPivot);

    const doorGeo = new THREE.BoxGeometry(0.15, doorH, doorW);
    doorMesh = new THREE.Mesh(doorGeo, MAT.door);
    doorMesh.position.set(0, doorH / 2, doorW / 2);
    doorPivot.add(doorMesh);

    // Door status indicator light above the door frame (green = closed, orange = open)
    const statusGeo = new THREE.SphereGeometry(0.2, 12, 12);
    doorStatusLight = new THREE.Mesh(statusGeo, new THREE.MeshBasicMaterial({ color: 0x00ff44 }));
    doorStatusLight.position.set(x + 0.1, doorH + 0.55, 0);
    scene.add(doorStatusLight);

    const statusHaloGeo = new THREE.SphereGeometry(0.34, 12, 12);
    const statusHalo = new THREE.Mesh(statusHaloGeo, new THREE.MeshBasicMaterial({
      color: 0x00ff44, transparent: true, opacity: 0.22
    }));
    doorStatusLight.add(statusHalo);
  }

  function buildBoxStacks() {
    const BOX_W = 1.0, BOX_D = 1.0, BOX_H = 0.8;
    const STACK_H = 3;

    // Row Z positions (two rows with aisle in middle)
    const rowZ = [-3.5, -1.5, 1.5, 3.5];
    // Column X positions (along length, skipping ends for aisles)
    const colX = [-7.5, -5.5, -3.5, -1.5, 0.5, 2.5, 4.5];

    rowZ.forEach(z => {
      colX.forEach(x => {
        for (let h = 0; h < STACK_H; h++) {
          const geo = new THREE.BoxGeometry(BOX_W * 0.95, BOX_H * 0.95, BOX_D * 0.95);
          const mat = h % 2 === 0 ? MAT.wood : MAT.woodDark;
          const box = new THREE.Mesh(geo, mat);
          box.position.set(x, BOX_H * h + BOX_H / 2, z);
          box.castShadow = true;
          box.receiveShadow = true;
          scene.add(box);

          // Box edge lines for wood plank effect
          const edges = new THREE.EdgesGeometry(geo);
          const lineMat = new THREE.LineBasicMaterial({ color: 0x5a3a1a, transparent: true, opacity: 0.4 });
          const wireframe = new THREE.LineSegments(edges, lineMat);
          wireframe.position.copy(box.position);
          scene.add(wireframe);
        }
      });
    });
  }

  function buildSensorSpheres() {
    state.sensors.forEach((s, i) => {
      const geo = new THREE.SphereGeometry(0.15, 16, 16);
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(s.color) });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(s.x, s.y, s.z);
      mesh.userData = { sensorIdx: i };

      // Glow halo
      const haloGeo = new THREE.SphereGeometry(0.25, 16, 16);
      const haloMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(s.color),
        transparent: true, opacity: 0.15
      });
      const halo = new THREE.Mesh(haloGeo, haloMat);
      mesh.add(halo);

      scene.add(mesh);
      sensorMeshes.push(mesh);
    });
  }

  function buildHeatmapPlanes() {
    // Horizontal planes at different heights showing temperature gradient
    const levels = [0.3, 1.5, 3.0];
    levels.forEach(y => {
      const geo = new THREE.PlaneGeometry(WAREHOUSE.W, WAREHOUSE.D, 20, 10);
      const mat = new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0.35,
        side: THREE.DoubleSide,
        vertexColors: true,
      });
      const plane = new THREE.Mesh(geo, mat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(0, y, 0);
      plane.visible = false;
      scene.add(plane);
      heatmapPlanes.push(plane);
    });
  }

  function updateHeatmap() {
    heatmapPlanes.forEach(plane => {
      if (!plane.visible) return;
      const geo = plane.geometry;
      const positions = geo.attributes.position;
      const count = positions.count;
      const colors = new Float32Array(count * 3);

      for (let i = 0; i < count; i++) {
        const wx = positions.getX(i);   // local x on plane => global x
        const wz = positions.getY(i);   // local y on plane (after rotation) => global z

        // Estimate temp at this point from sensor interpolation
        let wSum = 0, tSum = 0;
        state.sensors.forEach(s => {
          const dx = wx - s.x, dz = wz - s.z;
          const dist2 = dx*dx + dz*dz + 0.1;
          const w = 1 / dist2;
          wSum += w;
          tSum += w * s.temp;
        });
        const t = tSum / wSum;

        // Map temp to color: 0°C=blue, 10°C=red
        const norm = clamp((t - 0) / 10, 0, 1);
        colors[i * 3 + 0] = norm;               // R
        colors[i * 3 + 1] = 0.1;                // G
        colors[i * 3 + 2] = 1 - norm;           // B
      }

      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.attributes.color.needsUpdate = true;
    });
  }

  function updateHatchVisuals() {
    hatchPivots.forEach((pivot, i) => {
      const pct = state.hatches[i] / 100;
      // Rotate the hatch flap: 0 = closed (flat against wall), π/2 = fully open (pointing into room)
      pivot.rotation.x = lerp(pivot.rotation.x, pct * (Math.PI / 2), 0.08);
      // Update hatch panel material
      const hatch = hatchMeshes[i];
      hatch.material.color.setHSL(0.58, 0.8, 0.1 + pct * 0.3);
      hatch.material.opacity = 1 - pct * 0.5;
    });
  }

  function updateDoorVisual() {
    if (!doorPivot) return;
    const targetAngle = state.door.open ? -Math.PI / 2 : 0;
    doorPivot.rotation.y = lerp(doorPivot.rotation.y, targetAngle, 0.05);

    // Update door status indicator: green = closed, orange = open
    if (doorStatusLight) {
      const isClosed = Math.abs(doorPivot.rotation.y) < 0.15;
      const color = isClosed ? 0x00ff44 : 0xff6600;
      doorStatusLight.material.color.setHex(color);
      if (doorStatusLight.children[0]) {
        doorStatusLight.children[0].material.color.setHex(color);
      }
    }
  }

  function updateSensorVisuals() {
    sensorMeshes.forEach((mesh, i) => {
      const s = state.sensors[i];
      const color = sensorStatusColor(s);
      mesh.material.color.set(color);
      mesh.children[0].material.color.set(color);

      // Pulse effect
      const t = Date.now() * 0.002;
      const pulse = 0.12 + Math.sin(t + i) * 0.04;
      mesh.children[0].scale.setScalar(pulse / 0.25 * 1.5);

      // Highlight selected
      const scale = (state.selectedSensor === i) ? 1.6 : 1;
      mesh.scale.setScalar(scale);
    });
  }

  function init(canvas) {
    clock = new THREE.Clock();

    // Renderer
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050810);
    scene.fog = new THREE.Fog(0x050810, 25, 55);

    // Camera
    camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
    camera.position.set(14, 8, 14);
    camera.lookAt(0, 2, 0);

    // Orbit controls
    controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 4;
    controls.maxDistance = 40;
    controls.maxPolarAngle = Math.PI / 2 + 0.1;
    controls.target.set(0, 2, 0);

    // Lights
    const ambient = new THREE.AmbientLight(0x1a2244, 1.5);
    scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xb0c8ff, 1.2);
    dirLight.position.set(5, 10, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(1024, 1024);
    scene.add(dirLight);

    // Ceiling fixtures
    for (let i = -6; i <= 6; i += 6) {
      const fl = new THREE.PointLight(0xaaccff, 0.4, 8);
      fl.position.set(i, WAREHOUSE.H - 0.5, 0);
      scene.add(fl);
    }

    buildMaterials();
    buildRoom();
    buildBoxStacks();
    buildSensorSpheres();
    buildHeatmapPlanes();

    // Resize handler
    resizeRenderer();
    window.addEventListener('resize', resizeRenderer);

    // Raycasting for sensor click
    canvas.addEventListener('click', onCanvasClick);
    canvas.addEventListener('mousemove', onCanvasHover);

    animate();
  }

  function resizeRenderer() {
    const container = renderer.domElement.parentElement;
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  function getMouseNDC(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function onCanvasClick(event) {
    getMouseNDC(event);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(sensorMeshes);
    if (hits.length > 0) {
      const idx = hits[0].object.userData.sensorIdx;
      state.selectedSensor = (state.selectedSensor === idx) ? null : idx;
      UIController.updateSensorList();
    }
  }

  function onCanvasHover(event) {
    getMouseNDC(event);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(sensorMeshes);
    const tooltip = document.getElementById('sensor-tooltip');

    if (hits.length > 0) {
      const idx = hits[0].object.userData.sensorIdx;
      const s = state.sensors[idx];
      tooltip.classList.add('visible');
      tooltip.style.left = (event.clientX + 14) + 'px';
      tooltip.style.top  = (event.clientY - 10) + 'px';
      tooltip.innerHTML = `
        <div class="tooltip-title">${s.id} – ${s.desc}</div>
        <div class="tooltip-row"><span>Temperature</span><span class="tooltip-val">${fmtTemp(s.temp)}</span></div>
        <div class="tooltip-row"><span>Humidity</span><span class="tooltip-val">${fmtHum(s.hum)}</span></div>
        <div class="tooltip-row"><span>Status</span><span class="tooltip-val" style="color:${sensorStatusColor(s)}">${getStatusText(s)}</span></div>
      `;
      renderer.domElement.style.cursor = 'pointer';
    } else {
      tooltip.classList.remove('visible');
      renderer.domElement.style.cursor = 'default';
    }
  }

  function getStatusText(s) {
    const c = sensorStatusColor(s);
    if (c === '#ff1744') return 'CRITICAL';
    if (c === '#ffab00') return 'WARNING';
    return 'NORMAL';
  }

  function toggleHeatmap(visible) {
    heatmapPlanes.forEach(p => { p.visible = visible; });
    if (visible) updateHeatmap();
  }

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    updateHatchVisuals();
    updateDoorVisual();
    updateSensorVisuals();
    if (state.heatmapVisible) updateHeatmap();
    renderer.render(scene, camera);
  }

  return { init, toggleHeatmap, resizeRenderer };
})();

// ─────────────────────────────────────────────────────────────────────────────
// CHART MANAGER
// ─────────────────────────────────────────────────────────────────────────────
const ChartManager = (() => {
  let tempChart, humChart;
  const history = { labels: [], datasets: [] };

  const CHART_DEFAULTS = {
    type: 'line',
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 0 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(10,14,26,0.9)',
          titleColor: '#e8edf5',
          bodyColor: '#8899bb',
          borderColor: '#2a3a5c',
          borderWidth: 1,
        }
      },
      scales: {
        x: {
          ticks: { color: '#5a6a88', font: { size: 9 }, maxTicksLimit: 5 },
          grid: { color: '#1a2035' },
        },
        y: {
          ticks: { color: '#5a6a88', font: { size: 9 } },
          grid: { color: '#1a2035' },
        }
      },
    }
  };

  function initCharts() {
    // Temperature chart
    tempChart = new Chart(document.getElementById('temp-chart'), {
      ...CHART_DEFAULTS,
      data: {
        labels: [],
        datasets: SENSOR_DEFS.map(([,,, id], i) => ({
          label: id,
          data: [],
          borderColor: SENSOR_COLORS_HEX[i],
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.4,
        }))
      },
      options: {
        ...CHART_DEFAULTS.options,
        scales: {
          ...CHART_DEFAULTS.options.scales,
          y: {
            ...CHART_DEFAULTS.options.scales.y,
            title: { display: true, text: '°C', color: '#5a6a88', font: { size: 9 } },
            min: -2, max: 14,
          }
        }
      }
    });

    // Humidity chart
    humChart = new Chart(document.getElementById('hum-chart'), {
      ...CHART_DEFAULTS,
      data: {
        labels: [],
        datasets: SENSOR_DEFS.map(([,,, id], i) => ({
          label: id,
          data: [],
          borderColor: SENSOR_COLORS_HEX[i],
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.4,
        }))
      },
      options: {
        ...CHART_DEFAULTS.options,
        scales: {
          ...CHART_DEFAULTS.options.scales,
          y: {
            ...CHART_DEFAULTS.options.scales.y,
            title: { display: true, text: '%', color: '#5a6a88', font: { size: 9 } },
            min: 70, max: 100,
          }
        }
      }
    });
  }

  function update() {
    const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    [tempChart, humChart].forEach((chart, ci) => {
      chart.data.labels.push(now);
      if (chart.data.labels.length > CHART_HISTORY_POINTS) chart.data.labels.shift();

      state.sensors.forEach((s, i) => {
        const val = ci === 0 ? s.temp : s.hum;
        chart.data.datasets[i].data.push(parseFloat(val.toFixed(2)));
        if (chart.data.datasets[i].data.length > CHART_HISTORY_POINTS) {
          chart.data.datasets[i].data.shift();
        }
      });

      chart.update('none');
    });
  }

  return { initCharts, update };
})();

// ─────────────────────────────────────────────────────────────────────────────
// GAUGE RENDERER
// ─────────────────────────────────────────────────────────────────────────────
function updateGauge(temp) {
  const svg = document.getElementById('gauge-svg');
  const needle = document.getElementById('gauge-needle');
  const gaugeTempVal = document.getElementById('gauge-temp-val');

  if (!svg || !needle || !gaugeTempVal) return;

  // Gauge goes from -2°C to 12°C (full sweep = 180°)
  const min = -2, max = 12;
  const norm = clamp((temp - min) / (max - min), 0, 1);
  const angle = -180 + norm * 180; // -180 to 0 degrees (left to right)

  needle.setAttribute('transform', `rotate(${angle}, 60, 60)`);
  gaugeTempVal.textContent = fmtTemp(temp);

  // Color the gauge value
  const color = temp >= THRESH.temp.warn_hi ? '#ff1744' :
                temp >= THRESH.temp.warn_lo + 2 ? '#ffab00' : '#00e676';
  gaugeTempVal.style.color = color;
}

// ─────────────────────────────────────────────────────────────────────────────
// UI CONTROLLER
// ─────────────────────────────────────────────────────────────────────────────
const UIController = (() => {

  function init() {
    // Mode buttons
    document.getElementById('btn-auto').addEventListener('click', () => setMode('auto'));
    document.getElementById('btn-manual').addEventListener('click', () => setMode('manual'));

    // Setpoint sliders
    document.getElementById('slider-temp').addEventListener('input', e => {
      state.setpointTemp = parseFloat(e.target.value);
      document.getElementById('val-setpoint-temp').textContent = fmtTemp(state.setpointTemp);
    });

    document.getElementById('slider-hum').addEventListener('input', e => {
      state.setpointHum = parseFloat(e.target.value);
      document.getElementById('val-setpoint-hum').textContent = fmtHum(state.setpointHum);
    });

    // Door button
    document.getElementById('btn-door').addEventListener('click', toggleDoor);

    // Heatmap button
    document.getElementById('btn-heatmap').addEventListener('click', toggleHeatmap);

    // Build hatch controls
    buildHatchControls();

    // Initial update
    updateAll();
  }

  function setMode(mode) {
    state.mode = mode;
    document.getElementById('btn-auto').classList.toggle('active', mode === 'auto');
    document.getElementById('btn-manual').classList.toggle('active', mode === 'manual');
    document.getElementById('btn-manual').classList.toggle('manual-active', mode === 'manual');

    // Update 3D overlay tag
    const tag = document.getElementById('canvas-mode-tag');
    if (tag) tag.textContent = `Mode: ${mode.toUpperCase()}`;

    // Enable/disable hatch sliders
    document.querySelectorAll('.hatch-slider').forEach(sl => {
      sl.disabled = (mode === 'auto');
    });
  }

  function buildHatchControls() {
    const container = document.getElementById('hatch-controls');
    container.innerHTML = '';

    state.hatches.forEach((pct, i) => {
      const div = document.createElement('div');
      div.className = 'hatch-item';
      div.id = `hatch-item-${i}`;
      div.innerHTML = `
        <div class="hatch-header">
          <span class="hatch-name">Hatch H${i + 1}</span>
          <span class="hatch-pct" id="hatch-pct-${i}">${pct}%</span>
        </div>
        <div class="hatch-bar-bg">
          <div class="hatch-bar-fill" id="hatch-bar-${i}" style="width:${pct}%"></div>
        </div>
        <input type="range" class="hatch-slider" id="hatch-slider-${i}"
          min="0" max="100" value="${pct}" disabled>
      `;
      container.appendChild(div);

      document.getElementById(`hatch-slider-${i}`).addEventListener('input', e => {
        state.hatches[i] = parseInt(e.target.value);
        updateHatchUI(i);
      });
    });
  }

  function updateHatchUI(i) {
    const pct = Math.round(state.hatches[i]);
    const el = document.getElementById(`hatch-pct-${i}`);
    const bar = document.getElementById(`hatch-bar-${i}`);
    const slider = document.getElementById(`hatch-slider-${i}`);
    if (el) el.textContent = pct + '%';
    if (bar) bar.style.width = pct + '%';
    if (slider) slider.value = pct;
  }

  function toggleDoor() {
    state.door.open = !state.door.open;
    state.door.openedAt = state.door.open ? Date.now() : null;
    updateDoorUI();
  }

  function updateDoorUI() {
    const btn = document.getElementById('btn-door');
    const status = document.getElementById('door-status-text');
    if (state.door.open) {
      btn.textContent = '🔓 CLOSE DOOR';
      btn.className = 'door-btn door-open';
      status.textContent = 'OPEN';
      status.style.color = '#ffab00';
    } else {
      btn.textContent = '🔒 OPEN DOOR';
      btn.className = 'door-btn door-closed';
      status.textContent = 'CLOSED';
      status.style.color = '#00e676';
    }

    const timerEl = document.getElementById('door-timer');
    if (state.door.open && state.door.openedAt) {
      const sec = Math.floor((Date.now() - state.door.openedAt) / 1000);
      timerEl.textContent = `Open ${sec}s`;
      timerEl.style.color = sec > THRESH.door_warn_sec ? '#ff1744' : '#ffab00';
    } else {
      timerEl.textContent = '';
    }
  }

  function toggleHeatmap() {
    state.heatmapVisible = !state.heatmapVisible;
    WarehouseScene.toggleHeatmap(state.heatmapVisible);
    const btn = document.getElementById('btn-heatmap');
    btn.classList.toggle('active', state.heatmapVisible);
    btn.textContent = state.heatmapVisible ? '🌡 HIDE HEAT MAP' : '🌡 SHOW HEAT MAP';
  }

  function updateSensorList() {
    const container = document.getElementById('sensor-list');
    container.innerHTML = '';

    state.sensors.forEach((s, i) => {
      const div = document.createElement('div');
      div.className = `sensor-item${state.selectedSensor === i ? ' selected' : ''}`;
      div.onclick = () => {
        state.selectedSensor = (state.selectedSensor === i) ? null : i;
        updateSensorList();
      };

      const statusColor = sensorStatusColor(s);
      div.innerHTML = `
        <div class="sensor-dot" style="background:${s.color};color:${s.color}"></div>
        <span class="sensor-id">${s.id}</span>
        <div class="sensor-readings">
          <span class="sensor-temp" style="color:${tempColor(s.temp)}">${fmtTemp(s.temp)}</span>
          <span class="sensor-hum">${fmtHum(s.hum)}</span>
        </div>
        <div class="sensor-status-dot" style="background:${statusColor};box-shadow:0 0 5px ${statusColor}"></div>
      `;
      container.appendChild(div);
    });
  }

  function tempColor(t) {
    if (t >= THRESH.temp.warn_hi) return '#ff1744';
    if (t >= THRESH.temp.warn_hi - 2) return '#ffab00';
    if (t <= THRESH.temp.warn_lo) return '#00b0ff';
    return '#00e5ff';
  }

  function updateStats() {
    const avg_t = getAvgTemp();
    const avg_h = getAvgHum();
    const min_t = getMinTemp();
    const max_t = getMaxTemp();
    const min_h = getMinHum();
    const max_h = getMaxHum();

    setText('stat-avg-temp', fmtTemp(avg_t));
    setText('stat-avg-hum',  fmtHum(avg_h));
    setText('stat-min-temp', fmtTemp(min_t));
    setText('stat-max-temp', fmtTemp(max_t));
    setText('stat-min-hum',  fmtHum(min_h));
    setText('stat-max-hum',  fmtHum(max_h));
    setText('stat-alert-count', state.alerts.length.toString());
    setText('val-avg-temp-display', fmtTemp(avg_t));
    setText('val-avg-hum-display',  fmtHum(avg_h));

    // Uptime
    state.uptime = Math.floor((Date.now() - state.startTime) / 1000);
    setText('uptime-display', fmtTime(state.uptime));

    updateGauge(avg_t);
  }

  function updateAlertPanel() {
    const container = document.getElementById('alert-list');
    const badge = document.getElementById('alert-badge');

    if (state.alerts.length === 0) {
      container.innerHTML = '<div class="alerts-ok">✓ All systems normal</div>';
      badge.classList.remove('visible');
      return;
    }

    badge.textContent = state.alerts.length;
    badge.classList.add('visible');

    container.innerHTML = state.alerts.slice(0, 10).map(a => `
      <div class="alert-item ${a.severity}">
        <span class="alert-severity">${a.severity}</span>
        <span class="alert-msg">${a.msg}</span>
        <span class="alert-time">${a.time}</span>
      </div>
    `).join('');
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function updateAll() {
    updateSensorList();
    updateStats();
    updateAlertPanel();
    updateDoorUI();
    state.hatches.forEach((_, i) => updateHatchUI(i));
  }

  return { init, updateAll, updateSensorList, updateStats, updateAlertPanel, updateDoorUI, updateHatchUI };
})();

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SIMULATION LOOP
// ─────────────────────────────────────────────────────────────────────────────
function simulationStep() {
  SensorSystem.update(UPDATE_INTERVAL_MS / 1000);
  runAutoControl();
  AlertSystem.evaluate();
  ChartManager.update();
  UIController.updateAll();
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // Init sensor data
  SensorSystem.init();

  // Init 3D scene
  const canvas = document.getElementById('three-canvas');
  WarehouseScene.init(canvas);

  // Init charts
  ChartManager.initCharts();

  // Init UI bindings
  UIController.init();

  // Start simulation loop
  setInterval(simulationStep, UPDATE_INTERVAL_MS);

  // Faster UI updates for timers
  setInterval(() => {
    UIController.updateDoorUI();
    UIController.updateStats();
  }, 1000);

  console.log('🏭 Warehouse Cooling Control System — Demo Ready');
});
