/**
 * Live design-system `Sheet`. `@hg/ui-web` has no sheet, so the live props are implemented
 * over the shared overlay: `bottom` (default), `side` (inline-end edge) and `full`. Focus is
 * trapped, Escape and the scrim close it when `dismissible`, and focus returns to the opener.
 * For the left-edge navigation drawer use `NavDrawer` (the live Sheet opens only at
 * inline-end).
 */
import { useId, type CSSProperties, type ReactNode } from 'react';

import { cx } from '../internal/cx';
import { Overlay } from '../internal/Overlay';
import { IconButton } from './IconButton.adapter';

export interface SheetProps {
  open: boolean;
  variant?: 'bottom' | 'side' | 'full';
  title: string;
  hideTitle?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
  onClose?: () => void;
  dismissible?: boolean;
  maxHeight?: string;
  contained?: boolean;
  testId?: string;
  style?: CSSProperties;
}

export function Sheet({
  open,
  variant = 'bottom',
  title,
  hideTitle,
  children,
  footer,
  onClose,
  dismissible = true,
  maxHeight,
  contained,
  testId = 'Sheet',
  style,
}: SheetProps): React.JSX.Element | null {
  const titleId = `${useId()}-title`;
  const panel =
    variant === 'side'
      ? 'h-full w-[420px] max-w-full'
      : variant === 'full'
        ? 'h-full w-full'
        : 'w-full rounded-t-xl';
  return (
    <Overlay
      open={open}
      role="dialog"
      labelledBy={titleId}
      dismissible={dismissible}
      {...(onClose ? { onDismiss: onClose } : {})}
      placement={variant === 'side' ? 'inline-end' : variant === 'full' ? 'full' : 'bottom'}
      {...(contained !== undefined ? { contained } : {})}
      panelClassName={panel}
      panelStyle={{ ...(maxHeight ? { maxHeight } : {}), ...style }}
      testId={testId}
    >
      <div className="flex items-center justify-between gap-3 border-b border-line-decorative px-4 py-3">
        <h2 id={titleId} className={cx('text-heading-sm text-fg-primary', hideTitle && 'sr-only')}>
          {title}
        </h2>
        {dismissible ? <IconButton icon="close" accessibilityLabel={`Close ${title}`} onPress={() => onClose?.()} /> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
      {footer ? <div className="border-t border-line-decorative p-4">{footer}</div> : null}
    </Overlay>
  );
}
