import React, { useId, useRef } from 'react';
import { Button } from '../core/Button.jsx';
import { IconButton } from '../core/IconButton.jsx';
import { useModalFocus } from '../internal/focus.js';
import '../internal/css.js';

/* Modal — 02-components.md §31 (formerly `Dialog` in this system).
   Variants: dialog (title + body + actions) · confirm (a decision, usually destructive) ·
   alert (a single acknowledgement).
   - role="dialog" for `dialog`; role="alertdialog" for `confirm` and `alert` (announces at once).
   - aria-modal; the TITLE is the accessible name (aria-labelledby); the description is
     aria-describedby.
   - Focus moves in on open — onto the LEAST destructive action for confirm (Cancel) — is trapped,
     and returns to the trigger on close. Escape closes when `dismissible`; scrim click too.
   - Close button is a real 44px target. The confirm action can be `loading` (keeps its label).
   - Never a modal for anything a Toast or an inline error could carry. Never for rider offers
     (those are a non-dismissible full Sheet). */

const WIDTH = { sm: 400, md: 480, lg: 640 };

export function Modal({
  open = false, variant = 'dialog', title, description, children, actions, onClose,
  confirmLabel, onConfirm, confirmLoading = false, cancelLabel = 'Cancel', destructive = false,
  acknowledgeLabel = 'OK', dismissible, size = 'md', contained = false, testId, style, ...rest
}) {
  const uid = useId();
  const titleId = 'hg-modal-title-' + uid;
  const descId = 'hg-modal-desc-' + uid;
  const ref = useRef(null);
  const canDismiss = dismissible != null ? dismissible : true;
  const close = canDismiss && onClose ? onClose : undefined;
  useModalFocus(ref, open, {
    onEscape: close,
    initialFocus: variant === 'confirm' ? '[data-modal-least-destructive]' : variant === 'alert' ? '[data-modal-ack]' : undefined,
  });
  if (!open) return null;
  const alert = variant === 'confirm' || variant === 'alert';

  let footer = actions || null;
  if (variant === 'confirm') {
    footer = (
      <>
        <Button variant="tertiary" onPress={onClose} data-modal-least-destructive="">{cancelLabel}</Button>
        <Button variant={destructive ? 'danger' : 'primary'} destructive={destructive} loading={confirmLoading} onPress={onConfirm}>{confirmLabel}</Button>
      </>
    );
  } else if (variant === 'alert') {
    footer = <Button variant="primary" onPress={onClose} data-modal-ack="">{acknowledgeLabel}</Button>;
  }

  return (
    <div role="presentation" data-testid={(testId || 'Modal') + '-scrim'}
      onMouseDown={(e) => { if (e.target === e.currentTarget && close) close(); }}
      style={{
        position: contained ? 'absolute' : 'fixed', inset: 0, zIndex: 'var(--z-modal)', background: 'var(--surface-scrim)',
        display: 'grid', placeItems: 'center', padding: 'var(--space-4)',
      }}>
      <div ref={ref} role={alert ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined} tabIndex={-1}
        data-testid={testId || 'Modal'} data-variant={variant} className="hg-modal-in"
        style={{
          boxSizing: 'border-box', inlineSize: '100%', maxInlineSize: WIDTH[size] || WIDTH.md, maxBlockSize: '100%', overflow: 'auto',
          background: 'var(--surface-raised)', color: 'var(--text-primary)', outline: 'none',
          borderRadius: 'var(--radius-xl)', boxShadow: 'var(--elev-4)', padding: 'var(--space-6)', ...style,
        }} {...rest}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', marginBlockEnd: 'var(--space-4)' }}>
          <div style={{ flex: 1, display: 'grid', gap: 'var(--space-2)' }}>
            <h2 id={titleId} style={{ margin: 0, fontSize: 'var(--type-heading-lg-size)', lineHeight: 'var(--type-heading-lg-line)', fontWeight: 'var(--font-weight-semibold)', letterSpacing: 'var(--type-heading-lg-tracking)' }}>{title}</h2>
            {description ? <p id={descId} style={{ margin: 0, fontSize: 'var(--type-body-md-size)', lineHeight: 'var(--type-body-md-line)', color: 'var(--text-secondary)' }}>{description}</p> : null}
          </div>
          {close && variant === 'dialog' ? <IconButton icon="close" accessibilityLabel="Close" onPress={close} style={{ marginBlockStart: -8, marginInlineEnd: -8 }} /> : null}
        </div>
        {children}
        {footer ? <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 'var(--space-3)', marginBlockStart: 'var(--space-6)' }}>{footer}</div> : null}
      </div>
    </div>
  );
}

/** Deprecated alias (old name, old default open=true) so existing kit screens keep rendering.
    Use Modal. Exported, but not listed as a component card. */
export function Dialog(props) {
  return <Modal open {...props} />;
}
