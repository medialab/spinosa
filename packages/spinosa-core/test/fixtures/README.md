# PDF routing fixtures

Regenerate with reportlab (any recent version):

```python
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter

# digital-3p.pdf — embedded Helvetica text, ~30 lines x 3 pages
c = canvas.Canvas("digital-3p.pdf", pagesize=letter)
for p in range(1, 4):
    c.setFont("Helvetica", 12)
    y = 750
    for i in range(30):
        c.drawString(72, y, f"Page {p} line {i}: embedded digital text for census and hybrid routing verification purposes.")
        y -= 20
    c.showPage()
c.save()

# scanned-2p.pdf — blank pages, zero fonts, zero text operators (pypdf: reportlab
# vector drawings still emit /Font resources, a byte-scan false positive)
from pypdf import PdfWriter
w = PdfWriter()
w.add_blank_page(612, 792)
w.add_blank_page(612, 792)
with open("scanned-2p.pdf", "wb") as f:
    w.write(f)
```

Expectations (pinned by `test/pdf-text-routing.test.ts`):
- `digital-3p.pdf`: census true, all pages classify `text`
- `scanned-2p.pdf`: census false (no fonts, no text); blank pages classify
  `text` (placeholder written directly — nothing to gain from vision)
- `photo-1p.pdf`: raster photo, zero text; classifies `image` despite font
  resources in the container (byte-scan alone would misroute it)
- `mixed-3p.pdf`: digital page 1 + photo page 2 + digital page 3, in order
