# Hero ground textures — bake or generate?

**Status: experiment. Nothing here ships.** Outside `src/` and `public/`, so Next never
builds it. Produced while building the [Ink Field](../../../../README.md) hero treatment,
which draws its paper as a halftone screen rather than a gradient.

## The question

The ink-field hero needs a **paper tooth** — a static, tiling fibre texture between
`#FFFAEA` and `#F6EFDD` — and an **ordered Bayer dither**. Either can be baked to a PNG at
build time or generated in the fragment shader at runtime. Runtime costs GPU work every
frame; baking costs bytes once. The deciding number is how many bytes.

## The measurement

Noise is incompressible, so gzip makes it *worse*, not better — every variant below gzips
larger than its raw PNG. That is the finding that settles it.

| tile | depth | raw PNG | gzipped |
|---|---|---|---|
| 128px | 8-bit | 13,180 B | 13,203 B |
| 128px | 4-bit | 4,812 B | 4,835 B |
| 128px | 2-bit | **1,996 B** | 2,019 B |
| 256px | 8-bit | 51,818 B | 51,856 B |
| 256px | 4-bit | 16,834 B | 16,862 B |
| 256px | 2-bit | 6,451 B | 6,474 B |

**Conclusion: generate it at runtime.** A 128px 2-bit tile is only ~2 KB, which sounds
cheap — but the shader that produces it is three octaves of value noise, already written,
and costs nothing extra per frame because the field pass runs anyway at one texel per 3 CSS
px. Baking would add an asset, a request and a decode to save arithmetic the GPU does not
notice. At 8-bit and 256px the cost rises to 52 KB, a quarter of the page's entire JS
budget, for a texture nobody would consciously see.

The one case for baking: if the tooth ever needs to be *authored* rather than generated —
a scanned paper, a real letterpress bite — it stops being a shader and becomes an asset,
and then `bake.mjs` is the tool.

## The A/B

`a-static.html` and `b-webgl.html` are the same hero composed two ways — baked tiles versus
a live shader — so the difference can be looked at rather than argued about. `probe.mjs`
loads both in headless Chromium (SwiftShader), screenshots each and reports load timings.

`a-static.html` is the honest case for baking: two tiled PNGs, **no JS, no canvas, and
nothing to disable for reduced motion**, because nothing moves. If the field turns out not
to earn its keep, this is what replaces it — and it costs a `<style>` block.

Note `probe.mjs` imports `playwright` bare, so run it where that resolves (the repo root),
or point it at the pinned copy the other experiments use.

## Files

- `bake.mjs` — bakes `paper-tooth.png` (tiling fbm tooth) and `dither-64.png` (ordered
  Bayer, 64px). Zero dependencies: it writes PNG chunks and CRCs by hand with `node:zlib`,
  so it needs no image library.
- `variants.mjs` — the table above. Sweeps tile size × bit depth, writes each variant and
  reports raw and gzipped bytes.

- `a-static.html` / `b-webgl.html` — the same hero, baked versus live.
- `probe.mjs` — loads both headless, screenshots and times them.

```bash
node bake.mjs
node variants.mjs
node probe.mjs        # needs playwright on the resolution path
```

PNGs are gitignored — they regenerate deterministically from the scripts.
