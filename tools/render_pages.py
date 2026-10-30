"""Render each PDF page to WebP for the viewer. Usage: python render_pages.py input.pdf out_dir"""
import sys, os, io
import pymupdf as fitz
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
doc = fitz.open(src)
for i, p in enumerate(doc):
    pix = p.get_pixmap(dpi=170)
    img = Image.open(io.BytesIO(pix.tobytes('png')))
    img.save(os.path.join(out, f'{i+1}.webp'), 'WEBP', quality=72, method=5)
print('pages', len(doc))
