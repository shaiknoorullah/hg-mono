/**
 * TEMPORARY stub until @hg/ui-web/ds ships NavDrawer (ds-request issue TBD; tracked under #192).
 * Props follow the canvases' drawing (manifest §1: "at 200% zoom the SideNav collapses into a
 * NavDrawer behind Open navigation").
 *
 * A left-edge modal sheet on the forest chrome holding the SideNav (the live Sheet opens only
 * at inline-end). Focus is trapped inside, Escape, "Close navigation" and a tap on the scrim
 * close it, and focus returns to whatever opened it ("Open navigation"). The title
 * "Navigation" is visually hidden but names the dialog.
 */
import { useId, type ReactNode } from 'react';

import { Icon } from './adapters/Icon.adapter';
import { Overlay } from './internal/Overlay';
import { cx } from './internal/cx';
import { FOCUS_ON_CHROME } from './internal/focus';

export interface NavDrawerProps {
  open: boolean;
  onClose: () => void;
  /** The SideNav (pass `collapsed={false}`). */
  children: ReactNode;
  /** Visually hidden dialog title. Default "Navigation". */
  title?: string;
  /** Default "Close navigation". */
  closeLabel?: string;
  testId?: string;
  /** Stable id of the drawer, for "Open navigation"'s `aria-controls`. */
  id?: string;
}

export function NavDrawer({
  open,
  onClose,
  children,
  title = 'Navigation',
  closeLabel = 'Close navigation',
  testId = 'NavDrawer',
  id,
}: NavDrawerProps): React.JSX.Element | null {
  const titleId = `${useId()}-title`;
  return (
    <Overlay
      open={open}
      role="dialog"
      labelledBy={titleId}
      dismissible
      onDismiss={onClose}
      placement="inline-start"
      panelClassName="h-full max-w-full bg-surface-chrome text-fg-on-accent"
      testId={testId}
      {...(id ? { id } : {})}
    >
      <h2 id={titleId} className="sr-only">
        {title}
      </h2>
      <div className="flex justify-end bg-surface-chrome px-3 pt-3">
        <button
          type="button"
          aria-label={closeLabel}
          onClick={onClose}
          className={cx('inline-flex size-11 items-center justify-center rounded-md text-fg-on-accent', FOCUS_ON_CHROME)}
        >
          <Icon name="close" size="md" />
        </button>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </Overlay>
  );
}
