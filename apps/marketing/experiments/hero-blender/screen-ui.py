"""Draw the phone-screen UI as a texture. Pillow only — no browser, no fonts beyond the system's.

The model's screen UVs are mirrored in X, so the saved texture is pre-mirrored to
cancel that; render.py applies the Y flip for the glTF/Blender UV-origin difference.
Nothing invented: the only real string is the issuer, which is a genuine accepted
body. Every other value is a ruled blank.
"""
from PIL import Image, ImageDraw, ImageFont
import sys

OUT = sys.argv[1] if len(sys.argv) > 1 else 'screen-ui.png'
W, H = 1179, 2556                      # iPhone 16 Pro Max logical screen

im = Image.new('RGB', (W, H), '#FFFAEA')
d = ImageDraw.Draw(im)

def font(sz, bold=False):
    path = ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold
            else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
    try:
        return ImageFont.truetype(path, sz)
    except Exception:
        return ImageFont.load_default()

def ruled(x, y, w, h=4):
    """A value we do not have, drawn as a dashed rule — never invented."""
    for i in range(0, w, 34):
        d.rectangle([x + i, y, x + i + 18, y + h], fill='#8B8578')

d.text((96, 150), 'Restaurant', font=font(46), fill='#4A4E48')
ruled(96, 240, 620, 6)

d.rounded_rectangle([80, 360, W - 80, 900], radius=48, fill='#E9F3E4')
d.rounded_rectangle([140, 430, 760, 570], radius=36, fill='#0F7A43')
d.rounded_rectangle([140, 430, 760, 570], radius=36, outline='#C9A24B', width=7)
d.text((250, 468), 'Halal certified', font=font(58, True), fill='#FFFFFF')
sx, sy, s = 180, 452, 58
d.polygon([(sx + s * .5, sy), (sx + s * .06, sy + s * .19), (sx + s * .06, sy + s * .56),
           (sx + s * .5, sy + s), (sx + s * .94, sy + s * .56), (sx + s * .94, sy + s * .19)], fill='#FFFFFF')
d.line([(sx + s * .3, sy + s * .5), (sx + s * .45, sy + s * .66), (sx + s * .72, sy + s * .34)],
       fill='#0F7A43', width=8)
d.text((140, 620), 'Halal Goes does not itself', font=font(40), fill='#1B3B31')
d.text((140, 680), 'certify food.', font=font(40), fill='#1B3B31')
d.text((140, 780), 'ISSUED BY', font=font(30, True), fill='#4A4E48')
d.text((140, 826), 'Halal Monitoring Authority (HMA Canada)', font=font(34), fill='#232323')

d.text((96, 990), 'IN FORCE TO', font=font(30, True), fill='#4A4E48'); ruled(96, 1052, 380)
d.text((96, 1120), 'CHECKED BY', font=font(30, True), fill='#4A4E48'); ruled(96, 1182, 440)
d.line([(96, 1290), (W - 96, 1290)], fill='#E6E0D4', width=3)
d.text((96, 1340), 'Menu', font=font(46, True), fill='#232323')
for y in (1430, 1600, 1770):
    ruled(96, y + 18, 460); ruled(96, y + 78, 300)
    d.line([(96, y + 140), (W - 96, y + 140)], fill='#E6E0D4', width=2)

im.transpose(Image.FLIP_LEFT_RIGHT).save(OUT)
print(f'{OUT} {im.size} (pre-mirrored for this model\'s UVs)')
