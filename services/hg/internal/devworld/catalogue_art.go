package devworld

import (
	"bytes"
	"hash/fnv"
	"image"
	"image/color"
	"image/png"
	"math"
	"strings"
)

// Generated pictures (no solid green: that colour belongs to the halal seal): a monogram logo for every restaurant, and a plate
// illustration that stands in for any photo the reset could not download.
// Standard library only.

type palette struct {
	bg, bg2, rim, plate color.RGBA
	food                []color.RGBA
	ink                 color.RGBA
}

func rgb(hex uint32) color.RGBA {
	return color.RGBA{R: uint8(hex >> 16), G: uint8(hex >> 8), B: uint8(hex), A: 255}
}

var palettes = []palette{
	{rgb(0x7a2e1f), rgb(0xb5562f), rgb(0xf4ead8), rgb(0xfffaf0), []color.RGBA{rgb(0xc0392b), rgb(0xe67e22), rgb(0x27ae60)}, rgb(0xfff4e0)},
	{rgb(0x3d2b1f), rgb(0x8c5a2b), rgb(0xf1e4cc), rgb(0xfffaf0), []color.RGBA{rgb(0xe3a857), rgb(0xd35400), rgb(0x6b8e23)}, rgb(0xf8e7c8)},
	{rgb(0x0f3d5e), rgb(0x2b6f9e), rgb(0xeaf2f8), rgb(0xffffff), []color.RGBA{rgb(0xc0392b), rgb(0xf1c40f), rgb(0x2ecc71)}, rgb(0xeaf6ff)},
	{rgb(0x6b1d4a), rgb(0xc56a1a), rgb(0xfdf0d5), rgb(0xfffbf2), []color.RGBA{rgb(0xf39c12), rgb(0xd35400), rgb(0x16a085)}, rgb(0xffe9b8)},
	{rgb(0x3b2f4a), rgb(0x7d5a8c), rgb(0xf3f0e3), rgb(0xffffff), []color.RGBA{rgb(0x8e2c2c), rgb(0xe6c35c), rgb(0x3e7d3a)}, rgb(0xf4ecf7)},
	{rgb(0x14535c), rgb(0x2f9aa8), rgb(0xf5efe0), rgb(0xffffff), []color.RGBA{rgb(0xe8b04b), rgb(0xa0522d), rgb(0x9acd32)}, rgb(0xe6fbff)},
	{rgb(0x4a1c1c), rgb(0x9b2d20), rgb(0xfff1d6), rgb(0xfffaf0), []color.RGBA{rgb(0xe74c3c), rgb(0xf5cba7), rgb(0x229954)}, rgb(0xffe2c4)},
	{rgb(0x5c2a00), rgb(0xd9822b), rgb(0xfff3e0), rgb(0xffffff), []color.RGBA{rgb(0xc8781e), rgb(0xa04000), rgb(0xf7dc6f)}, rgb(0xfff0d6)},
	{rgb(0x1f1f1f), rgb(0x8b2b2b), rgb(0xf6efe6), rgb(0xffffff), []color.RGBA{rgb(0x8b4513), rgb(0xf4d03f), rgb(0x58d68d)}, rgb(0xffe8d0)},
	{rgb(0x3b1e08), rgb(0xa8541a), rgb(0xfbefdc), rgb(0xffffff), []color.RGBA{rgb(0xd68910), rgb(0xf0e68c), rgb(0x52be80)}, rgb(0xffeccc)},
	{rgb(0x0b3b52), rgb(0x1f7a8c), rgb(0xf0f7f7), rgb(0xffffff), []color.RGBA{rgb(0xf5b041), rgb(0x48c9b0), rgb(0xe74c3c)}, rgb(0xe4f6f8)},
	{rgb(0x5e1742), rgb(0xd16b8f), rgb(0xfff0f4), rgb(0xffffff), []color.RGBA{rgb(0xf1948a), rgb(0xf7dc6f), rgb(0x82e0aa)}, rgb(0xffe4ee)},
	{rgb(0x1c2a48), rgb(0x46669c), rgb(0xf5f0e1), rgb(0xffffff), []color.RGBA{rgb(0xf4d03f), rgb(0xcb4335), rgb(0x7dcea0)}, rgb(0xe8eefa)},
	{rgb(0x4b2c0d), rgb(0xc99a2e), rgb(0xfff6df), rgb(0xffffff), []color.RGBA{rgb(0xe59866), rgb(0xf9e79f), rgb(0x229954)}, rgb(0xfff2c8)},
}

func paletteFor(i int) palette {
	if i < 0 {
		i = -i
	}
	return palettes[i%len(palettes)]
}

func seedOf(s string) uint64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(s))
	return h.Sum64()
}

func mix(a, b color.RGBA, t float64) color.RGBA {
	l := func(x, y uint8) uint8 { return uint8(float64(x)*(1-t) + float64(y)*t) }
	return color.RGBA{l(a.R, b.R), l(a.G, b.G), l(a.B, b.B), 255}
}

