# Warehouse Cooling Control System — Investor Demo

A browser-based 3D mockup of an onion cold storage warehouse with real-time monitoring,
control systems, alerts, and physics-based cooling simulation — built for investor
demonstrations.

---

## 🚀 How to Run

Open `warehouse-demo/index.html` directly in any modern browser (Chrome, Firefox, Edge).

```bash
# Option A: open directly
open warehouse-demo/index.html

# Option B: serve with a local HTTP server (recommended for best compatibility)
cd warehouse-demo
python3 -m http.server 8080
# then open http://localhost:8080
```

No build step, no backend, no installation required.

---

## 🏭 Features

### 3D Warehouse Visualization (Three.js)
- Realistic 20m × 10m × 5m cold-storage warehouse
- Stacked wooden onion boxes in organized rows with aisles
- **Cooling wall** (blue glow) with 5 controllable hatches showing open/closed state
- **Loading door** that physically swings open/closed
- Interactive camera — drag to orbit, scroll to zoom
- Click any sensor sphere to select and inspect it

### Sensor Network
- **8 temperature & humidity sensors** distributed throughout the warehouse
- Sensors closer to the cooling wall read colder; sensors near the door show heat ingress
- Color-coded status indicators: 🟢 Normal · 🟡 Warning · 🔴 Critical
- Hover over a sensor sphere in 3D for a live tooltip

### Control Panel
| Section | Description |
|---|---|
| **Operation Mode** | Switch between AUTO (PID-style control) and MANUAL (individual hatch sliders) |
| **Setpoints** | Adjust target temperature (0–10 °C) and humidity (80–98 %) |
| **Statistics** | Live avg/min/max for temperature and humidity + alert count |
| **Loading Door** | Open/close with timer warning after 2 minutes |
| **Hatches H1–H5** | Per-hatch open percentage with visual progress bars |

### Dashboard
- **Average Temperature Gauge** — semi-circular gauge with zone coloring
- **Temperature History Chart** — last 40 data points, all 8 sensors, Chart.js
- **Humidity History Chart** — same format
- **Heat Map Overlay** — toggle to show temperature gradient in 3D (blue = cold, red = warm)

### Alert System
| Alert Type | Condition |
|---|---|
| Temp Warning | Any sensor > 8 °C or < 0 °C |
| Temp Critical | Any sensor > 10 °C or < -2 °C |
| Humidity Warning | Any sensor < 80 % or > 98 % |
| Humidity Critical | Any sensor < 75 % or > 99 % |
| Door Warning | Door open > 2 minutes |
| Sensor Malfunction | Sensor frozen reading (simulated intermittent failure) |

### Physics Simulation
- Opening more hatches lowers temperature faster
- Closing hatches causes temperature to drift up
- Opening the door raises temperature (strongest effect near door)
- Thermal inertia — temperatures change gradually, not instantly
- Spatial gradients — sensors near cooling wall stay colder
- AUTO mode continuously adjusts all hatches to track the setpoint

---

## 🎛 Controls Guide

| Control | Action |
|---|---|
| **Left-click drag** (3D view) | Orbit camera |
| **Scroll wheel** (3D view) | Zoom in / out |
| **Click sensor sphere** | Select / deselect sensor |
| **AUTO / MANUAL buttons** | Switch operation mode |
| **Temperature slider** | Adjust cooling setpoint |
| **Humidity slider** | Adjust humidity setpoint |
| **OPEN / CLOSE DOOR** | Toggle loading door |
| **SHOW / HIDE HEAT MAP** | Toggle 3D temperature overlay |
| **Hatch sliders** (MANUAL mode only) | Set individual hatch positions |

---

## 🛠 Technical Stack

| Library | Version | Purpose |
|---|---|---|
| [Three.js](https://threejs.org/) | r158 | 3D warehouse visualization |
| [Chart.js](https://www.chartjs.org/) | 4.4 | Sensor history charts |

All assets loaded from CDN — no local dependencies required.

---

## 📁 File Structure

```
warehouse-demo/
├── index.html   # Main HTML — layout & library imports
├── style.css    # Dark control room theme
├── app.js       # Simulation engine, 3D scene, UI logic
└── README.md    # This file
```

---

## 🎯 Initial State

| Parameter | Value |
|---|---|
| Mode | AUTO |
| Temperature Setpoint | 4 °C |
| Humidity Setpoint | 90 % |
| Loading Door | CLOSED |
| Hatches H1–H5 | 50 % open |
| All Sensors | Normal range |

---

*ACS — Advanced Cold Storage Control System*
