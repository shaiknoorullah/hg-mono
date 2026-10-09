/**
 * `DetailPanel` — the in-page panel that holds a detail or a working task on desktop
 * (owner-approved, desktop-layout row 28 Sep; canvases `admin/orders/OrderDetail`,
 * `admin/refunds/OrderDetail`, `restaurant/live-orders/LiveBoard` "Board-detail-open").
 *
 * - **In the page, not an overlay.** It is an `<aside>` named by its heading: no scrim, no
 *   focus trap, no `aria-modal`. The list and the new-order strip beside it keep working
 *   (constitution gate 11).
 * - Header: the title as a heading (h2 by default, focusable with tabIndex -1 so focus lands
 *   on it when the panel opens) and a 44px close IconButton ("Close {title}").
 * - The body scrolls in a ScrollArea; the `footer` slot stays put at the bottom.
 * - Status slots: `loading` (announced as a status, `aria-busy`), `empty`, `error`
 *   (announced as an alert). Each has a plain default, so no state renders blank.
 * - Closing (button or Escape inside the panel) returns focus to where it was before the panel
 *   opened.
 * - Inside `SplitPanes` its edge is the resize handle; on its own it takes `width`
 *   (`width="panel"`: 380px on tablet, 460px from 1280px, as the restaurant console draws it).
 * - While `busy` (a decision is sending) Escape and Close do nothing; the panel is `aria-busy`
 *   and Close stays focusable with `aria-disabled` (admin, #699).
 * - `open` (default true) lets an app keep the panel mounted: false renders nothing and returns
 *   focus, true focuses the heading again. `returnFocusRef` names the opener explicitly.
 */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import { ScrollArea } from '../lib/ui/scroll-area.js';
import { cn } from '../lib/utils.js';
import { IconButton } from './index.js';

/** What the panel body shows. */
export type DetailPanelStatus = 'ready' | 'loading' | 'empty' | 'error';

/** Props of `DetailPanel`. */
export interface DetailPanelProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Default 2. */
  headingLevel?: 2 | 3;
  /** Shows the close button and closes on Escape. */
  onClose?: () => void;
  /** The close button's name. Default "Close {title}" when the title is text, else "Close panel". */
  closeLabel?: string;
  /** Extra header controls (IconButtons with real labels), before Close. */
  actions?: ReactNode;
  /** Alias of `actions` (the admin stub's name). */
  headerActions?: ReactNode;
  /** The panel's action area, pinned under the scrolling body. */
  footer?: ReactNode;
  children?: ReactNode;
  /** Default 'ready'. */
  status?: DetailPanelStatus;
  /** Shown while `status="loading"` (a Skeleton). Default: "Loading…". */
  loadingSlot?: ReactNode;
  /** Shown when `status="empty"` (an EmptyState). Default: "Nothing to show here." */
  emptySlot?: ReactNode;
  /** Shown when `status="error"` (an ErrorState with Try again). Default: "This could not be loaded." */
  errorSlot?: ReactNode;
  /** Move focus to the heading when the panel mounts. Default true. */
  focusOnOpen?: boolean;
  /** Return focus to the previously focused element when the panel unmounts. Default true. */
  returnFocus?: boolean;
  /**
   * Fixed width when not inside SplitPanes (px or any CSS length). Presets: `panel` is 380px on
   * tablet and 460px from 1280px (restaurant, #675); `pane` is 340px.
   */
  width?: number | string | 'panel' | 'pane';
  /** Addition: shown while true (default); false renders nothing and returns focus. */
  open?: boolean;
  /** Addition: a decision is sending. Escape and Close do nothing; sets aria-busy. */
  busy?: boolean;
  /** Addition: the element focus returns to on close (default: whatever was focused on open). */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** Addition: names the region directly instead of by its heading. */
  label?: string;
  /** Addition: the region's id. */
  id?: string;
  className?: string;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
}

