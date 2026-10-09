import React, { useRef } from 'react';
import { Icon } from '../core/Icon.jsx';
import '../internal/css.js';

/* BottomNav — 02-components.md §28. Primary wayfinding on the phone apps.
   Customer (5, fixed): Home · Search · Orders · Favourites · Account. Rider (3): Home · Earnings · Account.
   - role="tablist" (named by `label`) with role="tab" items, aria-selected, roving tabindex,
     Arrow keys / Home / End move between tabs; Enter/Space (or click) activates.
   - Active: brand.600 icon + label, the icon swaps to the BOLD weight, and a 2px indicator sits
     above it — never colour alone.
   - Labels are ALWAYS visible (label.md, tokenised size). Each tab >= 44px, full height.
   - A badge is folded into the tab's name ("Orders, 2 active"; badgeNoun = "active"), not a
     separate node. `badge: true` is a dot ("Orders, new").
   - hidden: renders nothing — required during the rider offer sheet and during checkout, where
     an escape hatch would abandon a live offer or a payment. */

export function BottomNav({ items = [], active, onChange, label = 'Main', tone = 'raised', hidden = false, testId, style, ...rest }) {
  const refs = useRef([]);
  if (hidden) return null;
  const dark = tone === 'field';
  const pick = (i) => { const it = items[i]; if (it && onChange) onChange(it.key); const el = refs.current[i]; if (el) el.focus(); };
  const onKey = (e, i) => {
    const n = items.length;
    const rtl = e.currentTarget.closest('[dir="rtl"]') != null;
    const fwd = rtl ? 'ArrowLeft' : 'ArrowRight', back = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === fwd) { e.preventDefault(); refs.current[(i + 1) % n].focus(); }
    else if (e.key === back) { e.preventDefault(); refs.current[(i - 1 + n) % n].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); refs.current[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); refs.current[n - 1].focus(); }
  };
  return (
    <nav aria-label={label} data-testid={testId || 'BottomNav'} className={dark ? 'hg-on-accent' : undefined} style={{
      background: dark ? 'var(--color-accent-900)' : 'var(--surface-raised)',
      borderBlockStart: '1px solid ' + (dark ? 'var(--color-accent-800)' : 'var(--border-decorative)'),
      boxShadow: 'var(--elev-sticky)', zIndex: 'var(--z-bottom-nav)', paddingBlockEnd: 'env(safe-area-inset-bottom, 0px)', ...style,
    }} {...rest}>
      <div role="tablist" aria-label={label} style={{ display: 'flex', alignItems: 'stretch', minBlockSize: 56 }}>
        {items.map((it, i) => {
          const on = it.key === active;
          const count = typeof it.badge === 'number' && it.badge > 0 ? it.badge : null;
          const name = it.label + (count != null ? ', ' + count + (it.badgeNoun ? ' ' + it.badgeNoun : '') : it.badge === true ? ', new' : '');
          const fg = on ? (dark ? 'var(--color-brand-300)' : 'var(--color-brand-600)') : (dark ? 'var(--color-neutral-200)' : 'var(--text-tertiary)');
          return (
            <button key={it.key} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" aria-selected={on} aria-label={name}
              tabIndex={on || (active == null && i === 0) ? 0 : -1} className="hg-press hg-focus-inset hg-focus"
              onClick={() => pick(i)} onKeyDown={(e) => onKey(e, i)}
              style={{
                position: 'relative', flex: 1, minBlockSize: 56, minInlineSize: 44, display: 'grid', justifyItems: 'center', alignContent: 'center',
                gap: 2, padding: 'var(--space-1) 2px', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', color: fg,
              }}>
              <span aria-hidden="true" style={{ position: 'absolute', insetBlockStart: 0, insetInline: '28%', blockSize: 2, borderRadius: 'var(--radius-full)', background: on ? fg : 'transparent' }} />
              <span aria-hidden="true" style={{ position: 'relative' }}>
                <Icon name={it.icon} weight={on ? 'bold' : 'linear'} size={24} />
                {count != null || it.badge === true ? (
                  <span style={{
                    position: 'absolute', insetBlockStart: -4, insetInlineStart: 'calc(100% - 6px)', minInlineSize: it.badge === true ? 8 : 16,
                    blockSize: it.badge === true ? 8 : 16, paddingInline: it.badge === true ? 0 : 4, boxSizing: 'border-box',
                    display: 'grid', placeItems: 'center', background: 'var(--action-primary)', color: 'var(--text-on-brand)',
                    fontSize: 'var(--type-label-sm-size)', lineHeight: 1, fontWeight: 'var(--font-weight-bold)', fontVariantNumeric: 'var(--numeric-tabular)',
                    borderRadius: 'var(--radius-full)', boxShadow: '0 0 0 2px ' + (dark ? 'var(--color-accent-900)' : 'var(--surface-raised)'),
                  }}>{it.badge === true ? null : count > 99 ? '99+' : count}</span>
                ) : null}
              </span>
              <span aria-hidden="true" style={{ fontSize: 'var(--type-label-md-size)', letterSpacing: 'var(--type-label-md-tracking)', fontWeight: on ? 'var(--font-weight-semibold)' : 'var(--font-weight-medium)' }}>{it.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
