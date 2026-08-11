/**
 * `Card` — component 15, `02-components.md` Tier 3. The generic surface everything else
 * composes from.
 *
 * An interactive card is **one** tab stop with **one** accessible name. Nested links inside a
 * pressable card are forbidden — the "nested interactive" trap is the single most common
 * accessibility defect in card-based UIs, because it produces a control a keyboard user can
 * reach but not describe. If a card needs two actions, the card is not pressable and the
 * actions are explicit buttons beside it.
 */
import type { CSSProperties, ReactNode } from 'react';
import { cx, DENSITY, FOCUS_RING } from '../certification/internal/token-style';

export type CardVariant = 'elevated' | 'outlined' | 'filled' | 'interactive';
export type CardRadius = 'md' | 'lg' | 'xl';

export interface CardProps {
  variant?: CardVariant;
  /** Defaults to `density.cardPadding` — components never hard-code 16. */
  padding?: string;
  radius?: CardRadius;
  onPress?: () => void;
  /** The accessible name when `onPress` is set. Required for a pressable card. */
  accessibilityLabel?: string;
  media?: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  testId?: string;
}

const VARIANT_CLASS: Readonly<Record<CardVariant, string>> = {
  // Dark themes ignore shadow and step the surface instead; both forms are in the token, and
  // the theme picks (`01-foundations.md` §6).
  elevated: 'bg-surface-raised shadow-e1',
  outlined: 'bg-surface-raised border border-line-decorative',
  filled: 'bg-surface-subtle',
  interactive:
    'bg-surface-raised shadow-e1 hover:shadow-e2 active:scale-[0.99] cursor-pointer text-start',
};

const RADIUS_CLASS: Readonly<Record<CardRadius, string>> = {
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
};

export function Card({
  variant = 'elevated',
  padding,
  radius = 'lg',
  onPress,
  accessibilityLabel,
  media,
  header,
  footer,
  children,
  className,
  style,
  testId = 'Card',
}: CardProps): React.JSX.Element {
  const resolvedVariant: CardVariant = onPress ? 'interactive' : variant;

  const body = (
    <>
      {media}
      <div
        className="flex flex-col gap-2"
        style={{ padding: padding ?? DENSITY.cardPadding }}
      >
        {header}
        {children}
        {footer}
      </div>
    </>
  );

  const shared = cx(
    'flex flex-col overflow-hidden',
    RADIUS_CLASS[radius],
    VARIANT_CLASS[resolvedVariant],
    className,
  );

  if (!onPress) {
    return (
      <div data-testid={testId} className={shared} style={style}>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid={testId}
      className={cx(shared, FOCUS_RING)}
      style={style}
      aria-label={accessibilityLabel}
      onClick={onPress}
    >
      {body}
    </button>
  );
}
