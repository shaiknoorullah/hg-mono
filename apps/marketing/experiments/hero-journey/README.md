# Scroll-journey prototypes — verification harness

**Status: experiment.** Outside `src/` and `public/`, so Next never builds it.

The prototypes themselves (`g1.html`, `g3.html`, `g4.html`) are the whole marketing
site rebuilt as one scroll-driven storytelling journey, one file per visual direction,
with Lenis vendored beside them. They land here once they pass the checks below.

See `docs/decisions/hero-motion-and-the-creative-direction.md` — this direction amends
§7 of the signed creative direction, and carries five conditions that are still owed.

## Running it

```bash
node apps/marketing/experiments/hero-journey/serve.mjs <dir-with-the-prototypes> 5400
node apps/marketing/experiments/hero-journey/verify.mjs g3.html --shots /tmp/ink   # from the repo root
python3 apps/marketing/experiments/hero-journey/ink.py /tmp/ink
```

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
