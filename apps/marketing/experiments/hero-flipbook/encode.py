"""Encode rendered PNG frames to WebP tiers. Pillow only — no ffmpeg in this environment."""
import glob, json, os, sys
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else 'frames'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'webp'
TIERS = [('q80', 1.0, 80), ('q80-half', 0.5, 80), ('q70', 1.0, 70)]

frames = sorted(glob.glob(f'{SRC}/*.png'))
if not frames:
    sys.exit(f'no PNGs in {SRC}/ — run `node 01-render.mjs` first')

report = {'frames': len(frames)}
for name, scale, q in TIERS:
    d = f'{OUT}/{name}'
    os.makedirs(d, exist_ok=True)
    total = 0
    for f in frames:
        im = Image.open(f).convert('RGB')
        if scale != 1.0:
            im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
        p = f'{d}/{os.path.basename(f)[:-4]}.webp'
        im.save(p, 'WEBP', quality=q, method=6)
        total += os.path.getsize(p)
    report[name] = {'totalKB': round(total / 1024), 'perFrameKB': round(total / len(frames) / 1024, 1)}

print(json.dumps(report, indent=1))
