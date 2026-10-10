/**
 * Modal — a blocking dialog (02-components.md §31; live `index.d.ts`,
 * `components/Modal/README.md`). Formerly `Dialog`, which stays as a deprecated alias.
 *
 * On web it is for **confirm and alert only**: working tasks are in-page panels, never overlays
 * (constitution gate item 11), and the restaurant console uses InlineConfirm instead.
 *
 * - `dialog` is `role="dialog"`; `confirm` and `alert` are `role="alertdialog"` and announce at
 *   once. `aria-modal`, `aria-labelledby` (the title) and `aria-describedby` (the description).
 * - Focus moves in on open: onto the **least destructive** action for `confirm` (Cancel), onto
 *   OK for `alert`. It is trapped, and returns to the trigger on close (Radix Dialog).
 * - `dismissible` (default true): Escape, a scrim click and the 44px close button call
 *   `onClose`. When false, only the footer actions can.
 */

import { useId, useRef, type CSSProperties, type ReactNode } from 'react';

import { Dialog as DialogRoot, DialogContent, DialogDescription, DialogTitle } from '../lib/ui/dialog.js';
import { cn } from '../lib/utils.js';
import { Button, IconButton } from './index.js';

/** Props of the live `Modal` (index.d.ts). */
export interface ModalProps {
  open: boolean;
  /** dialog = title + body + actions · confirm = a decision (alertdialog) · alert = one acknowledgement (alertdialog). */
  variant?: 'dialog' | 'confirm' | 'alert';
  /** REQUIRED — the accessible name (aria-labelledby). */
  title: string;
  /** aria-describedby. */
  description?: string;
  children?: ReactNode;
  /** `dialog` only: the footer actions. */
  actions?: ReactNode;
  /** Called by Cancel / OK, the close button, Escape and scrim — the latter three only when dismissible. */
  onClose?: () => void;
  /** confirm: the decisive action. */
  confirmLabel?: string;
  onConfirm?: () => void;
  confirmLoading?: boolean;
  /** confirm: the least destructive action — receives initial focus. Default "Cancel". */
  cancelLabel?: string;
  /** confirm: the decisive action uses the danger variant. */
  destructive?: boolean;
  /** alert: default "OK". */
  acknowledgeLabel?: string;
  /** Escape / scrim / close button close it. Default true. */
  dismissible?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** Position inside the nearest positioned ancestor instead of the viewport (docs/previews). */
  contained?: boolean;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: CSSProperties;
}

const WIDTH = { sm: 'max-w-100', md: 'max-w-120', lg: 'max-w-160' } as const;

/** A blocking confirm or alert (or, rarely, a short dialog). Renders nothing while closed. */
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
  confirmLoading = false,
  cancelLabel = 'Cancel',
  destructive = false,
  acknowledgeLabel = 'OK',
  dismissible = true,
  size = 'md',
  contained = false,
  testId = 'Modal',
  style,
}: ModalProps) {
  const uid = useId();
  const descriptionId = `hg-modal-desc-${uid}`;
  const panel = useRef<HTMLDivElement>(null);
  const isAlert = variant === 'confirm' || variant === 'alert';
  const close = dismissible ? onClose : undefined;

  let footer: ReactNode = actions ?? null;
  if (variant === 'confirm') {
    footer = (
      <>
        <span data-modal-initial-focus="" className="contents">
          <Button variant="tertiary" onPress={() => onClose?.()}>
            {cancelLabel}
          </Button>
        </span>
        <Button
          variant={destructive ? 'danger' : 'primary'}
          destructive={destructive}
          loading={confirmLoading}
          onPress={() => onConfirm?.()}
        >
          {confirmLabel}
        </Button>
      </>
    );
  } else if (variant === 'alert') {
    footer = (
      <span data-modal-initial-focus="" className="contents">
        <Button variant="primary" onPress={() => onClose?.()}>
          {acknowledgeLabel}
        </Button>
      </span>
    );
  }

  return (
    <DialogRoot
      open={open}
      onOpenChange={(next) => {
        if (!next) close?.();
      }}
    >
      {open ? (
        <DialogContent
          ref={panel}
          contained={contained}
          role={isAlert ? 'alertdialog' : 'dialog'}
          aria-describedby={description ? descriptionId : undefined}
          data-testid={testId}
          data-variant={variant}
          overlayTestId={`${testId}-scrim`}
          className={cn(WIDTH[size])}
          style={style}
          onOpenAutoFocus={(event) => {
            const target = panel.current?.querySelector<HTMLElement>('[data-modal-initial-focus] button, [data-modal-initial-focus] a');
            if (target) {
              event.preventDefault();
              target.focus();
            }
          }}
          onEscapeKeyDown={(event) => {
            if (!close) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (!close) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (!close) event.preventDefault();
          }}
        >
          <div className="mb-4 flex items-start gap-3">
            <div className="grid flex-1 gap-2">
              <DialogTitle className="m-0 text-heading-lg font-semibold text-fg-primary">{title}</DialogTitle>
              {description ? (
                <DialogDescription id={descriptionId} className="m-0 text-body-md text-fg-secondary">
                  {description}
                </DialogDescription>
              ) : null}
            </div>
            {close && variant === 'dialog' ? (
              <span className="-me-2 -mt-2">
                <IconButton icon="close" accessibilityLabel="Close" onPress={() => close()} />
              </span>
            ) : null}
          </div>
          {children}
          {footer ? <div className="mt-6 flex flex-wrap justify-end gap-3">{footer}</div> : null}
        </DialogContent>
      ) : null}
    </DialogRoot>
  );
}

/** Deprecated alias (the old name; defaults `open` to true). Use `Modal`. */
export function Dialog(props: Partial<ModalProps>) {
  return <Modal title="" {...props} open={props.open ?? true} />;
}
