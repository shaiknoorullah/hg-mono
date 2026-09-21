'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * The scroll-journey engine, ported from the approved G3 prototype
 * (`experiments/hero-journey/site/index.html`, the `<script>` at the foot of
 * the file). The maths, the dwell, the two-clock split and the jump-snap are
 * that engine's; only the packaging is new — one module-level rAF loop that
 * every mounted `<Beat>` shares, instead of one closure per page.
 *
 * The rules it exists to keep are in `./README.md` and in
 * `experiments/hero-journey/README.md`. The short version:
 *
 *   - A beat pins so that something can happen WHILE it is held. Furniture
 *     ARRIVING is not that something: the entrance runs on the approach clock
 *     and is finished by the time the beat pins, so the composition is already
 *     whole and still when the reader stops.
 *   - Exact progress owns anything discrete; damped progress owns anything
 *     continuous. One value driving both is how you get a tick that flickers
 *     between two states.
 *
 * No Lenis. The prototype ran on it, but it is not a dependency of this app and
 * adding a scroll-hijacking library to the real site is a decision nobody has
 * made. Native scroll reads the same here — the damping below is what smooths
 * the render, and it was always doing that work.
 */

/* ── maths ───────────────────────────────────────────────────────────────── */

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Smoothstep. Clamped, because this one is public and can be handed anything. */
export function smooth(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/**
 * The raw ramp: 0 before `from`, 1 after `to`, linear between. This is the
 * prototype's `seg` exactly. Reach for it when you want a bare ramp — a width
 * filling, a rule drawing — where an ease would read as hesitation.
 */
export function segLinear(clock: number, from: number, to: number): number {
  if (to === from) return clock >= to ? 1 : 0;
  return clamp01((clock - from) / (to - from));
}

/**
 * The eased ramp, and the one to use by default: the prototype's
 * `smooth(seg(...))` in a single call.
 *
 * Note for anyone porting a renderer out of the prototype verbatim: there,
 * `seg` is linear and the ease is applied at the call site. Here `seg` is
 * already eased. So `smooth(seg(d, a, b))` becomes `seg(d, a, b)`, and a bare
 * `seg(d, a, b)` becomes `segLinear(d, a, b)`. Leaving the `smooth()` wrapper
 * on double-eases it and the motion goes slack at both ends.
 */
export function seg(clock: number, from: number, to: number): number {
  return smooth(segLinear(clock, from, to));
}

/**
 * THE DWELL. The first 20% and the last 20% of a beat's scroll range hold
 * still; all the movement happens in the middle 60%. A reader can stop and read
 * without the thing under them still travelling.
 *
 * This is also why an entrance keyed to pinned progress is clipped by
 * construction rather than merely late: `dwell(0.02)` is 0 exactly, so a
 * composition that assembles on `pDamped` is still empty for the whole opening
 * hold. That defect cost two wrong calls in a row — see the prototype README.
 */
const DWELL = 0.2;
function dwell(p: number): number {
  return smooth(clamp01((p - DWELL) / (1 - 2 * DWELL)));
}

/* ── the progress object handed to every beat's render prop ──────────────── */

export interface JourneyProgress {
  /**
   * Undwelled pinned progress: 0 as the beat pins, 1 as it releases. For
   * diagnostics and for asking "is this beat held" — never for rendering, since
   * rendering off it throws the dwell away.
   */
  readonly raw: number;
  /**
   * Pinned progress, dwelled. THE DISCRETE OWNER: which beat is active, how
   * many checks are ticked, what a live region says. Stepping off this rather
   * than off `pDamped` is what stops a tick flickering between two states while
   * the damped value settles across the threshold.
   */
  readonly pExact: number;
  /**
   * Pinned progress, dwelled and damped. THE CONTINUOUS OWNER: transforms,
   * opacity, anything that reads as movement.
   */
  readonly pDamped: number;
  /** The approach, exact: 0 a viewport out from the pin, 1 as the beat pins. */
  readonly pIn: number;
  /**
   * The approach, damped — THE ENTRANCE CLOCK. Every segment that brings
   * furniture on reads this one, so it has finished by the moment the beat
   * pins. A beat that is blank at the pin is a defect.
   */
  readonly dIn: number;
  /**
   * True when the reader has asked for reduced motion. Every clock above reads
   * 1, the beat is not pinned, and the page is an ordinary document. Branch on
   * this only for things the clocks cannot express — an `aria-busy`, a caption
   * that only makes sense mid-animation.
   */
  readonly reducedMotion: boolean;
  /** Eased 0..1 ramp between two points on a clock. See `seg` above. */
  readonly seg: typeof seg;
  /** Linear 0..1 ramp between two points on a clock. See `segLinear` above. */
  readonly segLinear: typeof segLinear;
  /** Smoothstep, for easing something that is not a segment. */
  readonly smooth: typeof smooth;
}

/**
 * Every clock at rest and full.
 *
 * Two jobs. It is the reduced-motion state — and it is also what renders on the
 * server and on the first client paint, before the engine has measured
 * anything. Both want the same thing: the composition whole. A journey that
 * server-rendered at zero would ship a blank document to a crawler and to
 * anyone whose JS failed, which is the prototype's `html.js` gate restated for
 * React.
 */
const RESTING_IN_MOTION: JourneyProgress = Object.freeze({
  raw: 1,
  pExact: 1,
  pDamped: 1,
  pIn: 1,
  dIn: 1,
  reducedMotion: false,
  seg,
  segLinear,
  smooth,
});
const RESTING_REDUCED: JourneyProgress = Object.freeze({ ...RESTING_IN_MOTION, reducedMotion: true });

function resting(reducedMotion: boolean): JourneyProgress {
  return reducedMotion ? RESTING_REDUCED : RESTING_IN_MOTION;
}

/* ── the shared engine ───────────────────────────────────────────────────── */

interface BeatRecord {
  readonly id: string;
  readonly name: string;
  el: HTMLElement | null;
  /** Forces the snap on this beat's first frame — see `jumped` below. */
  fresh: boolean;
  top: number;
  height: number;
  span: number;
  raw: number;
  pExact: number;
  pDamped: number;
  pIn: number;
  dIn: number;
  notify: () => void;
}

/** Frame-rate-independent damping constant, per second. The prototype's. */
const DAMPING = 9;

/**
 * Below this, damped adopts exact outright. Without it the damped value
 * approaches its target asymptotically and never arrives, so a page nobody is
 * scrolling would re-render forever at a difference no display can show.
 * 1e-4 of a beat is far under a pixel of any transform we drive.
 */
const SETTLE = 1e-4;

const beats = new Set<BeatRecord>();
let running = false;
let rafId = 0;
let prevNow = 0;
let lastY: number | null = null;
let viewport = 0;
let needsMeasure = true;
let pageWatch: ResizeObserver | null = null;

function docTop(el: HTMLElement): number {
  let y = 0;
  let node: HTMLElement | null = el;
  while (node) {
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return y;
}

const audited = new Set<string>();

/**
 * Re-measures every beat and reports whether anything moved enough to count as
 * a discontinuity rather than a scroll.
 *
 * It matters here in a way it did not in the prototype: that was one static
 * file, and this is a page whose fonts, images and CMS copy land after mount
 * and shift every beat below them. A top that jumps 300px while damping is
 * engaged would drag the whole composition across the screen catching up, so a
 * material move is treated exactly like an anchor jump. The 2px floor keeps a
 * sub-pixel reflow from disabling the damping every frame.
 */
function measureAll(): boolean {
  const nextViewport = window.innerHeight;
  let moved = Math.abs(nextViewport - viewport) > 2;
  viewport = nextViewport;

  beats.forEach((b) => {
    if (!b.el) return;
    const top = docTop(b.el);
    if (Math.abs(top - b.top) > 2) moved = true;
    b.top = top;
    b.height = b.el.offsetHeight;
    // At least 1, so a beat measured before layout can never divide by zero.
    b.span = Math.max(1, b.height - viewport);

    if (process.env.NODE_ENV !== 'production' && b.height > 0 && viewport > 0 && !audited.has(b.id)) {
      const length = b.height / viewport;
      if (length < 2.5) {
        audited.add(b.id);
        // The original defect, and the one the pacing harness checks for: at
        // ~1.3 viewports a small scroll runs the whole beat to completion and
        // the reader never sees the middle of it.
        console.warn(
          `[journey] beat "${b.id}" measures ${length.toFixed(1)}vh. Pinned beats need 250vh ` +
            `minimum, device-led beats 300vh+. See src/components/journey/README.md.`,
        );
      }
    }
  });

  return moved;
}

function approach(current: number, target: number, k: number): number {
  const next = current + (target - current) * k;
  return Math.abs(target - next) < SETTLE ? target : next;
}

function tick(dt: number): void {
  let snapAll = false;
  if (needsMeasure) {
    needsMeasure = false;
    snapAll = measureAll();
  }

  const y = window.scrollY || window.pageYOffset || 0;
  const k = 1 - Math.exp(-DAMPING * dt);

  /* A JUMP, not a scroll. An anchor link, a scrollbar drag, End, or a restored
     scroll position moves more than a whole viewport between two frames.
     Damping exists to smooth CONTINUOUS input; across a discontinuity it is
     only lag, and the reader would land mid-beat watching the composition catch
     up to where they already are. So on a jump — and on the very first frame,
     and on any reflow that moved a beat — damped adopts exact outright. Nothing
     a wheel or a trackpad can do reaches a viewport in one frame, so natural
     scrolling never trips this. */
  const jumped = snapAll || lastY === null || Math.abs(y - lastY) > viewport;
  lastY = y;

  beats.forEach((b) => {
    if (!b.el) return;
    const snap = jumped || b.fresh;
    b.fresh = false;

    const raw = clamp01((y - b.top) / b.span);
    const pExact = dwell(raw);
    const pIn = clamp01((y - (b.top - viewport)) / viewport);
    const pDamped = snap ? pExact : approach(b.pDamped, pExact, k);
    const dIn = snap ? pIn : approach(b.dIn, pIn, k);

    // Nothing moved: no re-render. Once a beat has settled, this is every frame
    // of it, which is what keeps eight mounted beats costing one live subtree.
    if (
      raw === b.raw &&
      pExact === b.pExact &&
      pDamped === b.pDamped &&
      pIn === b.pIn &&
      dIn === b.dIn
    ) {
      return;
    }

    b.raw = raw;
    b.pExact = pExact;
    b.pDamped = pDamped;
    b.pIn = pIn;
    b.dIn = dIn;
    b.notify();
  });
}

function invalidate(): void {
  needsMeasure = true;
}

function loop(now: number): void {
  if (!running) return;
  rafId = requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - prevNow) / 1000) || 0.016;
  prevNow = now;
  tick(dt);
}

