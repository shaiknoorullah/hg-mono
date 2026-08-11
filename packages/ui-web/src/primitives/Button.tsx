import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { cx } from './utils/cx.js';
import { HG_FOCUS, focusOn } from './utils/focus.js';
import { Spinner } from './Spinner.js';

/**
 * Button — 02-components.md §1.
 *
 * There is NO `success` variant. RULE H-1 (01-foundations.md §2.5) reserves
 * solid green to the halal namespace; a "confirm" action uses `primary`. The
 * variant union below is the enforcement — a `success` button does not type-check.
 *
 * States (the closed set of rule 0.1, all implemented):
 *   default        as variant
 *   hover          state.hoverOverlay composited over the fill
 *   focus-visible  two-layer ring, radius + 2
 *   active         state.pressedOverlay + scale 0.98 at duration.instant
 *   disabled       state.disabledOpacity + aria-disabled (NOT the disabled
 *                  attribute — a disabled button must stay focusable so it can
 *                  explain itself; 04-accessibility.md §5)
 *   loading        spinner replaces iconStart, label stays visible, width
 *                  frozen, aria-busy, re-entry ignored
 *   error          n/a — a button has no error state of its own; the error
 *                  belongs to the field or the region it submits. Stated
 *                  explicitly rather than silently absent (rule 0.1).
 */

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

const VARIANT: Record<ButtonVariant, string> = {
  primary: cx('bg-action-primary-bg text-action-primary-fg', focusOn.brand),
  secondary: cx('bg-action-secondary-bg text-action-secondary-fg', focusOn.accent),
  tertiary: 'bg-transparent text-action-tertiary-fg border border-line-interactive',
  ghost: 'bg-transparent text-fg-primary',
  danger: cx('bg-action-danger-bg text-action-danger-fg', focusOn.danger),
};

/** height / padding-x / type step, from 02-components.md §1 "Sizes". */
const SIZE: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-label-md gap-1',
  md: 'h-11 px-4 text-label-lg gap-2',
  lg: 'h-13 px-5 text-label-lg gap-2',
  xl: 'h-15 px-6 text-heading-sm gap-2',
};

const SPINNER_SIZE = { sm: 'sm', md: 'sm', lg: 'md', xl: 'md' } as const;

interface ButtonOwnProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  iconStart?: ReactNode;
  iconEnd?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  /**
   * Marks an irreversible action. Adds no colour-only meaning — the label must
   * still contain the verb ("Cancel order", never "Confirm").
   */
  destructive?: boolean;
  /**
   * The activation handler named by 02-components.md §1. `onPress` is the
   * shared cross-platform name (the RN apps use the same inventory); `onClick`
   * is the DOM name and both are honoured. Pass one.
   */
  onPress?: () => void;
  /** Overrides the accessible name when the visible label is not enough. */
  accessibilityLabel?: string;
  children: ReactNode;
  className?: string;
}

export type ButtonProps = ButtonOwnProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof ButtonOwnProps | 'type'> & {
    type?: 'button' | 'submit' | 'reset';
    /** Link mode: renders an anchor and announces as a link, not a button. */
    href?: string;
  } & Pick<AnchorHTMLAttributes<HTMLAnchorElement>, 'target' | 'rel'>;

export const Button = forwardRef<HTMLButtonElement & HTMLAnchorElement, ButtonProps>(
  function Button(
    {
      variant = 'primary',
      size = 'md',
      fullWidth = false,
      iconStart,
      iconEnd,
      loading = false,
      disabled = false,
      destructive = false,
      onPress,
      accessibilityLabel,
      children,
      className,
      href,
      type = 'button',
      onClick,
      onKeyDown,
      ...rest
    },
    ref,
  ) {
    const inert = disabled || loading;

    /**
     * Width freeze. The leading slot is reserved whenever the caller opted into
     * loading at all (`loading` passed, even as false) or already has an icon,
     * so the spinner arriving never reflows the label.
     */
    const reserveLead = iconStart !== undefined || loading !== undefined;

    const block = (event: MouseEvent | KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
      if (inert) return block(event);
      onClick?.(event);
      onPress?.();
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
      // A link in button clothing still activates on Enter only; a real button
      // takes both. Space on an anchor would otherwise scroll the page.
      if (inert && (event.key === 'Enter' || event.key === ' ')) return block(event);
      if (href && event.key === ' ') return;
      onKeyDown?.(event);
    };

    const classes = cx(
      'relative isolate inline-flex select-none items-center justify-center rounded-md',
      'font-ui whitespace-nowrap no-underline',
      'group transition-transform duration-[var(--hg-duration-instant)] ease-standard',
      'not-aria-disabled:active:scale-[0.98]',
      SIZE[size],
      VARIANT[variant],
      HG_FOCUS,
      fullWidth && 'w-full',
      inert && 'cursor-not-allowed opacity-(--hg-state-disabled-opacity)',
      className,
    );

    const content = (
      <>
        {/* hover + pressed overlays, composited over the fill (rule: states are
            an overlay on the variant, not a second set of colours). */}
        <span
          aria-hidden="true"
          className={cx(
            'pointer-events-none absolute inset-0 rounded-[inherit] transition-colors',
            'duration-[var(--hg-duration-fast)] ease-standard',
            !inert &&
              'group-hover:bg-[var(--hg-state-hover-overlay)] group-active:bg-[var(--hg-state-pressed-overlay)]',
          )}
        />
        {reserveLead ? (
          <span className="relative inline-flex shrink-0 items-center justify-center">
            {loading ? (
              <Spinner size={SPINNER_SIZE[size]} decorative />
            ) : (
              (iconStart ?? null)
            )}
          </span>
        ) : null}
        <span className="relative">{children}</span>
        {iconEnd ? (
          <span aria-hidden="true" className="relative inline-flex shrink-0">
            {iconEnd}
          </span>
        ) : null}
      </>
    );

    const shared = {
      className: classes,
      'data-testid': 'hg-button',
      'data-variant': variant,
      'data-size': size,
      'data-loading': loading || undefined,
      'aria-disabled': inert || undefined,
      'aria-busy': loading || undefined,
      'aria-label': accessibilityLabel,
    };

    if (href) {
      return (
        <a
          ref={ref}
          href={inert ? undefined : href}
          role="link"
          onClick={handleClick as unknown as (e: MouseEvent<HTMLAnchorElement>) => void}
          onKeyDown={handleKeyDown as unknown as (e: KeyboardEvent<HTMLAnchorElement>) => void}
          {...shared}
          {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}
        >
          {content}
        </a>
      );
    }

    return (
      <button
        ref={ref}
        type={type}
        // Deliberately NOT the `disabled` attribute: a disabled control must
        // stay in the tab order to explain itself (04-accessibility.md §5).
        data-destructive={destructive || undefined}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        {...shared}
        {...rest}
      >
        {content}
      </button>
    );
  },
);
