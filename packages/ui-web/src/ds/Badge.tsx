/**
 * `Badge` — a small, non-interactive status marker (live `index.d.ts`, `Badge/README.md`,
 * 02-components.md §9). NOT the halal badge: a halal claim is only ever `HalalBadge`.
 *
 * - Variants neutral, info, warning, danger, brand and outline. There is no `success` tone and no
 *   green (invariant 10); use text for a success.
 * - Appearances tint (default), solid and dot. Sizes sm 18, md 22, lg 26. `max` caps numbers.
 * - Never colour alone: every badge carries a word. A badge with no text (a bare dot, an icon on
 *   its own) renders nothing and reports `BADGE_TEXT_MISSING`.
 * - Read in reading order as plain text: no role, no live region.
 */

import type { CSSProperties, ReactNode } from 'react';

import { Badge as LibBadge, badgeDotVariants } from '../lib/ui/badge.js';
import { cn } from '../lib/utils.js';
import { reportDsClientError } from './client-error.js';
import { Icon, type DsIconName } from './Icon.js';

/** Badge tones. No `success`, no `accent`. */
export type BadgeVariant = 'neutral' | 'info' | 'warning' | 'danger' | 'brand' | 'outline';

/** Props of the live `Badge` (index.d.ts). */
export interface BadgeProps {
  children?: ReactNode;
  /** Alternative to children. */
  label?: ReactNode;
  variant?: BadgeVariant;
  /** The spec's `style` prop (renamed: `style` is React's CSS prop). tint is the default. */
  appearance?: 'tint' | 'solid' | 'dot';
  /** sm 18 · md 22 · lg 26. */
  size?: 'sm' | 'md' | 'lg';
  icon?: DsIconName;
  /** For numeric content: above `max` renders "{max}+". */
  max?: number;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
}

const VARIANTS: readonly BadgeVariant[] = ['neutral', 'info', 'warning', 'danger', 'brand', 'outline'];
const ICON_PX = { sm: 12, md: 14, lg: 16 } as const;

function isEmpty(node: ReactNode): boolean {
  return node === null || node === undefined || node === false || node === '' || (Array.isArray(node) && node.every(isEmpty));
}

/** A small status marker that always carries a word. */
export function Badge({
  children,
  label,
  variant = 'neutral',
  appearance = 'tint',
  size = 'md',
  icon,
  max,
  testId = 'Badge',
  style,
}: BadgeProps) {
  // An unknown tone (a `success` smuggled past the types) falls back to neutral, never green.
  const tone: BadgeVariant = VARIANTS.includes(variant) ? variant : 'neutral';
  if (tone !== variant) reportDsClientError('UNKNOWN_ENUM_VALUE', { component: 'Badge', field: 'variant', received: variant });

  let text: ReactNode = label ?? children;
  if (typeof text === 'number' && typeof max === 'number' && text > max) text = `${max}+`;
  if (isEmpty(text)) {
    reportDsClientError('BADGE_TEXT_MISSING', { component: 'Badge', variant: tone, appearance });
    return null;
  }

  return (
    <LibBadge
      data-testid={testId}
      data-variant={tone}
      data-appearance={appearance}
      variant={tone}
      appearance={appearance}
      size={size}
      style={style}
    >
      {appearance === 'dot' ? <span aria-hidden="true" className={cn(badgeDotVariants({ variant: tone, size }))} /> : null}
      {icon ? <Icon name={icon} size={ICON_PX[size]} testId="Badge-icon" /> : null}
      {text}
    </LibBadge>
  );
}
