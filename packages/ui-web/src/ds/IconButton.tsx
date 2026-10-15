/**
 * `IconButton` — a control whose only content is an icon (live `index.d.ts`,
 * `IconButton/README.md`, 02-components.md §2). Built on the shadcn `Button` recipe.
 *
 * - `accessibilityLabel` is required; the glyph is always `aria-hidden`.
 * - A count badge is folded into the accessible name ("Cart, 3 items") and drawn as "99+" above
 *   99; it is never a separate node. `badge={true}` is a dot, named "{label}, new" (or with
 *   `badgeNoun`).
 * - sm 36 keeps a 44px hit area; md 44; lg 56.
 * - `loading` keeps the name, sets `aria-busy`, shows a spinner and ignores presses. `disabled`
 *   is `aria-disabled` and stays focusable.
 * - The badge is brand orange on a raised ring, never danger red and never green.
 */

import { forwardRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';

import { Button as LibButton } from '../lib/ui/button.js';
import { SpinnerGlyph } from '../lib/ui/spinner.js';
import { cn } from '../lib/utils.js';
import { reportDsClientError } from './client-error.js';
import type { ButtonPassThroughProps } from './Button.js';
import { Icon, type DsIconName, type IconWeight } from './Icon.js';

/** Props of the live `IconButton` (index.d.ts), plus an optional `tone` and DOM pass-through. */
export interface IconButtonProps extends Omit<ButtonPassThroughProps, 'aria-label'> {
  /** Solar icon name, or a node. */
  icon: DsIconName | ReactNode;
  /** Required. A count badge is appended to it ("Cart, 3 items"). */
  accessibilityLabel: string;
  variant?: 'plain' | 'filled' | 'tonal';
  /** sm 36 (hit area 44) · md 44 · lg 56. */
  size?: 'sm' | 'md' | 'lg';
  shape?: 'square' | 'circle';
  /** `bold` when the control represents an active or selected state. */
  weight?: IconWeight;
  /** A count (99+ above 99) or `true` for a dot. Folded into the accessible name. */
  badge?: number | boolean;
  /** Noun for the count in the name: badgeNoun="items" → "Cart, 3 items". */
  badgeNoun?: string;
  loading?: boolean;
  disabled?: boolean;
  onPress?: (e: MouseEvent) => void;
  /** `onChrome` when the control sits on the forest chrome. */
  tone?: 'default' | 'onChrome';
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
}

const GLYPH = { sm: 16, md: 20, lg: 24 } as const;

/** The accessible name with the badge folded in. */
function nameFor(label: string, badge: IconButtonProps['badge'], noun?: string): string {
  if (typeof badge === 'number' && badge > 0) return `${label}, ${badge}${noun ? ` ${noun}` : ''}`;
  if (badge === true) return `${label}, ${noun ?? 'new'}`;
  return label;
}

/** An icon-only control. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  icon,
  accessibilityLabel,
  variant = 'plain',
  size = 'md',
  shape = 'square',
  weight = 'linear',
  badge,
  badgeNoun,
  loading = false,
  disabled = false,
  onPress,
  tone = 'default',
  testId = 'IconButton',
  style,
  onClick,
  onKeyDown,
  onKeyUp,
  onBlur,
  ...rest
}, ref) {
  const [pressed, setPressed] = useState(false);
  if (!accessibilityLabel) reportDsClientError('ICON_BUTTON_UNLABELLED', { icon: typeof icon === 'string' ? icon : 'node' });
  const inert = disabled || loading;
  const px = GLYPH[size];
  const count = typeof badge === 'number' && badge > 0 ? badge : null;

  const swallow = (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <LibButton
      {...rest}
      ref={ref}
      data-testid={testId}
      data-variant={variant}
      data-size={size}
      data-pressed={pressed && !inert ? '' : undefined}
      aria-label={nameFor(accessibilityLabel, badge, badgeNoun)}
      aria-disabled={disabled || undefined}
      aria-busy={loading || undefined}
      variant={variant}
      size={`icon-${size}`}
      shape={shape}
      tone={tone}
      hit={size === 'sm' ? 'expand' : 'none'}
      style={style}
      onClick={(event) => {
        if (inert) return swallow(event);
        onPress?.(event);
        onClick?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          if (inert) return swallow(event);
          setPressed(true);
        }
        onKeyDown?.(event);
      }}
      onKeyUp={(event) => {
        setPressed(false);
        onKeyUp?.(event);
      }}
      onBlur={(event) => {
        setPressed(false);
        onBlur?.(event);
      }}
    >
      {loading ? (
        <SpinnerGlyph size={px} />
      ) : typeof icon === 'string' ? (
        <Icon name={icon as DsIconName} size={px} weight={weight} testId="IconButton-icon" />
      ) : (
        <span aria-hidden="true" className="inline-flex">
          {icon}
        </span>
      )}
      {count !== null || badge === true ? (
        <span
          aria-hidden="true"
          data-hg-badge={count !== null ? 'count' : 'dot'}
          className={cn(
            'absolute inline-flex items-center justify-center rounded-full',
            'bg-action-primary-bg text-action-primary-fg text-label-sm font-bold tabular-nums',
            'ring-2 ring-surface-raised',
            count !== null ? 'end-0.5 top-0.5 h-4.5 min-w-4.5 px-1' : 'end-1.5 top-1.5 size-2',
          )}
        >
          {count === null ? null : count > 99 ? '99+' : count}
        </span>
      ) : null}
    </LibButton>
  );
});
