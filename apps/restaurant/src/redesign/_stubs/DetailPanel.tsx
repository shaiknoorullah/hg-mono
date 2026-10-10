/**
 * TEMPORARY STUB for the approved DS `DetailPanel` (decision row 28 Sep; ds-request(web):
 * DetailPanel — DS W2). Delete when `@hg/ui-web/ds` exports it.
 *
 * An in-page panel on the right of the panes row (never a modal, never an overlay): 460 px
 * on desktop, 380 px on tablet. Its heading takes focus when it opens; Close and Escape call
 * `onClose`, and the opener restores focus. The body scrolls; the page never does.
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon, IconButton } from '@hg/ui-web/primitives';

export interface DetailPanelProps {
  /** The heading (an order code, "Screen health", "Decline order A7K2"). */
  title: ReactNode;
  /** Accessible name of the `<aside>` region. */
  label: string;
  /** Accessible name of the close button, e.g. "Close screen health". */
  closeLabel: string;
  onClose: () => void;
  subtitle?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** Focus the heading on mount (default true). */
  focusOnOpen?: boolean;
  /**
   * `task` (MH: 420 px, tablet 380) and `editor` (MH item editor: takes the remaining width)
   * are the Proposed DetailPanel variants; `panel`/`pane` as before.
   */
  width?: 'panel' | 'pane' | 'task' | 'editor';
  testId?: string;
  /** Element id of the panel (MH: `item-panel`, `cat-panel`, `item-editor`). */
  id?: string;
  /** Id for the heading; the panel is then named by its heading (`aria-labelledby`). */
  headingId?: string;
  /** Landmark: `aside` (details) or `section` (a task or the editor). */
  as?: 'aside' | 'section';
  /** A line above the heading ("Mains · item details"). */
  kicker?: ReactNode;
  /** Beside the heading (a review badge). */
  headerExtra?: ReactNode;
  /** The close button is off while a task is in flight. */
  closeDisabled?: boolean;
  /** `aria-busy` on the body while it is loading or submitting. */
  busy?: boolean;
}

const WIDTH = {
  panel: 'shrink-0 w-[380px] xl:w-[460px]',
  pane: 'shrink-0 w-[340px]',
  task: 'shrink-0 w-[380px] xl:w-[420px]',
  editor: 'min-w-0 flex-1',
} as const;

export function DetailPanel({
  title,
  label,
  closeLabel,
  onClose,
  subtitle,
  footer,
  children,
  focusOnOpen = true,
  width = 'panel',
  testId,
  id: panelId,
  headingId,
  as = 'aside',
  kicker,
  headerExtra,
  closeDisabled,
  busy,
}: DetailPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const autoId = useId();
  const id = headingId ?? autoId;
  const Root = as;
  useEffect(() => {
    if (focusOnOpen) headingRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Root
      id={panelId}
      aria-label={headingId ? undefined : label}
      aria-labelledby={headingId}
      data-testid={testId}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          if (!closeDisabled) onClose();
        }
      }}
      className={`flex min-h-0 flex-col overflow-hidden rounded-lg border border-line-decorative bg-surface-raised text-fg-primary ${WIDTH[width]}`}
    >
      <div className="flex items-start gap-2 border-b border-line-decorative px-4 py-3">
        <div className="min-w-0 flex-1">
          {kicker ? <p className="text-[13px] text-fg-secondary">{kicker}</p> : null}
          <h2 id={id} ref={headingRef} tabIndex={-1} className="hg-focus text-[22px] font-semibold leading-7 outline-none">
            {title}
          </h2>
          {subtitle ? <div className="mt-0.5 text-[15px] text-fg-secondary">{subtitle}</div> : null}
          {headerExtra ? <div className="mt-1">{headerExtra}</div> : null}
        </div>
        <IconButton
          icon={<Icon name="close" size={20} />}
          accessibilityLabel={closeLabel}
          onPress={onClose}
          disabled={closeDisabled}
          variant="plain"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-busy={busy || undefined}>
        {children}
      </div>
      {footer ? <div className="border-t border-line-decorative px-4 py-3">{footer}</div> : null}
    </Root>
  );
}
