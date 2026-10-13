/**
 * `StatCard` — one headline number with its label (owner-approved, decisions row 28 Sep;
 * #195). Drawn on admin Orders and Refunds and rider Earnings: trips, online time, gross
 * earnings. Built on the design-system `Card` (outlined) and `Price`.
 *
 * - Money goes through `Price` only (`cents`, integer, at `display-lg` by default); any other
 *   figure is `value`. A missing figure shows `emptyValue` ("Not reported"), never zero.
 * - `loading` keeps the label and shows a skeleton at the figure's height; the card is
 *   `aria-busy`.
 * - `error` replaces the figure with the reason in secondary text and the warning glyph. It is
 *   not red: a stat that failed to load is not a danger.
 * - `tone="warning"` draws the card on the warning tint for a figure that needs attention (a
 *   residual the server reports). It is a tint with a border, never a solid fill, and the
 *   `helper` (or `hint`) must say why: colour is never the only signal.
 * - A group with a name (`role="group"`, labelled by the label), so the label is read with
 *   its figure.
 */

import { useId, type CSSProperties, type ReactNode } from 'react';

import { SkeletonBlock } from '../lib/ui/skeleton.js';
import { cn } from '../lib/utils.js';
import { Card } from './Card.js';
import { Icon, type DsIconName } from './Icon.js';
import { Price, type PriceSize } from './Price.js';

/** Props of the approved `StatCard`. */
export interface StatCardProps {
  /** What the figure counts ("Trips", "Gross earnings"). */
  label: ReactNode;
  /** A non-money figure, already formatted ("14", "6 h 20 min"). */
  value?: ReactNode;
  /** A money figure in integer cents; rendered through Price. Takes precedence over `value`. */
  cents?: number | null;
  /** Price size for `cents`. Default `display-lg`. */
  priceSize?: PriceSize;
  /** Context under the figure ("This week", "Before fees"). */
  helper?: ReactNode;
  /** Alias of `helper` (the admin canvases' name). `helper` wins when both are given. */
  hint?: ReactNode;
  /** neutral (default) or warning: the warning tint, never a solid. */
  tone?: 'neutral' | 'warning';
  /** Optional Solar glyph beside the label. */
  icon?: DsIconName;
  /** Shown when neither `value` nor `cents` is given. Default "Not reported". */
  emptyValue?: ReactNode;
  loading?: boolean;
  /** Why the figure could not be loaded. */
  error?: ReactNode;
  /** Card surface: outlined (default) or filled. */
  variant?: 'outlined' | 'filled' | 'elevated';
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

/** One labelled headline figure. */
export function StatCard({
  label,
  value,
  cents,
  priceSize = 'display-lg',
  helper: helperProp,
  hint,
  tone = 'neutral',
  icon,
  emptyValue = 'Not reported',
  loading = false,
  error,
  variant = 'outlined',
  testId = 'StatCard',
  style,
  className,
}: StatCardProps) {
  const labelId = useId();
  const helper = helperProp ?? hint;
  // A server `null` on a money field is a missing figure: "Not reported", never a blank card.
  const hasCents = cents !== undefined && cents !== null;
  const hasFigure = hasCents || (value !== undefined && value !== null && value !== '');

  let figure: ReactNode;
  if (loading) figure = <SkeletonBlock className="h-9 w-32" />;
  else if (error) {
    figure = (
      <span className="inline-flex items-center gap-2 text-body-md text-fg-secondary">
        <Icon name="warning" size="md" className="text-feedback-warning-icon" testId="StatCard-icon" />
        {error}
      </span>
    );
  } else if (hasCents) figure = <Price cents={cents} size={priceSize} testId="StatCard-price" />;
  else if (hasFigure) figure = <span className="text-display-md font-bold tabular-nums">{value}</span>;
  else figure = <span className="text-body-md text-fg-secondary">{emptyValue}</span>;

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-busy={loading || undefined}
      data-testid={testId}
      data-tone={tone}
      data-state={loading ? 'loading' : error ? 'error' : hasFigure ? 'ready' : 'empty'}
      className={cn('min-w-0', className)}
      style={style}
    >
      <Card
        variant={variant}
        testId={`${testId}-card`}
        className={tone === 'warning' ? 'border border-feedback-warning-border bg-feedback-warning-tint' : undefined}
      >
        <div className="flex flex-col gap-1">
          <span id={labelId} className="inline-flex items-center gap-1.5 text-label-md text-fg-secondary">
            {icon ? <Icon name={icon} size="sm" testId="StatCard-icon" /> : null}
            {label}
          </span>
          <span className="min-h-9 text-fg-primary">{figure}</span>
          {helper && !loading ? <span className="text-body-sm text-fg-secondary">{helper}</span> : null}
        </div>
      </Card>
    </div>
  );
}
