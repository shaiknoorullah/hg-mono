/**
 * The one modal-surface mechanism behind Modal, Sheet and NavDrawer: a scrim, a dialog that
 * traps Tab, closes on Escape (when dismissible), makes nothing behind it reachable by Tab,
 * moves focus inside on open and returns focus to whatever had it when it closes.
 * Internal: not exported from ds.ts.
 */
import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import { cx } from './cx';
import { focusableWithin, focusElement, trapTab } from './focus';

export interface OverlayProps {
  open: boolean;
  role: 'dialog' | 'alertdialog';
  labelledBy: string;
  describedBy?: string;
  onDismiss?: () => void;
  dismissible: boolean;
  /** Where the panel sits. */
  placement: 'center' | 'inline-end' | 'inline-start' | 'bottom' | 'full';
  /** Element to focus first; default the first focusable inside, else the panel. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Render in place (inside the nearest positioned ancestor) instead of a portal. */
  contained?: boolean;
  panelClassName?: string;
  panelStyle?: CSSProperties;
  testId?: string;
  /** Id of the dialog panel (what an opener's `aria-controls` names). */
  id?: string;
  children: ReactNode;
}

const PLACEMENT: Record<OverlayProps['placement'], string> = {
  center: 'items-center justify-center p-4',
  'inline-end': 'justify-end',
  'inline-start': 'justify-start',
  bottom: 'items-end',
  full: '',
};

export function Overlay({
  open,
  role,
  labelledBy,
  describedBy,
  onDismiss,
  dismissible,
  placement,
  initialFocusRef,
  contained,
  panelClassName,
  panelStyle,
  testId,
  id,
  children,
}: OverlayProps): React.JSX.Element | null {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const target = initialFocusRef?.current ?? (panel ? focusableWithin(panel)[0] : null) ?? panel;
    focusElement(target);
    return () => {
      const opener = openerRef.current;
      if (opener && document.contains(opener)) focusElement(opener);
    };
  }, [open, initialFocusRef]);

  if (!open) return null;

  const node = (
    <div
      className={cx(contained ? 'absolute' : 'fixed', 'inset-0 z-50 flex', PLACEMENT[placement])}
      data-testid={testId ? `${testId}-root` : undefined}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-surface-scrim"
        onClick={() => {
          if (dismissible) onDismiss?.();
        }}
      />
      <div
        ref={panelRef}
        id={id}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        data-testid={testId}
        className={cx('relative flex flex-col bg-surface-raised text-fg-primary shadow-e3 outline-none', panelClassName)}
        style={panelStyle}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            if (dismissible) {
              event.stopPropagation();
              onDismiss?.();
            }
            return;
          }
          trapTab(event, panelRef.current);
        }}
      >
        {children}
      </div>
    </div>
  );
  return contained ? node : createPortal(node, document.body);
}