function start(): void {
  if (running) return;
  running = true;
  prevNow = performance.now();
  window.addEventListener('resize', invalidate);
  window.addEventListener('orientationchange', invalidate);
  window.addEventListener('load', invalidate);
  if (typeof ResizeObserver !== 'undefined') {
    // Fonts, images and streamed content all change the document's height after
    // mount, and every beat below the change is then measured against a stale
    // top. A resize listener alone does not see any of it.
    pageWatch = new ResizeObserver(invalidate);
    pageWatch.observe(document.documentElement);
  }
  rafId = requestAnimationFrame(loop);
}

function stop(): void {
  if (!running) return;
  running = false;
  cancelAnimationFrame(rafId);
  window.removeEventListener('resize', invalidate);
  window.removeEventListener('orientationchange', invalidate);
  window.removeEventListener('load', invalidate);
  pageWatch?.disconnect();
  pageWatch = null;
  // A route change is a new page: the next beat to mount starts from a snap
  // rather than damping in from wherever the last one left the scroll.
  lastY = null;
  needsMeasure = true;
}

function register(record: BeatRecord): () => void {
  beats.add(record);
  needsMeasure = true;
  start();
  // One frame now, synchronously, inside the mounting beat's layout effect: the
  // beat is painted at its real progress rather than at the resting state it
  // server-rendered with. Skipping this is a visible pop on any beat that
  // mounts already on screen — a deep link, a back-navigation, a reload
  // partway down.
  tick(0.016);
  return () => {
    beats.delete(record);
    if (beats.size === 0) stop();
  };
}

