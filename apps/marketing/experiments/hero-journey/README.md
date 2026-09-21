# Scroll-journey prototypes — verification harness

**Status: experiment.** Outside `src/` and `public/`, so Next never builds it.

`g1.html`, `g3.html` and `g4.html` are the whole marketing site rebuilt as one
scroll-driven storytelling journey, one self-contained file per visual direction, with
Lenis vendored in `assets/`. `BRIEF.md` is what they were built from.

| File | Direction | Page | Beats | Shortest |
|---|---|---|---|---|
| `g1.html` | **Two cropped phones.** Two handsets, one past the top edge and one past the bottom, rotating through the whole journey. The brief as originally given. The entire page is pinned — scroll-jacking in the full sense — which is what buys the dwell and keeps body text off the device screens | 42.3 vh | 13 | 2.6 vh |
| `g3.html` | **Type-led.** No device above the fold; the hero is typography and the still seal, and the journey begins only once you scroll. Spends its motion budget on the seven checks instead — 5.6 vh, the longest single beat in any direction | 34.9 vh | 8 | 2.5 vh |
| `g4.html` | **The portal.** No phone at all: a bezel-less aperture cut into the page, square-on at all times, growing to fill the viewport for the seven checks. Removes the phone-mockup problem rather than cropping around it | 46.0 vh | 13 | 2.6 vh |

All three: zero horizontal scroll and zero console errors at 390 / 768 / 1024 / 1440, no
beat blank at entry, and reduced motion collapsing to an ordinary document (13.9 / 14.6 /
15.4 vh). The devices are DOM and CSS, not three.js — deliberately, so the choreography,
the content and the pacing are settled cheaply before any WebGL is involved. Each keeps
its device transform state in one table so the swap is a single edit.

### Assets

`assets/*.webp` are derived from `apps/marketing/public/img` and gitignored. After a
fresh clone, run `python3 assets/build-assets.py` or the dish tiles will 404.

See `docs/decisions/hero-motion-and-the-creative-direction.md` — this direction amends
§7 of the signed creative direction, and carries five conditions that are still owed.

## The site

`site/` is the full marketing site built on the G3 direction — seven pages with
working links, a sticky signup that appears after the hero and hides over the footer,
and a footer carrying its own form. `index.html`, `restaurants.html` and `riders.html`
are scroll journeys; `verification.html`, `privacy.html`, `terms.html` and
`writing.html` are quiet documents with no beat engine.

## Running it

```bash
# the three single-page direction prototypes
node apps/marketing/experiments/hero-journey/serve.mjs apps/marketing/experiments/hero-journey 5400
node apps/marketing/experiments/hero-journey/verify.mjs g3.html --shots /tmp/ink   # from the repo root
python3 apps/marketing/experiments/hero-journey/ink.py /tmp/ink
node apps/marketing/experiments/hero-journey/dead-scroll.mjs g3.html 5400

# the full site
node apps/marketing/experiments/hero-journey/serve.mjs apps/marketing/experiments/hero-journey/site 5402
node apps/marketing/experiments/hero-journey/site-check.mjs 5402
```

Every tool takes its port as an argument. A hard-coded one silently measures
whatever else is listening instead of failing, which is its own kind of wrong
answer.

`verify.mjs` needs `playwright`, which resolves from the repo root. Chromium is the
pre-installed build at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.

## What it measures, and why each check exists

| Check | Why |
|---|---|
| Total page height in viewports | Context for the per-beat numbers |
| Every pinned beat's length, flagged under 250vh | **The original defect.** The first attempt gave each beat ~1.3 viewports, so a small scroll ran the whole animation to completion |
| Horizontal overflow at rest **and stepped through the page** | Overflow often appears only mid-transform, so a single at-rest check misses it |
| Console errors | A silently-failed module leaves a fallback that looks deliberate |
| Reduced motion: total height and sticky count | It must collapse to an ordinary document, not a frozen animation. Sticky count should be 0 |
| Distinct states per beat (`dead-scroll.mjs`) | A beat pins so something can happen while it is held. `distinct: 1` means it never changes — a viewport or more of frozen scroll, which reads as broken |
| All seven pages at four widths (`site-check.mjs`) | Overflow sampled at eleven scroll positions, not at rest: it usually appears mid-transform |
| Per-beat entry frame vs mid frame (`ink.py`) | See below |

## The lesson worth keeping: a jump is not a scroll

These pages run Lenis, which keeps its **own** scroll value and drives every transform
from it. A native `scrollTo` moves `window.scrollY` without moving Lenis's value, so the
page renders one position while the browser reports another. Every measurement taken
afterwards describes a state no reader will ever see.

This cost two wrong calls in a row, in opposite directions:

1. A screenshot pass jumped to 46% of the page in one `scrollTo` and captured a beat
   rendering as an empty black slab. Reported as a defect.
2. "Verifying" it — with tests that *also* began with a `scrollTo` to get near the beat —
   showed the beat fully populated. The defect was retracted as a measurement artefact.

Both readings were of a desynced page. The truth came from a test with **no `scrollTo`
anywhere**: pure `mouse.wheel` from page load. Of 19 samples with the band substantially
on screen, **9 had all three headline lines clipped out**. The original report was right.

The arithmetic settles it independently of any harness: with `p = dwell(raw) =
smoothstep(clamp((raw − 0.2) / 0.6))`, `dwell(0.02) = 0` exactly, so an entrance keyed to
`seg(p, 0.06, …)` is zero — the content is clipped **by construction**, not by lag, for
the whole opening dwell.

> **Drive real wheel input and approach each frame from above, the way a reader arrives.**
> `verify.mjs` does this: `seek()` wheels to the target and waits for the damped values to
> converge, and entry frames are reached by first moving a viewport above the beat.

### The corollary: opacity lies, and so does ink against the page

Two further checks were tried and both reported a blank beat as healthy:

- **Text weighted by ancestor `opacity`** — content pushed out by a transform inside
  `overflow:hidden` stays at `opacity: 1` and reads as present. It is **clipped**, not
  faded.
- **Pixels differing from the *page* background** — a beat's own dark band reads as ~50%
  ink against a cream page whether the band is full or empty.

So the primary check in `verify.mjs` is **painted text**: on screen, not transparent, and
not clipped — for each `overflow:hidden` ancestor it tests whether the text's rect still
intersects it. Validated against a known-bad build and its fix:

| | painted | clipped |
|---|---|---|
| before the fix | **0** | 511 |
| after the fix | **511** | 0 |

`ink.py` remains for visual confirmation, but it measures a surface rect captured at one
scroll position, so it is unreliable for any surface that moves between frames. Trust
`blankAtEntry` in the JSON, and look at the screenshots.

## The rule the prototypes follow

> **An entrance reveal must complete on approach, not on pinned progress.** At the moment
> a beat pins — where its opening dwell begins — the composition must already be whole and
> still. The pinned scroll is for the *narrative* (checks recording themselves, blanks
> filling, a device changing screens), never for the furniture arriving.

Mechanically, a second progress per beat that finishes where the pinned one starts:

```js
pIn = clamp((scroll - (top - vh)) / vh, 0, 1)   // 0 a viewport out, 1 as it pins
dIn = damped(pIn)
```

Entrance segments read `dIn`; narrative segments keep the pinned progress. Pair it with a
jump-snap — if the per-frame scroll delta exceeds a viewport, set damped equal to exact —
so an anchor link or scrollbar drag does not land mid-assembly.
