# The scroll-journey engine

Ported from the approved G3 prototype — `experiments/hero-journey/site/index.html`,
the `<script>` at the foot of the file. The maths, the dwell, the two-clock split
and the jump-snap are that engine's. Only the packaging is new: one module-level
rAF loop shared by every mounted beat, instead of one closure per page.

Read `experiments/hero-journey/README.md` for why each rule exists. Each one was
paid for.

```
useJourney.ts   the engine: one rAF loop, one scroll value, the clocks, the maths
Beat.tsx        one pinned beat — a tall section, a sticky stage, a render prop
```

## Using it

```tsx
'use client';
import { Beat } from '@/components/journey/Beat';

<Beat id="sheet" name="03 THE SEVEN CHECKS" vh={560} align="top" className="bg-surface-sunken">
  {(p) => (
    <div className="mx-auto w-full max-w-[1280px] px-5 lg:px-14">
      {/* ENTRANCE — on the approach clock, so it is finished when the beat pins */}
      <h2
        className="font-display text-marketing-section-phone text-fg-primary lg:text-marketing-section"
        style={{ opacity: p.seg(p.dIn, 0, 0.7) }}
      >
        Seven checks, every one of them recorded.
      </h2>

      {/* NARRATIVE — on the pinned clocks, which is what the pin is for */}
      <ol>
        {CHECKS.map((check, i) => {
          // Discrete: pExact. A tick driven off pDamped flickers.
          const passed = p.pExact >= 0.05 + i * 0.112;
          return <Check key={check.id} {...check} passed={passed} />;
        })}
      </ol>
    </div>
  )}
</Beat>
```

`Beat` is a client island. It renders the section, the sticky stage and its
children; everything inside the render prop is yours. A page can mount as many
as it likes — they share one loop and one scroll read.

## The API

```tsx
export interface BeatProps {
  id: string;                    // stable identity → data-beat
  name: string;                  // human label → data-beat-name, e.g. "03 THE SEVEN CHECKS"
  vh?: number;                   // beat length in viewport units, default 300
  align?: 'center' | 'top';      // where the composition sits in the stage, default 'center'
  className?: string;            // on the tall section — the background
  stageClassName?: string;       // on the sticky stage
  labelledBy?: string;           // id of the heading that names the beat
  children: (progress: JourneyProgress) => ReactNode;
}

export function Beat(props: BeatProps): ReactElement;

export interface JourneyProgress {
  readonly raw: number;          // undwelled pinned progress — diagnostics only
  readonly pExact: number;       // DISCRETE owner
  readonly pDamped: number;      // CONTINUOUS owner
  readonly pIn: number;          // approach, exact
  readonly dIn: number;          // approach, damped — THE ENTRANCE CLOCK
  readonly reducedMotion: boolean;
  readonly seg: (clock: number, from: number, to: number) => number;        // 0..1, smoothstepped
  readonly segLinear: (clock: number, from: number, to: number) => number;  // 0..1, linear
  readonly smooth: (t: number) => number;                                   // clamped smoothstep
}
```

`useJourney({ id, name })` is the hook underneath, returning
`{ ref, progress, reducedMotion }`. `Beat` is what to use; reach for the hook
only for a beat that needs different markup around the same clocks. `clamp01`,
`smooth`, `seg` and `segLinear` are also exported from `useJourney.ts` as plain
functions, for a renderer that computes outside a component.

## The four rules a beat has to keep

**1. Every pinned beat gets at least 250vh; device-led beats 300vh+.** The first
attempt gave each beat ~1.3 viewports, so a small scroll ran the whole animation
to completion and nobody ever saw the middle of it. The engine measures each
beat and warns once, in development, below 2.5 viewports — including when the
height came from CSS rather than from the prop.

**2. Entrances run on `dIn`, narrative runs on `pExact` / `pDamped`.** At the
moment a beat pins, its composition must already be whole and still. The pinned
scroll is for the narrative — checks recording themselves, blanks filling, a
device changing screens — never for the furniture arriving.

This is not a matter of taste or of lag. Pinned progress is dwelled:
`dwell(0.02) = 0` exactly, so an entrance keyed to `seg(p.pDamped, 0.06, …)` is
zero for the whole opening hold. The composition is clipped **by construction**.
A harness pass found the band empty in 9 of 19 samples before this was fixed.

Both failures are defects and both are checked:

- a beat with nothing on a pinned clock is a viewport of frozen scroll
  (`dead-scroll.mjs` reports `distinct: 1`);
- a beat that is blank at the pin is `blankAtEntry` in `verify.mjs`.

