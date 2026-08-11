import {
  forwardRef,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { cx } from './utils/cx.js';
import { HG_FOCUS, focusOn } from './utils/focus.js';
import { Spinner } from './Spinner.js';

/**
 * IconButton — 02-components.md §2. A control whose only content is an icon.
 *
 * `accessibilityLabel` is REQUIRED and the type system enforces it: an icon
 * with no name is a control a screen-reader user cannot use, and it is the
 * single most common way an icon-only toolbar becomes unusable. The icon
 * itself is always aria-hidden.
 *
 * The hit area is never smaller than the size token even when the glyph is
 * 20px — the `::after` overlay grows the target without growing the visual
 * (04-accessibility.md §2).
 *
 * States: default · hover · focus-visible · active · disabled · loading.
 * `error` n/a — stated explicitly (rule 0.1).
 */

export type IconButtonVariant = 'plain' | 'filled' | 'tonal';
export type IconButtonSize = 'sm' | 'md' | 'lg';

const SIZE: Record<IconButtonSize, { box: string; glyph: number }> = {
  sm: { box: 'size-9', glyph: 16 },
  md: { box: 'size-11', glyph: 20 },
  lg: { box: 'size-14', glyph: 24 },
};

const VARIANT: Record<IconButtonVariant, string> = {
  plain: 'bg-transparent text-fg-secondary',
  filled: cx('bg-action-primary-bg text-action-primary-fg', focusOn.brand),
  tonal: 'bg-surface-subtle text-fg-primary',
};

interface IconButtonOwnProps {
  icon: ReactNode;
  /** Required. No default — an unnamed icon control is a defect, not a style. */
  accessibilityLabel: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** `true` for a dot, a number for a count. Folded into the accessible name. */
  badge?: boolean | number;
  loading?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  className?: string;
}

export type IconButtonProps = IconButtonOwnProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof IconButtonOwnProps | 'type' | 'aria-label'>;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon,
    accessibilityLabel,
    variant = 'plain',
    size = 'md',
    badge,
    loading = false,
    disabled = false,
    onPress,
    onClick,
    className,
    ...rest
  },
  ref,
) {
  const inert = disabled || loading;
  const { box, glyph } = SIZE[size];

  // A count badge belongs INSIDE the accessible name ("Cart, 3 items"), never
  // as a separate node (02-components.md §9).
  const name =
    typeof badge === 'number' ? `${accessibilityLabel}, ${badge}` : accessibilityLabel;

  const block = (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <button
      ref={ref}
      type="button"
      aria-label={name}
      aria-disabled={inert || undefined}
      aria-busy={loading || undefined}
      data-testid="hg-icon-button"
      data-variant={variant}
      data-size={size}
      onClick={(event) => {
        if (inert) return block(event);
        onClick?.(event);
        onPress?.();
      }}
      className={cx(
        'group relative inline-flex shrink-0 items-center justify-center rounded-full',
        'transition-colors duration-[var(--hg-duration-fast)] ease-standard',
        // Hit area never smaller than the size token, even for a 16px glyph.
        'after:absolute after:inset-0 after:min-h-11 after:min-w-11 after:-translate-y-1/2 after:top-1/2 after:content-[""]',
        box,
        VARIANT[variant],
        HG_FOCUS,
        !inert && 'hover:bg-[var(--hg-state-hover-overlay)] active:bg-[var(--hg-state-pressed-overlay)]',
        inert && 'cursor-not-allowed opacity-(--hg-state-disabled-opacity)',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Spinner size="sm" decorative />
      ) : (
        <span aria-hidden="true" className="inline-flex" style={{ width: glyph, height: glyph }}>
          {icon}
        </span>
      )}
      {badge !== undefined && badge !== false ? (
        <span
          aria-hidden="true"
          data-hg-badge={typeof badge === 'number' ? 'count' : 'dot'}
          className={cx(
            'absolute -top-0.5 end-0 flex items-center justify-center rounded-full',
            'bg-feedback-danger-solid text-feedback-danger-on-solid',
            typeof badge === 'number' ? 'min-w-4 px-1 text-label-sm' : 'size-2',
          )}
        >
          {typeof badge === 'number' ? badge : null}
        </span>
      ) : null}
    </button>
  );
});
