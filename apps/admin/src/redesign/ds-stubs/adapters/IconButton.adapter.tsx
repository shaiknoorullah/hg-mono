/**
 * ADAPTER: live design-system `IconButton` -> `@hg/ui-web` `IconButton`.
 *
 * Live differences handled here: `icon` may be a Solar icon NAME; `onPress(e)` receives the
 * event; `badgeNoun` folds the count into the accessible name as "Cart, 3 items" (legacy
 * appends only the number); counts above 99 show "99+"; `weight` swaps the glyph to bold for
 * an active control; `testId`. `shape` is accepted for parity (legacy is always round).
 */
import { forwardRef, type ButtonHTMLAttributes, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { IconButton as LegacyIconButton } from '@hg/ui-web';

import { renderIconSlot, type AnyIconName } from './Icon.adapter';

export interface IconButtonProps
  extends Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'id' | 'aria-expanded' | 'aria-controls' | 'aria-haspopup' | 'aria-pressed'> {
  /** Solar icon name, or a node. */
  icon: AnyIconName | ReactNode;
  /** REQUIRED. A count badge is appended to it ("Cart, 3 items"). */
  accessibilityLabel: string;
  variant?: 'plain' | 'filled' | 'tonal';
  /** sm 36 (hit area 44) · md 44 · lg 56. */
  size?: 'sm' | 'md' | 'lg';
  shape?: 'square' | 'circle';
  weight?: 'linear' | 'bold';
  /** A count (99+ above 99) or `true` for a dot. Folded into the accessible name. */
  badge?: number | boolean;
  /** Noun for the count in the name: badgeNoun="items" -> "Cart, 3 items". */
  badgeNoun?: string;
  loading?: boolean;
  disabled?: boolean;
  onPress?: (e: MouseEvent) => void;
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

const GLYPH = { sm: 'sm', md: 'md', lg: 'lg' } as const;

export function iconButtonName(label: string, badge: number | boolean | undefined, noun?: string): string {
  if (typeof badge !== 'number') return label;
  const shown = badge > 99 ? '99+' : String(badge);
  return noun ? `${label}, ${shown} ${noun}` : `${label}, ${shown}`;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, accessibilityLabel, badge, badgeNoun, weight, onPress, testId = 'IconButton', size = 'md', shape, ...rest },
  ref,
) {
  const name = iconButtonName(accessibilityLabel, badge, badgeNoun);
  const shown = typeof badge === 'number' && badge > 99 ? 99 : badge;
  return (
    <LegacyIconButton
      ref={ref}
      {...rest}
      size={size}
      accessibilityLabel={accessibilityLabel}
      badge={shown}
      data-testid={testId}
      data-shape={shape}
      icon={renderIconSlot(icon, GLYPH[size], weight)}
      onClick={onPress ? (e: MouseEvent) => onPress(e) : undefined}
      {...({ 'aria-label': name } as object)}
    />
  );
});
