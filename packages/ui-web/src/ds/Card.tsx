/**
 * `Card` — the generic surface (live `index.d.ts`, `Card/README.md`, 02-components.md §15).
 * Built on the shadcn `Card` parts in `lib/ui/card`.
 *
 * - Variants elevated (elevation 1), outlined (1px `border.decorative`), filled
 *   (`surface.subtle`) and interactive. The variant defaults to `interactive` when `onPress` or
 *   `href` is set, else `elevated`.
 * - A pressable card is ONE tab stop with ONE accessible name: a link with `href`, otherwise
 *   `role="button"` activated by Enter or Space. Nested links or buttons inside it are forbidden;
 *   a card with two actions is not pressable.
 * - `media` is full-bleed at the top; `header` and `footer` frame the body.
 */

import type { CSSProperties, ReactNode, SyntheticEvent } from 'react';

import { Card as LibCard, CardLink, CardPressable } from '../lib/ui/card.js';
import { cn } from '../lib/utils.js';

/** Props of the live `Card` (index.d.ts). */
export interface CardProps {
  children?: ReactNode;
  /** Defaults to `interactive` when onPress/href is set, else `elevated`. */
  variant?: 'elevated' | 'outlined' | 'filled' | 'interactive';
  /** CSS length; defaults to var(--density-card-padding). */
  padding?: string;
  radius?: 'md' | 'lg' | 'xl';
  /** Makes the card ONE tab stop (role="button", Enter/Space). */
  onPress?: (e: SyntheticEvent) => void;
  /** Makes the card a link. */
  href?: string;
  /** The single accessible name of a pressable card. */
  accessibilityLabel?: string;
  media?: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
  /** Layout classes from the page (kept from the pre-rebuild export). */
  className?: string;
}

/** The generic surface. */
export function Card({
  children,
  variant,
  padding,
  radius = 'lg',
  onPress,
  href,
  accessibilityLabel,
  media,
  header,
  footer,
  testId = 'Card',
  style,
  className,
}: CardProps) {
  const pressable = Boolean(onPress || href);
  const kind = variant ?? (pressable ? 'interactive' : 'elevated');
  // A pressable card always behaves as one; a static card never gets hover or focus.
  const look = pressable ? kind : kind === 'interactive' ? 'elevated' : kind;

  const body = (
    <>
      {media ? <div data-slot="card-media" className="overflow-hidden">{media}</div> : null}
      <div
        data-slot="card-body"
        className={cn('flex flex-col', padding === undefined && 'p-density-card-padding')}
        style={padding === undefined ? undefined : { padding }}
      >
        {header ? <div data-slot="card-header" className="mb-3">{header}</div> : null}
        {children}
        {footer ? <div data-slot="card-footer" className="mt-4">{footer}</div> : null}
      </div>
    </>
  );

  const shared = {
    'data-testid': testId,
    'data-variant': kind,
    variant: look,
    radius,
    className,
    style,
  };

  if (href) {
    return (
      <CardLink {...shared} href={href} aria-label={accessibilityLabel} onClick={onPress}>
        {body}
      </CardLink>
    );
  }
  if (onPress) {
    return (
      <CardPressable {...shared} onPress={onPress} aria-label={accessibilityLabel}>
        {body}
      </CardPressable>
    );
  }
  return <LibCard {...shared}>{body}</LibCard>;
}
