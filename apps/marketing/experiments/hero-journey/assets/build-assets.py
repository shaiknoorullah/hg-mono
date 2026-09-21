#!/usr/bin/env python3
"""Regenerate the dish images the prototypes use, from the app's own originals.

The webp files are derived, so they are gitignored — run this after a fresh
clone. Source is `apps/marketing/public/img`, which is the real site's imagery;
these are resized and re-encoded only to keep three self-contained prototypes
from carrying ~1.6 MB of JPEG each.

    python3 build-assets.py
"""
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, '..', '..', '..', 'public', 'img'))
DISHES = ['grill', 'rice', 'shawarma', 'curry', 'bread', 'platter']
WIDTH = 900   # tiles render at ~33vw desktop / 50vw phone; covers 2x on a 3-col grid

def main():
    before = after = 0
    for name in DISHES:
        src = os.path.join(SRC, f'{name}.jpg')
        im = Image.open(src).convert('RGB')
        before += os.path.getsize(src)
        im = im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)
        dst = os.path.join(HERE, f'{name}.webp')
        im.save(dst, 'WEBP', quality=78, method=6)
        after += os.path.getsize(dst)
        print(f'{name}: {os.path.getsize(src) // 1024} KB jpg -> {os.path.getsize(dst) // 1024} KB webp')
    print(f'total {before // 1024} KB -> {after // 1024} KB')

if __name__ == '__main__':
    main()
