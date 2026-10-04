# @hg/brand

The supplied HalalGoes wordmark, and how it became the one piece of geometry
every app draws: `src/wordmark-art.ts`.

It moved here from `apps/marketing/brand/` so the apps share it instead of
copying it. Everything that shows the logo imports the same module:

| Where | Component |
|---|---|
| marketing site | `apps/marketing/src/components/Wordmark.tsx` and the OG card |
| restaurant and admin web apps | `Wordmark` from `@hg/ui-web` |
| customer and rider apps | `Wordmark` from `@hg/ui-native` (`react-native-svg`) |
| favicons and app icons | written by `build-assets.mjs`, below |

In the apps the colours are theme roles, not hexes: the letterforms take
`text.primary` and the swash takes `action.primary` (the same `#F1521E` as
`--hg-mk-accent`). So the apps' dark mode paints the letterforms in the dark
theme's `text.primary` (`#F6EFDD`) rather than the supplied `#D0D0D1` the
marketing site keeps. There is no green in the mark, so it never competes with
the halal seal.

## What arrived

`halalgoes-wordmark-supplied.png` — 556×186, RGBA, transparent background. It is
the master. Nothing here edits it.

Measured rather than eyeballed, because two of these numbers changed what we
shipped:

| | |
|---|---|
| Letterforms | `#D0D0D1` — 78.2% of the opaque pixels |
| Swash | `#F05023` — 7.1% |
| Ramp between them | linear in `y`, no `x` term: letterform colour at `y=119.5`, full orange at `y=154.9` |
| Edge dust | 1940 px at `α ≤ 8`, discarded |

## Two things the component does not copy

**The grey is a reversed lockup.** `#D0D0D1` on our cream `#FFFAEA` is **1.48:1**
— below every threshold there is, including the 3:1 for a graphical object. It
is not a brand colour we can place on this site; it is the colour the mark takes
on a dark background. So the component paints the letterforms with
`currentColor` and lets the surface decide, which gets the ink here and the
cream on a dark surface from one file.

**The orange is already ours.** Sampled `#F05023` vs the token
`--hg-mk-accent` `#F1521E` — under 2 units per channel, indistinguishable on
screen. The component uses the token. Shipping the sampled hex would add a
second near-identical orange to the palette, and a palette with two oranges one
unit apart is a palette that will drift.

The ramp **is** copied, to its measured numbers. It is what makes the g
descender bleed into the swash instead of meeting it at a cut.

## Regenerating

```bash
cd packages/brand && python3 trace-wordmark.py   # needs Pillow
```

Prints the geometry and writes `silhouette.path` / `swash.path`. Paste each into
the matching constant in `src/wordmark-art.ts`. The `.path` files are
intermediates and are not checked in.

There is no potrace or numpy in the container this was built in, so
`trace-wordmark.py` is self-contained: marching squares on the alpha channel
with sub-pixel edge interpolation, Ramer–Douglas–Peucker, then Schneider cubic
fitting. 337 cubics total, 12.4 KB of path data.

## How the trace was checked

Rendered in Chromium at the source's own 556×186 and diffed against the raster,
because a tracer that looks right in a thumbnail is the exact thing this repo
keeps getting caught by:

- total ink coverage within **+0.215%** of the source,
- **zero** pixels more than 1px from the source boundary, in either direction,
- swash-vs-letterform misclassification on 4 of 35,502 solid pixels (0.011%).

The remaining 2.2% of pixels that differ by more than half an alpha step are all
on edges, one sub-pixel out — which is what anti-aliasing does to any
vectorisation, and is why coverage and boundary distance are the numbers above
and not that one.

## The light version, and why nothing here is a second drawing

> The supplied file is the **dark** lockup. A light one was needed too.

The usual way to get one is to open the PNG and repaint the letterforms, which
leaves two binaries that have to be kept in step — and the day the mark changes,
one of them will not be.

There is no second drawing here. The mark is geometry, so the light and dark
versions are the same paths under a different value of `--hg-mk-wordmark`:

| | letterforms | swash | on | contrast |
|---|---|---|---|---|
| Light | `#232323` (text.primary) | `#F1521E` | `#FFFAEA` | 15.05:1 |
| Dark | `#D0D0D1` (**as supplied**) | `#F1521E` | `#171717` | 11.63:1 |

The dark value is carried over from the artwork rather than re-picked. It is
cooler and a step down from the dark theme's own `text.primary` (`#F6EFDD`,
15.63:1), which is the designer's call and reads as a signature rather than a
headline. The swash is the same orange in both, and passes on both.

`Wordmark.tsx` falls back to `currentColor` where the token is out of scope, so
the mark cannot come out invisible on a surface nobody thought about.

## Everything this builds

```bash
pnpm --filter @hg/brand build:assets   # the same as: node packages/brand/build-assets.mjs
# Playwright's Chromium renders the PNGs; point CHROME_PATH at another build if
# the pinned one is not installed:
CHROME_PATH=~/.cache/ms-playwright/chromium-<n>/chrome-linux64/chrome node packages/brand/build-assets.mjs
```

One command, one source of geometry, every file:

| File | What it is |
|---|---|
| `halalgoes-wordmark-light.svg` · `-dark.svg` | the full wordmark, standalone, transparent |
| `halalgoes-wordmark-light.png` · `-dark.png` | the same at 1112×372 (2× the supplied master), for decks and signatures |
| `apps/marketing/src/app/icon.svg` | the browser favicon — **one file, both themes**, via a `prefers-color-scheme` block inside the SVG |
| `apps/marketing/src/app/apple-icon.png` | 180×180, opaque and unrounded: iOS applies its own mask, and a transparent one renders on black |
| `apps/marketing/public/icons/icon-192.png` · `icon-512.png` | Android / PWA install |
| `apps/marketing/public/icons/maskable-512.png` | the same lockup with far more padding, because Android crops maskable icons to a circle |
| `apps/{restaurant,admin}/public/favicon.svg` | the same themed favicon as the marketing site |
| `apps/{restaurant,admin}/public/apple-touch-icon.png` | the same 180×180 iOS icon |
| `apps/{customer,rider}/assets/icon.png` | 1024×1024, opaque and unrounded, for iOS and the stores |
| `apps/{customer,rider}/assets/adaptive-icon.png` | Android adaptive-icon foreground: transparent, maskable padding; the background colour is in the app config |
| `apps/{customer,rider}/assets/splash.png` | the light wordmark centred on a transparent square |
| `apps/{customer,rider}/assets/favicon.png` | 48×48, the Expo web target's tab icon |

The icons are the logo's own **H**, selected out of the traced silhouette rather
than redrawn — everything left of x=135 is the H and its counter, and the swash
begins at x=138.8, so the two never overlap and the split needs no judgement.
Only the sweeping half of the swash is used: the full one ends in a tall hook
which, under one letter instead of five, reads as a second stroke rather than an
underline.

**The favicon no longer shows the seal.** It was a deliberate choice and it is
worth knowing it was traded away: a green disc with a shield is more legible at
16px than a script H, and it showed the product's claim rather than the
company's name. The H now carries the brand and the seal stays where it means
something — on a restaurant that has actually passed. Reverting is one file.

Checked at 16, 24, 32, 48, 64 and 96px against both schemes, plus the circle
crop, before any of it was committed.