**3. Exact owns the discrete, damped owns the continuous.** Which beat is
active, how many checks are ticked, what a live region announces, whether a
badge is shown — all `pExact`. Transforms and opacity — all `pDamped`. Never one
value for both: a threshold crossed by a damped value flickers as the value
settles back and forth across it.

**4. `prefers-reduced-motion` is a real path, not a frozen one.** The section
loses its height, the stage loses its stickiness, every clock reads 1, and the
page collapses to an ordinary readable document. `reducedMotion` is on the
progress object for the handful of things the clocks cannot express — an
`aria-busy`, a caption that only makes sense mid-animation. The preference is
re-read when it changes, not only at mount.

## What the packaging changed, and why

Nothing in the maths. These are the differences from the prototype's script, all
of them forced by being a React page rather than one static file.

**`seg` is eased; the prototype's was linear.** There, `seg` is a bare ramp and
`smooth()` is applied at the call site. Here `seg` is already smoothstepped and
`segLinear` is the bare ramp. Porting a renderer verbatim: `smooth(seg(d, a, b))`
becomes `seg(d, a, b)`, and a bare `seg(d, a, b)` becomes `segLinear(d, a, b)`.
Leaving the `smooth()` wrapper on double-eases it and the motion goes slack at
both ends.

**No Lenis.** It is not a dependency of this app, and adding a scroll-hijacking
library to the real site is a separate decision nobody has made. Native
`scrollY` with a rAF loop; the damping is what smooths the render and it was
always doing that work. One consequence: the prototype's note that "natural
scrolling never trips the jump-snap" held because Lenis animated its own
scrolling. On native scroll a violent trackpad fling *can* exceed a viewport in
one frame — and snapping is the right answer there too, since at that speed
there is nothing to smooth.

**Damped snaps to exact within 1e-4.** The prototype lerped asymptotically
forever, which was free when the renderer wrote to `style`. Here a frame that
changes nothing must not re-render, so the values have to actually arrive. 1e-4
of a beat is far under a pixel of any transform we drive.

**A material reflow counts as a jump.** The prototype was one static file; this
page has fonts, images and CMS copy landing after mount, and every beat below a
change is then measured against a stale top. A `ResizeObserver` on the document
re-measures, and if a beat's top moved more than 2px the damping is snapped
rather than dragged — the same argument as the jump-snap. The 2px floor keeps a
sub-pixel reflow from disabling damping every frame.

**A beat renders resting on the server.** Every clock is 1 for the server render
and the first client paint, so a crawler and anyone whose JS failed get the
composition whole rather than a blank page. That is the prototype's `html.js`
gate restated for React. The engine's first frame runs in a layout effect, so
the real values land before paint and a beat that mounts already on screen — a
deep link, a reload partway down — does not pop.

**Beats re-render only on a frame that moved them.** Once a beat has settled it
costs nothing, so a page of eight beats has one or two live subtrees at a time.

## Two things that will break a beat

**`--sticky-cta-h` is reserved as the stage's bottom padding.** `StickyCta`
publishes its own measured height there; without the reserve the bar crops the
bottom of every pinned composition. `Beat` does this for you — do not override
`padding-bottom` on the stage. It is constant rather than tied to whether the
bar is currently shown, because a padding that toggled with it would jog every
pinned composition each time the bar came and went.

**`overflow: hidden` on an ancestor kills `position: sticky`.** If a beat scrolls
past without ever pinning, look up the tree before looking at the engine. The
stage's own `overflow-hidden` is deliberate — it is what clips an entrance — and
`stageClassName="overflow-visible"` turns it off where a shadow needs to escape.

## Checking a beat

From the repo root, against the prototype harness:

```bash
node apps/marketing/experiments/hero-journey/serve.mjs apps/marketing/experiments/hero-journey/site 5402
node apps/marketing/experiments/hero-journey/site-check.mjs 5402
```

Point the same tools at `pnpm --filter @hg/marketing dev` on :5190 to measure the
real pages. Every tool takes its port as an argument; a hard-coded one silently
measures whatever else is listening instead of failing.

What matters: beat length in vh, `blankAtEntry` false for every beat, `distinct`
above 1 for every beat, zero horizontal overflow sampled *through* the scroll
rather than at rest, and — under reduced motion — a sticky count of zero.

**Drive real wheel input.** A native `scrollTo` to a measurement point renders a
state no reader will ever see, and it produced two wrong calls in a row, in
opposite directions, before anyone noticed. Approach each beat from above, the
way a reader arrives.
