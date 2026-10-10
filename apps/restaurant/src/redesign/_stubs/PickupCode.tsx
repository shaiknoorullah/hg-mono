/**
 * TEMPORARY STUB for the proposed DS `PickupCode` (ds-request(web): #674 or #675). Delete
 * when `@hg/ui-web/proposed` exports it.
 *
 * LO `Ready-rider-here`: box surface-raised, border-interactive; label "Pickup code" 15/600
 * secondary; the code mono 40/48, 600, letter-spacing 0.24em, tabular; help 15/22. Its
 * accessible name reads the code character by character ("Pickup code 4 8 2 7") so a screen
 * reader never says "four thousand eight hundred…".
 */
import type { ReactNode } from 'react';

export interface PickupCodeProps {
  code: string;
  help?: ReactNode;
  label?: string;
  testId?: string;
}

export function PickupCode({ code, help, label = 'Pickup code', testId }: PickupCodeProps) {
  const spoken = `${label} ${code.split('').join(' ')}`;
  return (
    <div data-testid={testId} className="rounded-md border border-line-interactive bg-surface-raised px-3 py-2.5">
      <div role="group" aria-label={spoken}>
        <p aria-hidden="true" className="text-[15px] font-semibold text-fg-secondary">
          {label}
        </p>
        <p aria-hidden="true" className="font-mono text-[40px] font-semibold leading-[48px] tracking-[0.24em] tabular-nums">
          {code}
        </p>
      </div>
      {help ? <p className="mt-1 text-[15px] leading-[22px]">{help}</p> : null}
    </div>
  );
}
