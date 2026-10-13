/**
 * `StickyFooter` / `ActionBar` (proposed, packet P12; #192, #195) — the action area at the
 * bottom of a pane or sheet: the save bar of a settings pane, the actions under a detail.
 * It is part of the pane, never a floating bar over content (canvas
 * `restaurant/menu-hours/HoursView`). It sticks to the bottom of its scroll container; when
 * content scrolls under it (`elevated`), it gains the sticky elevation.
 */

import type { CSSProperties, ReactNode } from 'react';

import { cn } from '../lib/utils.js';

/** Props of `StickyFooter` (packet P12). */
export interface StickyFooterProps {
  children: ReactNode;
  /** Content scrolls under it: adds the sticky elevation. */
  elevated?: boolean;
  /** Addition: how the actions sit. Default `end` (primary action last, at the end). */
  align?: 'start' | 'end' | 'between';
  /** Addition: names the group of actions ("Hours actions"). */
  label?: string;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
}

/** The pinned action row at the bottom of a pane. */
export function StickyFooter({
  children,
  elevated = false,
  align = 'end',
  label,
  testId = 'StickyFooter',
  style,
}: StickyFooterProps): ReactNode {
  return (
    <div
      role={label ? 'group' : undefined}
      aria-label={label}
      data-testid={testId}
      data-elevated={elevated || undefined}
      className={cn(
        'sticky bottom-0 z-[var(--hg-z-sticky)] flex flex-wrap items-center gap-2 border-t border-line-decorative bg-surface-raised px-4 py-3',
        align === 'end' && 'justify-end',
        align === 'start' && 'justify-start',
        align === 'between' && 'justify-between',
        elevated && 'shadow-esticky',
      )}
      style={style}
    >
      {children}
    </div>
  );
}

/** The same component under the name the restaurant canvases use. */
export const ActionBar = StickyFooter;
/** Props of `ActionBar` (the same as `StickyFooterProps`). */
export type ActionBarProps = StickyFooterProps;
