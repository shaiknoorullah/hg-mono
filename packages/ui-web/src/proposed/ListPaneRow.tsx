/**
 * `ListPaneRow` and `ListPane` — the dense list beside an open record in the admin console
 * (canvases `admin/orders/OrderDetail`, `admin/refunds/Refunds`: "Proposed component:
 * ListPaneRow"; the dense ListRow of packet P9).
 *
 * - A row is a link (or a button with `onPress`): the code in mono, a status chip, a second line.
 *   At least 52px tall, so the 44px target holds.
 * - The open row is `aria-current="page"` and a filled tile (`state-selected-tint`) in bold,
 *   never a left border.
 * - `ListPane` is the `nav` around the rows. Tab reaches the list once (one roving tab stop, on
 *   the current row or the first); ArrowUp and ArrowDown move, Home and End jump, Enter opens.
 */

import { useCallback, useEffect, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

import { cellBadgeVariants } from '../lib/ui/data-grid.js';
import { cn } from '../lib/utils.js';
import { ListPaneRowLink } from '../lib/ui/list-pane.js';
import type { StatusCellVariant } from '../ds/cells.js';

/** Props of one row. */
export interface ListPaneRowProps {
  /** The record's code ("HG-6RN4KP"), drawn in mono. */
  code: string;
  /** The status chip's text and tone (tint only). */
  status?: { label: string; tone?: StatusCellVariant };
  /** The second line ("Zaytoun Grill · 6:42 pm"). */
  subline?: ReactNode;
  /** The row's link. */
  href?: string;
  /** Called on activation (click or Enter); with `href`, after the default is prevented. */
  onPress?: () => void;
  /** The row open beside the list. */
  current?: boolean;
  /** The row's accessible name, when the visible text is not enough. */
  accessibilityLabel?: string;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
}

/** One row of the list pane. */
export function ListPaneRow({
  code,
  status,
  subline,
  href,
  onPress,
  current = false,
  accessibilityLabel,
  testId = 'ListPaneRow',
  style,
}: ListPaneRowProps) {
  return (
    <ListPaneRowLink
      href={href}
      current={current}
      aria-label={accessibilityLabel}
      data-testid={testId}
      data-list-pane-row=""
      style={style}
      onActivate={onPress}
    >
      <span className={cn('min-w-0 truncate font-mono text-mono-sm tabular-nums', current && 'font-bold')}>{code}</span>
      {status ? (
        <span className={cellBadgeVariants({ variant: status.tone ?? 'neutral' })}>{status.label}</span>
      ) : (
        <span />
      )}
      {subline ? (
        <span className={cn('col-span-2 min-w-0 truncate text-body-sm text-fg-secondary', current && 'font-semibold')}>
          {subline}
        </span>
      ) : null}
    </ListPaneRowLink>
  );
}

/** Props of the list's container. */
export interface ListPaneProps {
  /** Names the list ("Orders"). */
  label: string;
  children: ReactNode;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

/** The `nav` around `ListPaneRow`s, with one roving tab stop and arrow-key movement. */
export function ListPane({ label, children, testId = 'ListPane', style, className }: ListPaneProps) {
  const ref = useRef<HTMLElement | null>(null);
  const rows = useCallback(
    () => Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-list-pane-row]') ?? []),
    [],
  );
  const setStop = useCallback(
    (target: HTMLElement | undefined) => {
      for (const row of rows()) row.tabIndex = row === target ? 0 : -1;
    },
    [rows],
  );
  // One tab stop: the current row, or the first.
  useEffect(() => {
    const list = rows();
    setStop(list.find((r) => r.getAttribute('aria-current') === 'page') ?? list[0]);
  });
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const list = rows();
    const index = list.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    const moves: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      Home: 0,
      End: list.length - 1,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = list[Math.max(0, Math.min(list.length - 1, moves[event.key]!))];
    setStop(next);
    next?.focus();
  };
  return (
    <nav
      ref={ref}
      aria-label={label}
      data-testid={testId}
      style={style}
      className={cn('min-h-0 overflow-auto', className)}
      onKeyDown={onKeyDown}
    >
      {children}
    </nav>
  );
}
