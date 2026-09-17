#!/usr/bin/env python3
"""
Bring the landing photography to ONE grade.

Mixed-source photography is a louder "assembled from stock" tell than layout is:
six photographers means six white balances, and the eye reads the seam long
before it reads the pictures. This does a partial white-balance match toward a
shared warm target, plus a gentle shared S-curve and a small green desaturation
(herbs and grass are the main thing that gives a set away).

Partial, not absolute: pulling every image's channel means all the way to one
target destroys pictures that are legitimately dominated by a single colour —
the tandoor shot is *supposed* to be orange. So each image moves a fixed
fraction of the way there and keeps its own character.

Usage: grade-landing-photos.py <src-dir> <out-dir> <slot>=<file> ...
"""
import sys, pathlib
from PIL import Image, ImageEnhance

# Warm target, expressed as channel ratios against green. Roughly 5200K with the
# highlights held off clipping — the look the direction asks for.
TARGET_RG, TARGET_BG = 1.085, 0.905
STRENGTH = 0.55          # how far each image moves toward the target
GREEN_DESAT = 0.93       # herbs/grass are the giveaway across a mixed set

# Slot → output size. Hero is the LCP element on mobile and is cropped 4:5.
SIZES = {'hero': (1600, 2000)}
TILE = (1000, 1250)


def channel_means(im):
    small = im.convert('RGB').resize((160, 160))
    px = list(small.getdata())
    n = len(px)
    return (
        sum(p[0] for p in px) / n,
        sum(p[1] for p in px) / n,
        sum(p[2] for p in px) / n,
    )


def grade(im):
    r, g, b = channel_means(im)
    if min(r, g, b) < 1:
        return im
    # How far this image's cast sits from the target, damped by STRENGTH.
    r_gain = 1 + ((TARGET_RG / (r / g)) - 1) * STRENGTH
    b_gain = 1 + ((TARGET_BG / (b / g)) - 1) * STRENGTH
    # Clamp: a hard cast (the tandoor) must not get bleached back to neutral.
    r_gain = max(0.92, min(1.10, r_gain))
    b_gain = max(0.90, min(1.12, b_gain))

    im = im.convert('RGB')
    lut = (
        [min(255, int(i * r_gain)) for i in range(256)]
        + list(range(256))
        + [min(255, int(i * b_gain)) for i in range(256)]
    )
    im = im.point(lut)
    im = ImageEnhance.Color(im).enhance(GREEN_DESAT)
    im = ImageEnhance.Contrast(im).enhance(1.04)
    return im


def cover(im, size):
    tw, th = size
    w, h = im.size
    scale = max(tw / w, th / h)
    im = im.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    w, h = im.size
    # Bias the crop slightly ABOVE centre: in food photography the subject
    # almost always sits above the midline, and a dead-centre crop tends to
    # shave the top of the dish while keeping empty tablecloth at the bottom.
    top = max(0, round((h - th) * 0.42))
    return im.crop(((w - tw) // 2, top, (w - tw) // 2 + tw, top + th))


def main():
    src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    for pair in sys.argv[3:]:
        slot, fname = pair.split('=')
        im = Image.open(src / fname)
        im = cover(grade(im), SIZES.get(slot, TILE))
        dest = out / f'{slot}.jpg'
        im.save(dest, 'JPEG', quality=82, optimize=True, progressive=True)
        r, g, b = channel_means(im)
        print(f'{slot:10s} <- {fname:16s} {im.size[0]}x{im.size[1]}  '
              f'R/G={r/g:.3f} B/G={b/g:.3f}  {dest.stat().st_size // 1024}KB')


if __name__ == '__main__':
    main()