/* ── the hook ────────────────────────────────────────────────────────────── */

// Layout, not passive: the first frame has to land before paint. React warns
// about useLayoutEffect on the server, where it would do nothing anyway.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export interface UseJourneyOptions {
  /** Stable identity. Published as `data-beat`; the pacing tools read it. */
  id: string;
  /** Human label, e.g. `03 THE SEVEN CHECKS`. Published as `data-beat-name`. */
  name: string;
}

export interface UseJourneyResult {
  /** Attach to the tall section. Its height and position are what is measured. */
  ref: React.RefObject<HTMLElement | null>;
  progress: JourneyProgress;
  /** True once mounted under `prefers-reduced-motion: reduce`. */
  reducedMotion: boolean;
}

/**
 * Subscribes one element to the shared engine. `<Beat>` is the component form
 * and what almost everything should use; this is here for a beat that needs
 * different markup around the same clocks.
 */
export function useJourney({ id, name }: UseJourneyOptions): UseJourneyResult {
  const ref = useRef<HTMLElement | null>(null);
  const [, force] = useState(0);
  // False on the server and through hydration, because the server cannot know.
  // The switch happens in a layout effect, so a reduced-motion reader never
  // paints the pinned layout — but hydration still matches the markup.
  const [reducedMotion, setReducedMotion] = useState(false);

  const recordRef = useRef<BeatRecord | null>(null);
  if (recordRef.current === null) {
    recordRef.current = {
      id,
      name,
      el: null,
      fresh: true,
      top: 0,
      height: 0,
      span: 1,
      // Seeded to the resting state the first render used, so the first tick
      // registers as a change and re-renders with the measured truth.
      raw: 1,
      pExact: 1,
      pDamped: 1,
      pIn: 1,
      dIn: 1,
      notify: () => {},
    };
  }
  const record = recordRef.current;

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    record.el = el;
    record.notify = () => force((n) => n + 1);

    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    let unregister: (() => void) | null = null;

    // Re-evaluated on change, not only on mount: the preference is a system
    // setting a reader can flip while the page is open, and the engine either
    // has to be running or has to have left every clock full.
    const apply = () => {
      const reduce = query.matches;
      setReducedMotion(reduce);
      if (reduce) {
        unregister?.();
        unregister = null;
        record.raw = 1;
        record.pExact = 1;
        record.pDamped = 1;
        record.pIn = 1;
        record.dIn = 1;
        force((n) => n + 1);
      } else if (!unregister) {
        record.fresh = true;
        unregister = register(record);
      }
    };

    apply();
    query.addEventListener('change', apply);

    return () => {
      query.removeEventListener('change', apply);
      unregister?.();
      record.el = null;
      record.notify = () => {};
    };
  }, [record]);

  const live = record.el !== null && !reducedMotion;

  return {
    ref,
    reducedMotion,
    progress: live
      ? {
          raw: record.raw,
          pExact: record.pExact,
          pDamped: record.pDamped,
          pIn: record.pIn,
          dIn: record.dIn,
          reducedMotion: false,
          seg,
          segLinear,
          smooth,
        }
      : resting(reducedMotion),
  };
}
