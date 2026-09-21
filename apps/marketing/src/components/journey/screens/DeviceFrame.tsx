import type { CSSProperties, ReactNode, Ref } from 'react';

/**
 * The handset, and the three pieces of furniture every device screen shares.
 *
 * These components are PRESENTATIONAL and deliberately dumb: they take numbers
 * and render. Nothing here reads scroll, observes an element or imports the
 * journey engine, because the engine is the only thing allowed to own a clock
 * and a screen that owned one too would be a second, disagreeing source of
 * truth for the same beat.
 *
 * The division of labour with the engine is the one the G3 prototype learned
 * the hard way (experiments/hero-journey/README.md):
 *
 *   DAMPED progress  → `reveal`. Everything continuous: a blank filling, a
 *                      band drawing, an opacity. Smoothing a transform is what
 *                      damping is for.
 *   EXACT progress   → the discrete prop beside it (`certified`, `scanned`,
 *                      `stepsDone`). How many things are ticked is a count, and
 *                      a count must not lag behind the reader's scroll — a
 *                      damped value crossing a threshold late reads as the page
 *                      hesitating.
 *
 * Each screen therefore takes both, never one value standing in for both, and
 * each exports the thresholds the engine must compare exact progress against so
 * the numbers cannot drift from the approved prototype.
 *
 * THE RANGE EVERY SCREEN SPENDS, and why it is the whole of it. `reveal` is
 * already dwelled: the engine holds the first and last fifth of a beat's raw
 * scroll still, so that a reader who stops has something that is not moving
 * under them. A screen that then started its first row at clock 0.26 and
 * finished its last at 0.78 — which is what the prototype's j02 did, and what
 * this port inherited verbatim — holds a SECOND time on top of that, and the
 * two compound. Measured on the built page: 2,880px of `j-sealed` carrying
 * 622px of motion, 78% of the beat frozen, 7 distinct states in 25 samples.
 *
 * So every screen here now spans 0 to ~0.96 of the clock, with the same
 * internal rhythm it was drawn with — each screen's segments were rescaled
 * onto the full range rather than re-choreographed. The dwell is the hold; a
 * screen must not hold again. A screen added later should start its first
 * segment at 0 and finish its last near 1 for the same reason.
 *
 * This is a deliberate departure from the G3 prototype's numbers and the only
 * one in the port besides `Overture`'s. It changes pacing, not choreography:
 * the order, the stagger and every threshold's position RELATIVE to the others
 * are exactly the prototype's.
 *
 * The other rule the screens exist to satisfy: a beat must never be blank when
 * it pins. So at `reveal = 0` a screen still renders its frame, its labels and
 * its headings in full — only the VALUES arrive with `reveal`. The entrance
 * (the handset itself sliding into place) runs on the engine's approach clock
 * and is finished before the pinned scroll begins.
 */

/** Props shared by every device screen. */
export type ScreenProps = {
  /**
   * Damped pinned progress, 0..1. Owns everything continuous on the screen.
   * At 0 the screen is whole but empty of values; at 1 it is fully written.
   */
  reveal: number;
  /**
   * Caption set flat beneath the handset. It sits OUTSIDE the perspective
   * wrapper on purpose: G3 shows one device at a time, tipped in space, with
   * its caption square to the page — if the caption rode the transform it would
   * tip with the phone and stop being a caption.
   */
  caption?: string;
  /**
   * The handset element, and the only node the engine transforms. Handed out as
   * a ref rather than a `style` prop so the engine can write a transform every
   * frame without re-rendering React sixty times a second.
   */
  ref?: Ref<HTMLDivElement>;
  className?: string;
};

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * The prototype's `seg`: a clamped linear ramp of `p` across [a, b].
 *
 * Every screen distributes its single `reveal` over its own rows with this, so
 * the stagger lives with the markup it staggers rather than in the engine. The
 * engine stays generic — it hands each beat one damped number and knows nothing
 * about how many blanks that beat has.
 */
export function seg(p: number, a: number, b: number): number {
  if (b <= a) return p >= b ? 1 : 0;
  return clamp01((p - a) / (b - a));
}

/**
 * A ruled blank: the shape of a value with the value withheld.
 *
 * Every field on these screens that would carry real data is one of these. We
 * have not opened, so there is no restaurant to name, no certificate number and
 * no rider — and a mocked-up one on the page whose entire claim is "we check
 * things carefully" is the argument against us. The blank is the honest render
 * of a field we cannot fill, and it is the same device RecordCard uses.
 *
 * It fills by `scaleX` from the left, so a row writes itself the way a pen
 * would. `decorative` drops it out of the accessibility tree: a menu row's
 * price blank carries no meaning a screen reader needs six times over.
 */
export function Blank({
  ch,
  fill,
  decorative = false,
}: {
  /** Width in characters, so a row of blanks reads as a form with the values
   *  omitted rather than a row of identical placeholder bars. */
  ch: number;
  /** 0..1 — how much of the rule has been drawn. */
  fill: number;
  decorative?: boolean;
}) {
  const style: CSSProperties = {
    width: `${ch}ch`,
    maxWidth: '100%',
    transform: `scaleX(${clamp01(fill).toFixed(3)})`,
  };
  const className =
    'inline-block h-0 origin-left border-t border-dashed border-line-interactive align-[0.32em] opacity-60 will-change-transform';

  return decorative ? (
    <span aria-hidden="true" className={className} style={style} />
  ) : (
    <span role="img" aria-label="not yet published" className={className} style={style} />
  );
}

/** The small tracked label above a block on a device screen. */
export function ScreenLabel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={`m-0 font-mono text-[10.5px] leading-tight font-medium tracking-[0.07em] text-mk-ink uppercase ${className}`}
    >
      {children}
    </p>
  );
}

/**
 * The handset shell.
 *
 * Rounded, bezelled, and bearing no brand mark, no notch, no status bar and no
 * home indicator — every one of those is a claim about a device we do not make,
 * and a notch in particular dates the mock the moment hardware changes.
 *
 * Light theme puts a dark body around a cream screen; dark theme inverts both
 * together, which keeps the body/screen contrast that makes the shape read as a
 * phone instead of a card.
 */
export function DeviceFrame({
  children,
  caption,
  busy,
  ref,
  className = '',
}: {
  children: ReactNode;
  caption?: string;
  /** Set while values are still arriving, so a screen reader is not read a
   *  half-written record. The screens set this themselves from `reveal`. */
  busy?: boolean;
  ref?: Ref<HTMLDivElement>;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center [perspective:1400px] ${className}`}>
      <div
        ref={ref}
        className="h-[468px] w-[228px] flex-none rounded-[38px] border-2 border-surface-sunken bg-surface-inverse p-2 [transform-origin:50%_50%] will-change-transform"
      >
        <div
          aria-busy={busy}
          className="flex h-full w-full flex-col gap-3 overflow-hidden rounded-[28px] bg-surface-base px-4 pt-[26px] pb-4 text-fg-primary"
        >
          {children}
        </div>
      </div>

      {caption ? (
        <p className="relative z-[2] m-0 mt-6 font-mono text-[12px] leading-none font-medium tracking-[0.06em] text-mk-ink uppercase lg:mt-10">
          {caption}
        </p>
      ) : null}
    </div>
  );
}
