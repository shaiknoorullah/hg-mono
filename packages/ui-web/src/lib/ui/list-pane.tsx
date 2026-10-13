/**
 * The interactive row of the admin list pane (`ListPaneRow`, src/proposed/ListPaneRow.tsx): a
 * link when it has an `href`, otherwise a button. Two-column grid (code, status; then the second
 * line), at least 52px tall, inset focus ring (the row sits in a clipping scroll container).
 * The current row is the selected tint and bold, never a left border.
 */

import type { CSSProperties, MouseEvent, ReactNode } from 'react';

import { cn } from '../utils.js';

/** Props of the row element. */
export interface ListPaneRowLinkProps {
  href?: string;
  current?: boolean;
  onActivate?: () => void;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
  'data-testid'?: string;
  'data-list-pane-row'?: string;
}

const ROW =
  'hg-focus-inset grid w-full min-h-13 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 ' +
  'border-0 border-b border-solid border-line-decorative bg-transparent px-3 py-1 text-start text-body-md text-fg-primary no-underline ' +
  'hover:bg-[var(--hg-state-hover-overlay)] aria-[current=page]:bg-accent';

/** A list-pane row: `<a>` with an href, `<button>` without. */
export function ListPaneRowLink({ href, current, onActivate, children, className, ...rest }: ListPaneRowLinkProps) {
  const ariaCurrent = current ? ('page' as const) : undefined;
  if (href) {
    return (
      <a
        href={href}
        aria-current={ariaCurrent}
        className={cn(ROW, className)}
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
          if (!onActivate || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          onActivate();
        }}
        {...rest}
      >
        {children}
      </a>
    );
  }
  return (
    <button
      type="button"
      aria-current={ariaCurrent}
      className={cn(ROW, className)}
      onClick={() => onActivate?.()}
      {...rest}
    >
      {children}
    </button>
  );
}
