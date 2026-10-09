/**
 * TEMPORARY stub until @hg/ui-web/ds ships DetailPanel (ds-request issue TBD; tracked under #192).
 * Props follow the canvases' drawing ("DetailPanel (shadcn Resizable + ScrollArea). Opens
 * beside the list, never over it … Close or Escape collapses it and focus returns to what
 * opened it.").
 *
 * The in-page panel for details and decisions (decisions are never modals). On open its
 * heading takes focus; "Close" and Escape call `onClose` and return focus to the opener
 * (`returnFocusRef`). There is NO focus trap: the page around it stays usable. The body
 * scrolls in its own region; the footer holds the panel's actions. While `busy` (a decision
 * is sending) Escape and Close do nothing and the panel is `aria-busy`. The region is
 * labelled by its heading. Width comes from the surrounding SplitPanes pane.
 */
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';

import { Button } from './adapters/Button.adapter';
import { cx } from './internal/cx';
import { focusElement } from './internal/focus';

export interface DetailPanelProps {
  /** Renders nothing when false. Focus moves to the heading each time it becomes true. */
  open?: boolean;
  /** The heading: names the region and takes focus on open. */
  title: ReactNode;
  /** Heading level. Default 2. */
  headingLevel?: 2 | 3;
  /** A line under the heading (e.g. "Order HG-6RN4KP · Preparing"). */
  subtitle?: ReactNode;
  /** Close and Escape. Omit for a panel that cannot close. */
  onClose?: () => void;
  /** Element that opened the panel; focus returns there on close. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** Close button label. Default "Close". */
  closeLabel?: string;
  /** Extra controls in the header, before Close. */
  headerActions?: ReactNode;
  children?: ReactNode;
  /** Actions pinned under the scrolling body (the panel's own primary button sends). */
  footer?: ReactNode;
  /** Sending: blocks Escape and Close; sets aria-busy. */
  busy?: boolean;
  id?: string;
  className?: string;
  testId?: string;
}

export function DetailPanel({
  open = true,
  title,
  headingLevel = 2,
  subtitle,
  onClose,
  returnFocusRef,
  closeLabel = 'Close',
  headerActions,
  children,
  footer,
  busy = false,
  id,
  className,
  testId = 'DetailPanel',
}: DetailPanelProps): React.JSX.Element | null {
  const headingId = `${useId()}-heading`;
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (open) focusElement(headingRef.current);
  }, [open]);

  if (!open) return null;

  const close = () => {
    if (busy || !onClose) return;
    onClose();
    focusElement(returnFocusRef?.current ?? null);
  };

  const H = `h${headingLevel}` as 'h2';
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      aria-busy={busy || undefined}
      data-testid={testId}
      className={cx('flex h-full min-h-0 flex-col bg-surface-raised', className)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && onClose) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <header className="flex items-start gap-3 border-b border-line-decorative px-4 py-3">
        <div className="min-w-0 flex-1">
          <H ref={headingRef} id={headingId} tabIndex={-1} className="text-heading-sm text-fg-primary outline-none focus-visible:underline">
            {title}
          </H>
          {subtitle ? <div className="text-body-sm text-fg-secondary">{subtitle}</div> : null}
        </div>
        {headerActions}
        {onClose ? (
          <Button variant="ghost" size="sm" iconStart="close" disabled={busy} onPress={close}>
            {closeLabel}
          </Button>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
      {footer ? <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-line-decorative px-4 py-3">{footer}</footer> : null}
    </section>
  );
}
