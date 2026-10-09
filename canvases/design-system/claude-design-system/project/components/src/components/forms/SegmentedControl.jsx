import React, { useRef } from 'react';
import { Icon } from '../core/Icon.jsx';
import { cx } from '../internal/ui.jsx';
import '../internal/css.js';

/* SegmentedControl — two or three exclusive, short options that FILTER or switch a VIEW MODE in
   place (e.g. "Order food | List your restaurant", "Delivery | Pickup").
   It is a RADIOGROUP, not tabs: role="radiogroup" (named by `label`) with role="radio" segments,
   ONE tab stop (roving tabindex), Arrow keys move AND select, Home/End jump.
   If the choice reveals different PANELS, use Tabs (variant="pill") instead — tabs need
   tabpanels, aria-controls and the full tabs pattern.
   Spec mapping: this is 02-components.md §5 Select variant="inline" (<= 3 short options); the
   spec needs an entry under this name (see CHANGES C-26).
   Every segment is >= 44px (sm keeps a 36px visual with an expanded hit area). Colours are role
   tokens on both tones — no raw rgba. The selected segment swaps its icon to the bold weight. */

const H = { sm: 36, md: 44, lg: 52 };

export function SegmentedControl({ label, options = [], value, onChange, onValueChange, tone = 'light', size = 'md', fullWidth = false, testId, style, ...rest }) {
  const refs = useRef([]);
  const chrome = tone === 'chrome';
  const h = H[size] || H.md;
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const selectedIdx = options.findIndex((o) => o.value === value);
  const focusIdx = selectedIdx >= 0 ? selectedIdx : enabled[0];
  const choose = (i) => {
    const o = options[i];
    if (!o || o.disabled) return;
    if (onChange) onChange(o.value);
    if (onValueChange) onValueChange(o.value);
    const el = refs.current[i]; if (el) el.focus();
  };
  const onKey = (e, i) => {
    const pos = enabled.indexOf(i);
    const rtl = e.currentTarget.closest('[dir="rtl"]') != null;
    const fwd = rtl ? 'ArrowLeft' : 'ArrowRight', back = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === fwd || e.key === 'ArrowDown') { e.preventDefault(); choose(enabled[(pos + 1) % enabled.length]); }
    else if (e.key === back || e.key === 'ArrowUp') { e.preventDefault(); choose(enabled[(pos - 1 + enabled.length) % enabled.length]); }
    else if (e.key === 'Home') { e.preventDefault(); choose(enabled[0]); }
    else if (e.key === 'End') { e.preventDefault(); choose(enabled[enabled.length - 1]); }
  };
  return (
    <div role="radiogroup" aria-label={label} data-testid={testId || 'SegmentedControl'} className={chrome ? 'hg-on-accent' : undefined} style={{
      display: fullWidth ? 'flex' : 'inline-flex', inlineSize: fullWidth ? '100%' : undefined, padding: 3, gap: 2, boxSizing: 'border-box',
      background: chrome ? 'var(--color-accent-700)' : 'var(--surface-sunken)',
      border: '1px solid ' + (chrome ? 'var(--color-accent-600)' : 'var(--border-decorative)'),
      borderRadius: 'var(--radius-full)', ...style,
    }} {...rest}>
      {options.map((o, i) => {
        const active = i === selectedIdx;
        return (
          <button key={o.value} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={active}
            aria-disabled={o.disabled || undefined} tabIndex={i === focusIdx ? 0 : -1}
            className={cx('hg-press hg-focus', size === 'sm' && 'hg-hit')}
            onClick={() => choose(i)} onKeyDown={(e) => onKey(e, i)}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, flex: fullWidth ? 1 : undefined,
              minBlockSize: h, paddingInline: size === 'sm' ? 'var(--space-3)' : 'var(--space-4)',
              fontFamily: 'var(--font-ui)', fontSize: size === 'sm' ? 'var(--type-label-md-size)' : 'var(--type-label-lg-size)',
              fontWeight: 'var(--font-weight-semibold)', whiteSpace: 'nowrap',
              color: active ? (chrome ? 'var(--color-accent-800)' : 'var(--text-primary)') : (chrome ? 'var(--color-neutral-100)' : 'var(--text-secondary)'),
              backgroundColor: active ? (chrome ? 'var(--color-neutral-0)' : 'var(--surface-raised)') : 'transparent',
              boxShadow: active ? 'var(--elev-1)' : 'none', border: 'none', borderRadius: 'var(--radius-full)',
              opacity: o.disabled ? 'var(--state-disabled-opacity)' : 1, cursor: o.disabled ? 'not-allowed' : 'pointer',
            }}>
            {o.icon ? <Icon name={o.icon} weight={active ? 'bold' : 'linear'} size={16} /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
