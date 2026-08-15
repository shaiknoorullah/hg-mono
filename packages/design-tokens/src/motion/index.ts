/**
 * Motion tokens — durations + easings, shaped for every animation runtime this
 * repo actually uses:
 *   - CSS / Framer Motion (web)        → string values (ms, cubic-bezier(...))
 *   - React Native Reanimated (native) → Easing.bezier(x1, y1, x2, y2) tuples
 *   - Moti (native, wraps Reanimated)  → same tuples, plus a ready `transition` shape
 *
 * Source of truth is tokens/tokens.json §motion, generated into
 * ../generated/tokens.ts as `duration` (ms, numbers) and `easing`
 * (cubic-bezier control points). This module adds no new values — it only
 * reshapes the generated ones per-runtime so nobody hand-writes a
 * cubic-bezier or a duration literal at a call site.
 */
import { duration, easing, type DurationToken, type EasingToken } from '../generated/tokens.js';

export { duration, easing };
export type { DurationToken, EasingToken };

// ---------------------------------------------------------------------------
// CSS / Framer Motion
// ---------------------------------------------------------------------------

/** `"180ms"` etc — drop straight into a CSS `transition-duration` or inline style. */
export const durationMs = Object.fromEntries(
  Object.entries(duration).map(([k, v]) => [k, `${v}ms`]),
) as Record<DurationToken, string>;

/** `"cubic-bezier(0.2, 0, 0, 1)"` — CSS `transition-timing-function` / Framer `ease`. */
export const easingCss = Object.fromEntries(
  Object.entries(easing).map(([k, v]) => [k, `cubic-bezier(${v.join(', ')})`]),
) as Record<EasingToken, string>;

/**
 * Framer Motion `transition` prop, in *seconds* (Framer's unit), for a given
 * duration/easing pair. Framer accepts a cubic-bezier tuple directly as `ease`.
 */
export function framerTransition(d: DurationToken = 'base', e: EasingToken = 'standard') {
  return { duration: duration[d] / 1000, ease: easing[e] as unknown as [number, number, number, number] };
}

// ---------------------------------------------------------------------------
// React Native — Reanimated / Moti
// ---------------------------------------------------------------------------

/**
 * Reanimated's `Easing.bezier(x1, y1, x2, y2)` takes the same four control
 * points DTCG's `cubicBezier` type stores. Call with the Easing module
 * (kept as a peer — this package does not depend on react-native):
 *
 *   import { Easing } from 'react-native-reanimated';
 *   withTiming(1, { duration: duration.base, easing: reanimatedEasing(Easing, 'standard') })
 */
export function reanimatedEasing(
  Easing: { bezier: (x1: number, y1: number, x2: number, y2: number) => unknown },
  name: EasingToken = 'standard',
) {
  const [x1, y1, x2, y2] = easing[name];
  return Easing.bezier(x1, y1, x2, y2);
}

/** Ready-made `withTiming` config: `{ duration, easing }` once wrapped through `reanimatedEasing`. */
export function reanimatedTiming(
  Easing: { bezier: (x1: number, y1: number, x2: number, y2: number) => unknown },
  d: DurationToken = 'base',
  e: EasingToken = 'standard',
) {
  return { duration: duration[d], easing: reanimatedEasing(Easing, e) };
}

/**
 * Moti's `transition` prop. Moti defaults to a spring; pass `type: 'timing'`
 * plus this shape for anything that must match the web easing curves exactly
 * (most enter/exit — reserve real springs for the cases in §7.3 of
 * docs/design/01-foundations.md: press feedback, offer-card entrance, the
 * cart-bar morph).
 */
export function motiTiming(d: DurationToken = 'base', e: EasingToken = 'standard') {
  return { type: 'timing' as const, duration: duration[d], easing: easingCss[e] };
}

// ---------------------------------------------------------------------------
// Reduced motion
// ---------------------------------------------------------------------------

/**
 * docs/design/01-foundations.md §7.4: `prefers-reduced-motion` /
 * `isReduceMotionEnabled` collapses all durations to 0ms and replaces
 * slide/scale with a cross-fade at `duration.fast`. Countdown numerals keep
 * updating — call sites must not gate the countdown text itself on this flag,
 * only the decorative motion around it.
 */
export function withReducedMotion<T extends { duration: number }>(transition: T, reduced: boolean): T {
  if (!reduced) return transition;
  return { ...transition, duration: duration.fast };
}

/** Two named presets matching the rule above: full motion, or reduced (fast cross-fade only). */
export const reducedMotionFallback = {
  duration: duration.fast,
  easing: easing.standard,
} as const;
