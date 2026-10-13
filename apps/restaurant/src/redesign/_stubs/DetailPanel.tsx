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
  width?: 'panel' | 'pane';
  testId?: string;
}

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
}: DetailPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const id = useId();
  useEffect(() => {
    if (focusOnOpen) headingRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <aside
      aria-label={label}
      aria-labelledby={undefined}
      data-testid={testId}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
      className={`flex min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border border-line-decorative bg-surface-raised text-fg-primary ${
        width === 'panel' ? 'w-[380px] xl:w-[460px]' : 'w-[340px]'
      }`}
    >
      <div className="flex items-start gap-2 border-b border-line-decorative px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 id={id} ref={headingRef} tabIndex={-1} className="hg-focus text-[22px] font-semibold leading-7 outline-none">
            {title}
          </h2>
          {subtitle ? <div className="mt-0.5 text-[15px] text-fg-secondary">{subtitle}</div> : null}
        </div>
        <IconButton icon={<Icon name="close" size={20} />} accessibilityLabel={closeLabel} onPress={onClose} variant="plain" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
      {footer ? <div className="border-t border-line-decorative px-4 py-3">{footer}</div> : null}
    </aside>
  );
}
