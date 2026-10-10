/**
 * TEMPORARY stub until @hg/ui-web/ds ships StatCard (ds-request issue TBD; tracked under #195).
 * Props follow the canvases' drawing ("StatCard (approved for the system)": Authorised /
 * Captured / Refunded tiles on the order's payment card).
 *
 * A filled tile with a label, a value (pass `<Price cents>` for money; never format money
 * here) and an optional hint. Read in order as "label, value, hint".
 */
import type { ReactNode } from 'react';

import { cx } from './internal/cx';

export interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** neutral (default) or warning (e.g. a residual the server reports). Never a solid fill. */
  tone?: 'neutral' | 'warning';
  className?: string;
  testId?: string;
}

export function StatCard({ label, value, hint, tone = 'neutral', className, testId = 'StatCard' }: StatCardProps): React.JSX.Element {
  return (
    <div
      role="group"
      aria-label={label}
      data-testid={testId}
      className={cx(
        'flex min-w-0 flex-col gap-1 rounded-md px-4 py-3',
        tone === 'warning' ? 'bg-feedback-warning-tint border border-feedback-warning-border' : 'bg-surface-subtle',
        className,
      )}
    >
      <span className="text-body-sm text-fg-secondary">{label}</span>
      <span className="text-heading-sm font-semibold text-fg-primary">{value}</span>
      {hint ? <span className="text-body-sm text-fg-secondary">{hint}</span> : null}
    </div>
  );
}
