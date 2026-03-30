import os
import subprocess

# Arguments
small_text = "The CUC investor deck is a critical communication tool for sharing CUC's story with potential investors. It encompasses the company's mission, growth potential, and team credentials."
big_text = "The investor deck must be visually appealing and succinct. It should address the key points that investors care about. This will include an overview of CUC's history, detailed information about the market, competitive analysis, and financial projections."

# Function to create the PPTX deck
def create_pptx_deck(small_text, big_text):
    from pptx import Presentation
    from pptx.util import Inches

    prs = Presentation()

    # Title slide
    slide = prs.slides.add_slide(prs.slide_layouts[0])
    title = slide.shapes.title
    subtitle = slide.placeholders[1]

    title.text = "CUC Investor Deck"
    subtitle.text = small_text

    # Content slide
    slide = prs.slides.add_slide(prs.slide_layouts[1])
    title = slide.shapes.title
    content = slide.placeholders[1]

    title.text = "Overview"
    content.text = big_text

    pptx_file = 'CUC_Investor_Deck.pptx'
    prs.save(pptx_file)
    print(f"Generated PPTX: {pptx_file}")

if __name__ == '__main__':
    create_pptx_deck(small_text, big_text)