/** An in-page detail panel with a header, a scrolling body and a pinned footer. */
export function DetailPanel({
  title,
  subtitle,
  headingLevel = 2,
  onClose,
  closeLabel,
  actions,
  headerActions,
  footer,
  children,
  status = 'ready',
  loadingSlot,
  emptySlot,
  errorSlot,
  focusOnOpen = true,
  returnFocus = true,
  width,
  open = true,
  busy = false,
  returnFocusRef,
  label,
  id,
  className,
  testId = 'DetailPanel',
  style,
}: DetailPanelProps): ReactNode {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  const name = closeLabel ?? (typeof title === 'string' ? `Close ${title}` : 'Close panel');

  const opener = useRef<HTMLElement | null>(null);
  const restoreRef = useRef({ returnFocus, returnFocusRef });
  restoreRef.current = { returnFocus, returnFocusRef };

  // Layout effect: capture the opener before anything inside the panel takes focus.
  useLayoutEffect(() => {
    if (!open) return undefined;
    opener.current = typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);
    return () => {
      const { returnFocus: restore, returnFocusRef: target } = restoreRef.current;
      const to = target?.current ?? opener.current;
      if (restore && to && to !== document.body && to.isConnected) to.focus();
    };
    // One opening per `open` = true; unmount counts as a close.
  }, [open]);

  useEffect(() => {
    if (open && focusOnOpen) heading.current?.focus();
    // Each opening, not each render.
  }, [open]);

  if (!open) return null;

  const close = (): void => {
    if (busy || !onClose) return;
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape' && onClose && !event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  const extra = actions ?? headerActions;
  const preset = width === 'panel' || width === 'pane' ? width : undefined;

  let body: ReactNode;
  if (status === 'loading') {
    body = (
      <div role="status" className="flex flex-col gap-3">
        {loadingSlot ?? <p className="m-0 text-body-md text-fg-secondary">Loading…</p>}
      </div>
    );
  } else if (status === 'error') {
    body = (
      <div role="alert" className="flex flex-col gap-3">
        {errorSlot ?? <p className="m-0 text-body-md text-fg-primary">This could not be loaded.</p>}
      </div>
    );
  } else if (status === 'empty') {
    body = emptySlot ?? <p className="m-0 text-body-md text-fg-secondary">Nothing to show here.</p>;
  } else {
    body = children;
  }

  return (
    <aside
      id={id}
      aria-label={label}
      aria-labelledby={label ? undefined : headingId}
      aria-busy={status === 'loading' || busy || undefined}
      data-testid={testId}
      data-status={status}
      data-busy={busy || undefined}
      onKeyDown={onKeyDown}
      className={cn(
        'flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface-raised text-fg-primary',
        'border border-line-brand',
        preset === 'panel' && 'w-[380px] shrink-0 xl:w-[460px]',
        preset === 'pane' && 'w-[340px] shrink-0',
        className,
      )}
      style={{ ...(width === undefined || preset ? null : { width, flexShrink: 0 }), ...style }}
    >
      <div className="flex min-h-13 shrink-0 items-center gap-2 border-b border-line-decorative py-1 ps-4 pe-2">
        <div className="grid min-w-0 flex-1 gap-px">
          <Heading
            id={headingId}
            ref={heading}
            tabIndex={-1}
            data-testid={`${testId}-title`}
            className="m-0 truncate text-heading-sm font-semibold outline-none"
          >
            {title}
          </Heading>
          {subtitle ? <p className="m-0 truncate text-body-sm text-fg-secondary">{subtitle}</p> : null}
        </div>
        {extra ? <div className="flex shrink-0 items-center gap-1">{extra}</div> : null}
        {onClose ? (
          <IconButton
            icon="close"
            accessibilityLabel={name}
            variant="plain"
            size="md"
            disabled={busy}
            onPress={close}
            testId={`${testId}-close`}
          />
        ) : null}
      </div>

      <ScrollArea className="min-h-0 flex-1" viewportClassName="[&>div]:!block">
        <div className="flex flex-col gap-4 px-4 pt-3 pb-4">{body}</div>
      </ScrollArea>

      {footer ? (
        <div
          data-testid={`${testId}-footer`}
          className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line-decorative bg-surface-raised px-4 py-3 shadow-esticky"
        >
          {footer}
        </div>
      ) : null}
    </aside>
  );
}
