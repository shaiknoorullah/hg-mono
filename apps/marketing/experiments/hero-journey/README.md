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

## The lesson worth keeping: never screenshot a smooth-scrolled page after a jump

A screenshot pass reported a beat rendering as **an empty black slab**, and it was
wrong. The page was fine. The harness was broken, and it cost a false bug report and a
wasted round-trip to the agent that built the page.

What it did: `scrollTo(0, max * 0.46)` in one hop, then `waitForTimeout(1100)`, then
capture. With Lenis smoothing a ~14,000 px jump, the page had *arrived* at the beat —
the on-page HUD correctly read `04 THE REFUSAL · local p 0.00` — but the damped progress
that drives the transforms was still trailing, so the headline lines were still clipped
at `translateY(102%)`. The frame was a real transient, photographed and mistaken for a
resting state.

**Under natural scrolling the beat is never empty.** Wheeling 100 px per tick from one
viewport before the beat through its first third, across 26 samples with the band
substantially on screen, zero frames had the lines hidden; `getComputedStyle` reports
`matrix(1, 0, 0, 1, 0, 0)` at the very scroll position the bad screenshot condemned.

So, for any page driven by a smooth-scroll library:

> **A jump is not a scroll.** Settle the page before measuring: park near the target,
> move in short hops, and wait for the damped state to converge — or drive the wheel the
> way a reader does. Verify anything a single frame seems to show with a second,
> different method before calling it a defect.

`verify.mjs` follows this: it parks at each beat's mid-point first and only then steps to
the frames it captures, so every jump is short.

### The corollary that does hold: opacity lies

While chasing the phantom, two plausible checks were both shown to be useless for this
class of question, and that part is real:

- Counting visible text weighted by ancestor `opacity` — content clipped by
  `overflow: hidden` plus a transform stays at `opacity: 1` and reads as present.
- Counting pixels that differ from the **page** background — a beat's own dark band reads
  as ~50% ink against a cream page, and that number barely moves whether the band is full
  or empty.

Only pixels measured **inside the beat's own surface, against that surface's own
background colour**, answer the question. That is what `ink.py` does, and why
`verify.mjs` reports each beat's largest opaque surface as a colour *and a rect* rather
than assuming the page's.
