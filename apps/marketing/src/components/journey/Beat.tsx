'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useJourney, type JourneyProgress } from '@/components/journey/useJourney';

export interface BeatProps {
  /** Stable identity, published as `data-beat`. The pacing tools read it. */
  id: string;
  /**
   * Human label, published as `data-beat-name` — `03 THE SEVEN CHECKS`. It is
   * what `dead-scroll.mjs` and the verification harness name in their output,
   * so a beat with a vague one is a beat nobody can find in a report.
   */
  name: string;
  /**
   * The beat's length in viewport units, and the whole of its pacing budget:
   * travel is `vh - 100`, and the dwell holds the first and last 20% of that
   * still. 250 is the floor for anything pinned and 300 the floor for a
   * device-led beat; the seven-check instrument in the prototype runs 560.
   * Below 250 a small scroll runs the entire beat to completion.
   */
  vh?: number;
  /**
   * Where the composition sits in the pinned stage. `top` for a beat with a
   * heading above a tall instrument that would otherwise centre off-screen.
   */
  align?: 'center' | 'top';
  /** On the tall section — the background, which is what the reader sees. */
  className?: string;
  /** On the pinned stage. `overflow-visible` and `justify-*` both land here. */
  stageClassName?: string;
  /** Id of the heading that names this beat, for `aria-labelledby`. */
  labelledBy?: string;
  children: (progress: JourneyProgress) => ReactNode;
}

/**
 * One pinned beat of the scroll journey: a tall section with a sticky stage
 * inside it, and a render prop that is called with the beat's clocks.
 *
 * A beat pins so that something can happen WHILE it is held. What that
 * something is decides which clock a segment reads, and getting it backwards is
 * the defect this component exists to make hard:
 *
 *   - Furniture ARRIVING — a device flying in, lines printing onto a band, a
 *     card appearing — runs on `dIn`, the approach clock, and is therefore
 *     finished at the moment the beat pins. At that moment the composition must
 *     already be whole and still.
 *   - The NARRATIVE — checks recording themselves, blanks filling, a device
 *     changing screens — runs on `pDamped` and `pExact`, the pinned clocks.
 *
 * A beat with nothing on the pinned clocks is a viewport of frozen scroll and
 * reads as broken. A beat that is blank at the pin is the same defect from the
 * other side. Both are checked by the harness in `experiments/hero-journey`.
 *
 * Under `prefers-reduced-motion: reduce` this is not a frozen animation: the
 * section loses its height, the stage loses its stickiness, every clock reads
 * 1, and what is left is an ordinary readable document.
 */
// The fit below has to be applied before paint, or a short viewport shows one
// frame of the cropped composition. React warns about useLayoutEffect on the
// server, where it would do nothing anyway.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Scales the composition down when the stage is shorter than it is.
 *
 * A pinned stage is exactly one viewport tall minus its bottom reserve, and the
 * composition inside it is a fixed design — a step counter, a heading, a 468px
 * handset, a caption and a rule. Below about 736px of viewport height at
 * desktop width those do not fit, and because the stage centres them the
 * overflow is cropped at BOTH ends: measured at 1024x700, 17px off the step
 * counter and 17px off the closing rule. A 1366x768 laptop reaches that as soon
 * as browser chrome takes its ~130px.
 *
 * Scaling rather than reflowing, because the composition is a drawing of a
 * phone and not a layout: re-stacking it at a short height would give a
 * different picture, and the prototype's own answer to a short laptop was to
 * scale the device rather than crop it. Measured off the LAYOUT box, which a
 * transform does not change, so there is no feedback loop between the scale and
 * what it is measuring.
 */
function useStageFit(reducedMotion: boolean) {
  const content = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);

  useIsomorphicLayoutEffect(() => {
    const el = content.current;
    const stage = el?.parentElement;
    if (reducedMotion || !el || !stage) {
      setFit(1);
      return;
    }

    const measure = () => {
      const box = getComputedStyle(stage);
      const avail =
        stage.clientHeight - parseFloat(box.paddingTop || '0') - parseFloat(box.paddingBottom || '0');
      const need = el.offsetHeight;
      setFit(need > 0 && avail > 0 ? Math.min(1, avail / need) : 1);
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    // Both boxes: the stage changes with the viewport and with the bottom
    // reserve the consent notice publishes, the content with fonts and copy.
    const watch = new ResizeObserver(measure);
    watch.observe(stage);
    watch.observe(el);
    return () => watch.disconnect();
  }, [reducedMotion]);

  return { content, fit };
}

export function Beat({
  id,
  name,
  vh = 300,
  align = 'center',
  className,
  stageClassName,
  labelledBy,
  children,
}: BeatProps) {
  const { ref, progress, reducedMotion } = useJourney({ id, name });
  const { content, fit } = useStageFit(reducedMotion);

  return (
    <section
      ref={ref}
      data-beat={id}
      data-beat-name={name}
      aria-labelledby={labelledBy}
      // `relative` so the sticky stage resolves against this section and not
      // against some ancestor further up the page.
      className={cn('relative', className)}
      style={reducedMotion ? undefined : { height: `${vh}vh` }}
    >
      <div
        data-beat-stage={id}
        className={cn(
          'flex flex-col',
          reducedMotion
            ? 'py-14'
            : // `svh` rather than `dvh`: a dynamic viewport unit re-heights the
              // stage every time mobile browser chrome hides or returns, which
              // reflows a pinned composition mid-beat. `svh` is stable.
              'sticky top-0 h-[100svh] overflow-hidden',
          !reducedMotion && (align === 'top' ? 'justify-start pt-[clamp(24px,7vh,64px)]' : 'justify-center'),
          stageClassName,
        )}
        // The sticky signup bar publishes its own measured height as
        // `--sticky-cta-h` and the consent notice its own as `--hg-consent-h`;
        // every pinned stage reserves whichever is taller or that corner crops
        // the bottom of the composition. Not optional — both were real
        // defects, the notice taking 29px off the caption at 1024.
        //
        // `max()`, not a sum: only one of them is ever up, because the bar
        // stands down while the notice is. The bar's own reserve is CONSTANT
        // rather than tied to whether it is currently shown: a padding that
        // toggled with it would jog every pinned composition each time the bar
        // came and went.
        style={
          reducedMotion
            ? undefined
            : { paddingBottom: 'max(var(--sticky-cta-h, 0px), var(--hg-consent-h, 0px))' }
        }
      >
        <div
          ref={content}
          className="flex w-full flex-col"
          // Only written when it is needed, so a stage that fits carries no
          // transform and no rasterisation cost. Scaled about its own centre,
          // which is where the stage already centres it.
          style={fit < 1 ? { scale: fit.toFixed(4) } : undefined}
        >
          {children(progress)}
        </div>
      </div>
    </section>
  );
}