// placeholderPNG draws a plate seen from above on a two-tone background, with
// food shapes placed from the key so each dish looks a little different.
func placeholderPNG(key string, pal int) []byte {
	const w, h = 960, 640
	p := paletteFor(pal)
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	seed := seedOf(key)
	cx, cy := float64(w)/2, float64(h)/2
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			t := (float64(x)/w + float64(y)/h) / 2
			c := mix(p.bg, p.bg2, t)
			// faint diagonal weave on the tablecloth
			if (x+y)%28 < 2 || (x-y+2000)%28 < 2 {
				c = mix(c, p.rim, 0.08)
			}
			img.SetRGBA(x, y, c)
		}
	}
	shadow := color.RGBA{0, 0, 0, 255}
	disc(img, cx+10, cy+14, 270, shadow, 0.25)
	disc(img, cx, cy, 270, p.rim, 1)
	disc(img, cx, cy, 205, p.plate, 1)
	disc(img, cx, cy, 200, mix(p.plate, p.rim, 0.35), 0.35)
	// food: a base mound and a few garnish pieces
	disc(img, cx, cy, 150, p.food[int(seed%uint64(len(p.food)))], 1)
	n := 5 + int(seed>>8%5)
	for i := 0; i < n; i++ {
		a := (float64(i)/float64(n) + float64((seed>>(uint(i)*5))%40)/400) * 2 * math.Pi
		r := 70 + float64((seed>>(uint(i)*3+7))%50)
		size := 16 + float64((seed>>(uint(i)*2+11))%14)
		col := p.food[(i+1)%len(p.food)]
		disc(img, cx+r*math.Cos(a), cy+r*math.Sin(a), size, col, 0.95)
	}
	disc(img, cx-60, cy-70, 26, color.RGBA{255, 255, 255, 255}, 0.25)
	return encodePNG(img)
}

// logoPNG is a round badge with the restaurant's initials.
func logoPNG(name string, pal int) []byte {
	const s = 512
	p := paletteFor(pal)
	img := image.NewRGBA(image.Rect(0, 0, s, s))
	for y := 0; y < s; y++ {
		for x := 0; x < s; x++ {
			img.SetRGBA(x, y, mix(p.bg, p.bg2, float64(y)/s))
		}
	}
	ring(img, s/2, s/2, 226, 8, p.ink)
	text := initials(name)
	scale := 26
	if len(text) == 1 {
		scale = 36
	}
	glyphW, gap := 5*scale, scale
	total := len(text)*glyphW + (len(text)-1)*gap
	x0 := (s - total) / 2
	y0 := (s - 7*scale) / 2
	for i, ch := range text {
		drawGlyph(img, ch, x0+i*(glyphW+gap), y0, scale, p.ink)
	}
	return encodePNG(img)
}

func initials(name string) string {
	var out []rune
	for _, word := range strings.Fields(name) {
		r := []rune(strings.ToUpper(word))[0]
		if r == '&' || (r >= 'A' && r <= 'Z') {
			if r == '&' {
				continue
			}
			out = append(out, r)
		}
		if len(out) == 2 {
			break
		}
	}
	if len(out) == 0 {
		return "H"
	}
	return string(out)
}

func disc(img *image.RGBA, cx, cy, r float64, c color.RGBA, alpha float64) {
	b := img.Bounds()
	for y := int(cy - r - 1); y <= int(cy+r+1); y++ {
		for x := int(cx - r - 1); x <= int(cx+r+1); x++ {
			if x < b.Min.X || y < b.Min.Y || x >= b.Max.X || y >= b.Max.Y {
				continue
			}
			d := math.Hypot(float64(x)-cx, float64(y)-cy)
			cover := math.Max(0, math.Min(1, r-d+0.5)) * alpha
			if cover <= 0 {
				continue
			}
			img.SetRGBA(x, y, mix(img.RGBAAt(x, y), c, cover))
		}
	}
}

func ring(img *image.RGBA, cx, cy, r, width int, c color.RGBA) {
	for y := cy - r - width; y <= cy+r+width; y++ {
		for x := cx - r - width; x <= cx+r+width; x++ {
			d := math.Hypot(float64(x-cx), float64(y-cy))
			if math.Abs(d-float64(r)) <= float64(width)/2 {
				img.SetRGBA(x, y, c)
			}
		}
	}
}

// A 5×7 bitmap font for the capital letters.
var glyphs = map[rune][7]string{
	'A': {".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"},
	'B': {"####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."},
	'C': {".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."},
	'D': {"####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."},
	'E': {"#####", "#....", "#....", "####.", "#....", "#....", "#####"},
	'F': {"#####", "#....", "#....", "####.", "#....", "#....", "#...."},
	'G': {".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."},
	'H': {"#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"},
	'I': {".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."},
	'J': {"..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."},
	'K': {"#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"},
	'L': {"#....", "#....", "#....", "#....", "#....", "#....", "#####"},
	'M': {"#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"},
	'N': {"#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"},
	'O': {".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."},
	'P': {"####.", "#...#", "#...#", "####.", "#....", "#....", "#...."},
	'Q': {".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"},
	'R': {"####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"},
	'S': {".####", "#....", "#....", ".###.", "....#", "....#", "####."},
	'T': {"#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."},
	'U': {"#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."},
	'V': {"#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."},
	'W': {"#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"},
	'X': {"#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"},
	'Y': {"#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."},
	'Z': {"#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"},
}

func drawGlyph(img *image.RGBA, ch rune, x0, y0, scale int, c color.RGBA) {
	g, ok := glyphs[ch]
	if !ok {
		return
	}
	r := float64(scale) * 0.5
	for row, line := range g {
		for col, px := range line {
			if px != '#' {
				continue
			}
			// rounded dots read better than squares at this size
			disc(img, float64(x0+col*scale+scale/2), float64(y0+row*scale+scale/2), r, c, 1)
		}
	}
}

func encodePNG(img image.Image) []byte {
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}
