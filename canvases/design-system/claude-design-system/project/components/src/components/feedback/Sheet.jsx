import React, { useId, useRef } from 'react';
import { IconButton } from '../core/IconButton.jsx';
import { useModalFocus } from '../internal/focus.js';
import '../internal/css.js';

/* Sheet — 02-components.md §30. Variants: bottom (default) · side (admin filters / detail,
   inline-end edge) · full (the rider offer).
   - role="dialog" + aria-modal + aria-labelledby (the title is required).
   - Focus moves in on open, is trapped, and returns to the trigger on close.
   - `dismissible` (default true): Escape, scrim tap and a VISIBLE close button (44px) all close.
     The drag handle is decorative and never the only way out.
   - dismissible={false} is the rider offer (D-14): no scrim tap, no Escape, no close button until
     the server's expires_at — the caller closes it. Use variant="full" with it.
   - Keyboard avoiding: the footer is sticky inside the scroll area so a submit button never sits
     under an on-screen keyboard on web; native implementations must use keyboardAvoiding. */

export function Sheet({
  open = false, variant = 'bottom', title, hideTitle = false, children, footer, onClose, dismissible = true,
  maxHeight, contained = false, testId, style, ...rest
}) {
  const uid = useId();
  const titleId = 'hg-sheet-title-' + uid;
  const ref = useRef(null);
  const close = dismissible && onClose ? onClose : undefined;
  useModalFocus(ref, open, { onEscape: close });
  if (!open) return null;

  const side = variant === 'side';
  const full = variant === 'full';
  const panel = {
    boxSizing: 'border-box', display: 'flex', flexDirection: 'column', background: 'var(--surface-raised)', color: 'var(--text-primary)',
    boxShadow: 'var(--elev-4)', outline: 'none', overflow: 'hidden',
    ...(side ? { blockSize: '100%', inlineSize: 'min(420px, 100%)', marginInlineStart: 'auto', borderStartStartRadius: 'var(--radius-2xl)', borderEndStartRadius: 'var(--radius-2xl)' }
      : full ? { blockSize: '100%', inlineSize: '100%' }
        : { maxBlockSize: maxHeight || '86%', inlineSize: '100%', borderStartStartRadius: 'var(--radius-2xl)', borderStartEndRadius: 'var(--radius-2xl)' }),
    ...style,
  };
  return (
    <div role="presentation" data-testid={(testId || 'Sheet') + '-scrim'}
      onMouseDown={(e) => { if (e.target === e.currentTarget && close) close(); }}
      style={{
        position: contained ? 'absolute' : 'fixed', inset: 0, zIndex: full ? 'var(--z-offer-sheet)' : 'var(--z-sheet)',
        display: 'flex', flexDirection: side ? 'row' : 'column', justifyContent: side ? 'flex-end' : 'flex-end',
        background: full ? 'transparent' : 'var(--surface-scrim)',
      }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        data-testid={testId || 'Sheet'} data-variant={variant} data-dismissible={dismissible ? 'true' : 'false'}
        className="hg-sheet-in" style={panel} {...rest}>
        {variant === 'bottom' ? <div aria-hidden="true" style={{ inlineSize: 40, blockSize: 4, borderRadius: 'var(--radius-full)', background: 'var(--border-strong)', opacity: 0.4, margin: 'var(--space-2) auto 0', flex: '0 0 auto' }} /> : null}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-5) 0', flex: '0 0 auto' }}>
          <h2 id={titleId} className={hideTitle ? 'hg-sr' : undefined} style={{ flex: 1, margin: 0, fontSize: 'var(--type-heading-lg-size)', fontWeight: 'var(--font-weight-semibold)' }}>{title}</h2>
          {close ? <IconButton icon="close" accessibilityLabel="Close" onPress={close} style={{ marginInlineEnd: -8 }} /> : null}
        </div>
        <div style={{ flex: '1 1 auto', overflowY: 'auto', padding: 'var(--space-3) var(--space-5) var(--space-5)' }}>{children}</div>
        {footer ? <div style={{ flex: '0 0 auto', padding: 'var(--space-3) var(--space-5) var(--space-5)', borderBlockStart: '1px solid var(--border-decorative)', background: 'var(--surface-raised)' }}>{footer}</div> : null}
      </div>
    </div>
  );
}
