#!/usr/bin/env python3
"""Compare each beat's entry frame against its mid frame, measuring ink against
THE BEAT'S OWN background colour.

Why this exists: a reveal that clips content out with `overflow:hidden` plus a
transform leaves it at `opacity: 1` the whole time. Every cheap visibility check
therefore reports it as present:

  - counting text nodes weighted by ancestor opacity  -> sees it, it is opacity 1
  - counting pixels different from the PAGE background -> sees the beat's own
    dark band as 100% ink and never looks inside it

Both passed a beat that rendered as an empty black slab. Only pixels measured
against the beat's own background tell the truth.

    node verify.mjs g3.html --shots /tmp/ink
    python3 ink.py /tmp/ink
"""
import collections
import glob
import json
import os
import sys

from PIL import Image

HUD_W = 1200  # the fixed HUD lives past this x; never measure it


def ink_fraction(path, surface):
    """Fraction of the beat's own surface carrying something other than its
    background. Crop to the surface, or the number is dominated by the page
    around it and stays flat whether the surface is full or empty."""
    im = Image.open(path).convert('RGB')
    if surface and surface.get('rect'):
        x0, y0, x1, y1 = surface['rect']
        x1 = min(x1, HUD_W)
        if x1 - x0 < 8 or y1 - y0 < 8:
            return None
        im = im.crop((x0, y0, x1, y1))
        bg = tuple(surface['bg'])
    else:
        im = im.crop((0, 0, HUD_W, 900))
        px0 = list(im.getdata())
        bg = collections.Counter(px0).most_common(1)[0][0]
    px = list(im.getdata())
    return sum(1 for q in px if abs(q[0] - bg[0]) + abs(q[1] - bg[1]) + abs(q[2] - bg[2]) > 36) / len(px)


def main(d):
    bgs = json.load(open(os.path.join(d, 'backgrounds.json')))
    rows = collections.defaultdict(dict)
    for fp in sorted(glob.glob(os.path.join(d, '*__*__*.png'))):
        _, beat, lp = os.path.basename(fp)[:-4].split('__')
        rows[beat][lp] = ink_fraction(fp, bgs.get(beat))

    print(f"{'beat':<16}{'entry p=0.02':>14}{'mid p=0.50':>13}   verdict")
    failures = 0
    for beat, v in rows.items():
        a, b = v.get('0_02'), v.get('0_5')
        if a is None or b is None:
            print(f'{beat:<16}{"—":>13}{"—":>13}   no measurable surface')
            continue
        # A beat whose entry frame carries under half the ink of its mid frame is
        # still assembling itself while the reader is meant to be reading.
        bad = b > 0.004 and a / b < 0.55
        failures += bad
        print(f'{beat:<16}{a:>13.2%}{b:>13.2%}   ' + ('BLANK AT ENTRY' if bad else 'ok'))
    print(f'\n{failures} beat(s) blank at entry')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else '/tmp/ink'))
