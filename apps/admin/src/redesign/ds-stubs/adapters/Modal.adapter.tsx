/**
 * Live design-system `Modal`. `@hg/ui-web` has only `ConfirmDialog` (a different API), so the
 * live props are implemented over the shared overlay. In the admin redesign the ONLY modal is
 * the session-ended dialog (constitution §5 rule 5): decisions open as in-page DetailPanels.
 */
import { useId, useRef, type CSSProperties, type ReactNode } from 'react';

import { Overlay } from '../internal/Overlay';
import { Button } from './Button.adapter';
import { IconButton } from './IconButton.adapter';

export interface ModalProps {
  open: boolean;
  variant?: 'dialog' | 'confirm' | 'alert';
  title: string;
  description?: string;
  children?: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
  confirmLabel?: string;
  onConfirm?: () => void;
  confirmLoading?: boolean;
  cancelLabel?: string;
  destructive?: boolean;
  acknowledgeLabel?: string;
  dismissible?: boolean;
  size?: 'sm' | 'md' | 'lg';
  contained?: boolean;
  testId?: string;
  style?: CSSProperties;
}

const WIDTH = { sm: 'w-[400px]', md: 'w-[520px]', lg: 'w-[720px]' };

export function Modal({
  open,
  variant = 'dialog',
  title,
  description,
  children,
  actions,
  onClose,
  confirmLabel = 'Confirm',
  onConfirm,
  confirmLoading,
  cancelLabel = 'Cancel',
  destructive,
  acknowledgeLabel = 'OK',
  dismissible = true,
  size = 'md',
  contained,
  testId = 'Modal',
  style,
}: ModalProps): React.JSX.Element | null {
  const id = useId();
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const ackRef = useRef<HTMLButtonElement | null>(null);
  const role = variant === 'dialog' ? 'dialog' : 'alertdialog';
  const initial = variant === 'confirm' ? cancelRef : variant === 'alert' ? ackRef : undefined;

  return (
    <Overlay
      open={open}
      role={role}
      labelledBy={titleId}
      {...(description ? { describedBy: descId } : {})}
      dismissible={variant === 'dialog' ? dismissible : false}
      {...(onClose ? { onDismiss: onClose } : {})}
      placement="center"
      {...(initial ? { initialFocusRef: initial } : {})}
      {...(contained !== undefined ? { contained } : {})}
      panelClassName={`max-w-full gap-4 rounded-xl p-6 ${WIDTH[size]}`}
      {...(style ? { panelStyle: style } : {})}
      testId={testId}
    >
      <div className="flex items-start justify-between gap-4">
        <h2 id={titleId} className="text-heading-md text-fg-primary">
          {title}
        </h2>
        {variant === 'dialog' && dismissible ? (
          <IconButton icon="close" accessibilityLabel="Close" onPress={() => onClose?.()} />
        ) : null}
      </div>
      {description ? (
        <p id={descId} className="text-body-md text-fg-secondary">
          {description}
        </p>
      ) : null}
      {children}
      <div className="flex flex-wrap justify-end gap-3">
        {variant === 'dialog' ? actions : null}
        {variant === 'confirm' ? (
          <>
            <Button ref={cancelRef} variant="tertiary" onPress={() => onClose?.()}>
              {cancelLabel}
            </Button>
            <Button
              variant={destructive ? 'danger' : 'primary'}
              loading={Boolean(confirmLoading)}
              destructive={Boolean(destructive)}
              onPress={() => onConfirm?.()}
            >
              {confirmLabel}
            </Button>
          </>
        ) : null}
        {variant === 'alert' ? (
          <Button ref={ackRef} onPress={() => onClose?.()}>
            {acknowledgeLabel}
          </Button>
        ) : null}
      </div>
    </Overlay>
  );
}
