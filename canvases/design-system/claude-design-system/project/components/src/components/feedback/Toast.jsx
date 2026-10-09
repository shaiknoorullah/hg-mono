import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '../core/Icon.jsx';
import { cx } from '../internal/ui.jsx';
import '../internal/css.js';

/* Toast — 02-components.md §32. Variants: neutral · success · warning · danger · info.
   There is NO halal toast: the shield is drawn only by HalalBadge / HalalCertificationPanel
   (C-10). An admin "certificate approved" confirmation is `success` text.
   `success` is a tint with a success.600 icon — never a green fill (RULE H-1).
   - role="status" (polite); `danger` is role="alert" (assertive).
   - duration defaults to 5000 ms; `danger` and any toast with an `action` are PERSISTENT.
   - The timer PAUSES while the pointer is over the toast or focus is inside it.
   - Dismiss is a real 44px target. Never the sole carrier of an error that blocks a task. */

const VARIANTS = {
  neutral: { bg: 'var(--surface-raised)', fg: 'var(--text-primary)', border: 'var(--border-decorative)', icon: 'info', iconFg: 'var(--text-secondary)' },
  success: { bg: 'var(--color-success-50)', fg: 'var(--color-success-800)', border: 'var(--color-success-100)', icon: 'check', iconFg: 'var(--color-success-600)' },
  warning: { bg: 'var(--color-warning-50)', fg: 'var(--color-warning-700)', border: 'var(--color-warning-100)', icon: 'warning', iconFg: 'var(--color-warning-600)' },
  danger: { bg: 'var(--color-danger-50)', fg: 'var(--color-danger-700)', border: 'var(--color-danger-100)', icon: 'error', iconFg: 'var(--color-danger-600)' },
  info: { bg: 'var(--color-info-50)', fg: 'var(--color-info-700)', border: 'var(--color-info-100)', icon: 'info', iconFg: 'var(--color-info-600)' },
};

export function Toast({ variant = 'neutral', title, description, action, duration, onDismiss, icon, testId, style, ...rest }) {
  const v = VARIANTS[variant] || VARIANTS.neutral;
  const persistent = variant === 'danger' || Boolean(action) || duration === Infinity || duration === 0;
  const ms = persistent ? null : (typeof duration === 'number' ? duration : 5000);
  const [paused, setPaused] = useState(false);
  const left = useRef(ms);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (ms == null || paused || !dismissRef.current) return undefined;
    const started = Date.now();
    const id = setTimeout(() => { if (dismissRef.current) dismissRef.current(); }, left.current);
    return () => { clearTimeout(id); left.current = Math.max(0, left.current - (Date.now() - started)); };
  }, [paused, ms]);

  return (
    <div role={variant === 'danger' ? 'alert' : 'status'} aria-live={variant === 'danger' ? 'assertive' : 'polite'} aria-atomic="true"
      data-testid={testId || 'Toast'} data-variant={variant} className="hg-toast-in"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false); }}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', boxSizing: 'border-box', minBlockSize: 48,
        paddingBlock: 'var(--space-2)', paddingInlineStart: 'var(--space-4)', paddingInlineEnd: onDismiss ? 'var(--space-1)' : 'var(--space-4)',
        background: v.bg, color: v.fg, border: '1px solid ' + v.border, borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--elev-3)', fontFamily: 'var(--font-ui)', ...style,
      }} {...rest}>
      <span style={{ color: v.iconFg, paddingBlockStart: 10 }}><Icon name={icon || v.icon} size={20} /></span>
      <div style={{ flex: 1, display: 'grid', gap: 2, paddingBlock: 10 }}>
        <span style={{ fontSize: 'var(--type-label-lg-size)', fontWeight: 'var(--font-weight-semibold)' }}>{title}</span>
        {description ? <span style={{ fontSize: 'var(--type-body-sm-size)', lineHeight: 'var(--type-body-sm-line)' }}>{description}</span> : null}
      </div>
      {action ? (
        <button type="button" className="hg-press hg-focus" onClick={action.onAction} style={{
          alignSelf: 'center', minBlockSize: 44, paddingInline: 'var(--space-3)', border: 'none', borderRadius: 'var(--radius-sm)',
          backgroundColor: 'transparent', color: 'inherit', font: 'inherit', fontSize: 'var(--type-label-lg-size)',
          fontWeight: 'var(--font-weight-semibold)', textDecoration: 'underline', cursor: 'pointer',
        }}>{action.label}</button>
      ) : null}
      {onDismiss ? (
        <button type="button" aria-label="Dismiss" className={cx('hg-press hg-focus')} onClick={onDismiss} style={{
          display: 'grid', placeItems: 'center', inlineSize: 44, blockSize: 44, flex: '0 0 auto', padding: 0, color: 'inherit',
          backgroundColor: 'transparent', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
        }}><Icon name="close" size={18} /></button>
      ) : null}
    </div>
  );
}
