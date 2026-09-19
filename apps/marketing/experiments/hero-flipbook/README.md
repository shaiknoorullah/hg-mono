# Hero flipbook — proof of concept

**Status: experiment. Nothing here ships.** Next builds `src/` and `public/`; this folder is
outside both and is not imported by anything.

## What it proves

The question was whether a scroll-driven 3D phone sequence can be **pre-rendered** rather than
run live in the browser — because the measured alternative is 155 KB gz (raw three.js) to 271 KB
gz (react-three-fiber + drei) of JavaScript against a page that currently ships ~230 KB gz in
total, above the fold, where it lands on LCP. Apple's own product pages ship no WebGL for these
sequences; they scrub pre-rendered frames.

Measured here, end to end:

| | desktop | 4× CPU throttle + Fast 3G |
|---|---|---|
| 60 frames transferred, 720×960, WebP q80 | 201 KB | 201 KB |
| decode all 60 | 486 ms | 1991 ms |
| `drawImage` per scroll frame — mean | 0.15 ms | 0.31 ms |
| `drawImage` — p95 | 0.1 ms | 0.9 ms |
| scrub fidelity across the track | 60/60 distinct, monotonic | 60/60 distinct, monotonic |

Render cost is 43 ms/frame in headless Chromium on **software rendering** (ANGLE/SwiftShader) —
60 frames in 2.5 s. three.js is a build-time dependency and never reaches the browser.

## Pipeline

```bash
python3 -m http.server 5290 --bind 127.0.0.1 &   # scene.html is an ES module; file:// is blocked by CORS
mkdir -p lib && curl -sSfL -o lib/three.module.js \
  https://cdnjs.cloudflare.com/ajax/libs/three.js/0.169.0/three.module.min.js
node 01-render.mjs 60      # scene.html -> frames/*.png
python3 encode.py          # frames/ -> webp/{q80,q80-half,q70}/
node 02-measure.mjs        # flipbook.html -> scrub, decode and LCP numbers
```

`frames/`, `webp/` and `lib/` are gitignored — they regenerate.

## What it does NOT prove

- **The poster-as-LCP claim is untested.** `02-measure.mjs` reports LCP firing on a `<DIV>`,
  which is the test page's own spacer text — the poster sits below the fold in this harness. The
  claim that a frame-0 `<img fetchpriority="high">` becomes the LCP element still needs a real
  hero layout to verify.
- **Decode is eager and unstaged.** All 60 frames are decoded up front, which is why the throttled
  tier takes ~2 s before the scrub goes live. Keyframes-first, or decoding a window around the
  current index, is the obvious fix and is not implemented.
- **The screen UI is a placeholder** drawn on a 2D canvas, not the real app. It also breaks
  invariant 10 on purpose-by-accident: the timeline dots are `#0F7A43`, and solid green is
  reserved to the halal seal. In a real build those are ink. Do not copy `drawScreen()` as-is.
- **No reduced-motion path.** The sequence carries information, so the correct fallback is the
  steps as static stills with their copy, not removal. Not built here.
- Software rendering means the frames are correct but the render is slower than it would be on a
  GPU runner. It does not affect output quality.

## Two bugs this caught, which is the point of building it

1. `ExtrudeGeometry` with `bevelEnabled` spans `-bevelThickness … depth + bevelThickness`, not
   `0 … depth`. The screen plane was sitting *inside* the slab and rendered nothing.
2. A 6.3-unit phone at 22° FOV needs the camera at z≈21, not z≈15, or it overflows the frame.
