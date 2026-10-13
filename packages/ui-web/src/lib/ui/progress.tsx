/**
 * shadcn/ui `Progress` on Radix, plus an indeterminate mode (value `null`) for "loading, no
 * known amount": a 40% bar sweeping across the track. The sweep is driven by the Web
 * Animations API so it needs no keyframes in the shared stylesheet, and it holds still under
 * `prefers-reduced-motion` (the full bar then shows, which still reads as "busy").
 */

import * as ProgressPrimitive from '@radix-ui/react-progress';
import { useEffect, useRef, type ComponentProps } from 'react';

import { cn } from '../utils.js';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** A progress bar. `value={null}` is indeterminate; Radix then omits aria-valuenow. */
export function Progress({
  className,
  value,
  indicatorClassName,
  ...props
}: ComponentProps<typeof ProgressPrimitive.Root> & { indicatorClassName?: string }) {
  const indicator = useRef<HTMLDivElement>(null);
  const indeterminate = value === null || value === undefined;

  useEffect(() => {
    const el = indicator.current;
    if (!indeterminate || !el || typeof el.animate !== 'function' || prefersReducedMotion()) return;
    const animation = el.animate(
      [{ transform: 'translateX(-100%)' }, { transform: 'translateX(250%)' }],
      { duration: 1400, iterations: Infinity, easing: 'linear' },
    );
    return () => animation.cancel();
  }, [indeterminate]);

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn('relative h-0.5 w-full overflow-hidden bg-transparent', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        ref={indicator}
        data-slot="progress-indicator"
        className={cn(
          'h-full bg-action-primary-bg',
          indeterminate ? 'w-2/5 motion-reduce:w-full' : 'w-full transition-transform',
          indicatorClassName,
        )}
        style={indeterminate ? undefined : { transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
