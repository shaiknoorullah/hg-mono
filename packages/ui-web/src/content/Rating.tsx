/**
 * `Rating` — component 21, `02-components.md` Tier 3.
 *
 * The accessible name is one string — "4.6 out of 5 stars, 312 reviews" — never five separate
 * star nodes, which is what a naive implementation produces and what makes a rating unreadable
 * by speech.
 *
 * `value === null` is not "0 stars": the contract nulls `rating_avg` below five reviews so the
 * client renders "New" rather than inventing a number.
 */
import * as RadioGroup from '@radix-ui/react-radio-group';
import { cx, FOCUS_RING, ICON, TABULAR } from '../certification/internal/token-style';

export type RatingSize = 'sm' | 'md' | 'lg';
export type RatingVariant = 'display' | 'stars' | 'input';

interface RatingBaseProps {
  /** 0–5 to one decimal place. `null` when the server withheld it (fewer than five reviews). */
  value: number | null | undefined;
  count?: number | null | undefined;
  size?: RatingSize | undefined;
  showCount?: boolean | undefined;
  className?: string | undefined;
}

export type RatingProps =
  | (RatingBaseProps & { variant?: 'display' | 'stars'; onChange?: never })
  | (RatingBaseProps & { variant: 'input'; onChange: (value: number) => void; label?: string });

const SIZE_CLASS: Readonly<Record<RatingSize, string>> = {
  sm: 'text-body-sm',
  md: 'text-body-md',
  lg: 'text-heading-sm',
};

const ICON_SIZE: Readonly<Record<RatingSize, string>> = {
  sm: ICON.sm,
  md: ICON.md,
  lg: ICON.lg,
};

export function Rating(props: RatingProps): React.JSX.Element {
  const { value, count, size = 'md', showCount = true, className } = props;
  const variant = props.variant ?? 'display';

  if (variant === 'input') {
    const { onChange, label = 'Your rating' } = props as Extract<
      RatingProps,
      { variant: 'input' }
    >;
    return (
      <RadioGroup.Root
        data-testid="Rating"
        aria-label={label}
        className={cx('flex items-center gap-1', className)}
        value={value != null ? String(Math.round(value)) : ''}
        onValueChange={(v) => onChange(Number(v))}
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <RadioGroup.Item
            key={star}
            value={String(star)}
            aria-label={`${star} ${star === 1 ? 'star' : 'stars'}`}
            className={cx(
              'inline-flex items-center justify-center rounded-sm min-h-11 min-w-11',
              FOCUS_RING,
            )}
          >
            <Star filled={value != null && star <= Math.round(value)} size={ICON_SIZE[size]} />
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    );
  }

  // C-13 / C-09: "New" is a state, not a zero.
  if (value == null) {
    return (
      <span
        data-testid="Rating"
        className={cx('inline-flex items-center gap-1', SIZE_CLASS[size], 'text-fg-secondary', className)}
      >
        <span aria-hidden="true">New</span>
        <span className="sr-only">
          Not yet rated{count ? `, ${count} reviews` : ''}
        </span>
      </span>
    );
  }

  const shown = value.toFixed(1);
  const accessibleName = `${shown} out of 5 stars${
    count != null ? `, ${count} ${count === 1 ? 'review' : 'reviews'}` : ''
  }`;

  return (
    <span
      data-testid="Rating"
      className={cx('inline-flex items-center gap-1', SIZE_CLASS[size], 'text-fg-primary', className)}
      style={TABULAR}
    >
      <span aria-hidden="true" className="inline-flex items-center gap-1">
        {variant === 'stars' ? (
          [1, 2, 3, 4, 5].map((star) => (
            <Star key={star} filled={star <= Math.round(value)} size={ICON_SIZE[size]} />
          ))
        ) : (
          <Star filled size={ICON_SIZE[size]} />
        )}
        {variant === 'display' ? <span>{shown}</span> : null}
        {showCount && count != null ? (
          <span className="text-fg-secondary">({count})</span>
        ) : null}
      </span>
      <span className="sr-only">{accessibleName}</span>
    </span>
  );
}

function Star({ filled, size }: { filled: boolean; size: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9L3.5 9.7l5.9-.8L12 3.5Z" />
    </svg>
  );
}
