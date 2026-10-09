import React, { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../core/Icon.jsx';
import { cx } from '../internal/ui.jsx';
import '../internal/css.js';

/* Menu — the MENU-BUTTON pattern (WAI-ARIA APG "Menu Button"; Radix DropdownMenu semantics).
   Owner decision C-25: specified in full here; this README/d.ts is the spec of record until
   02-components.md gains the entry.

   The Menu owns its trigger, so the wiring cannot be forgotten:
   trigger  <button aria-haspopup="menu" aria-expanded aria-controls={menuId}> with a UNIQUE
            accessible name (`label`, e.g. "Actions for order HG-10482" — never five identical
            "Actions" buttons).
   popup    role="menu" aria-labelledby={trigger}; items role="menuitem" (tabIndex -1, roving
            focus — the menu is one stop: Tab leaves it); separators role="separator".

   Keyboard
     trigger: Enter / Space / ArrowDown -> open, focus FIRST enabled item; ArrowUp -> open, focus LAST.
     menu:    ArrowDown / ArrowUp -> next / previous item (wraps) · Home / End -> first / last ·
              printable characters -> type-ahead (prefix match on the label, case-insensitive,
              500 ms buffer; repeated same letter cycles) · Enter / Space -> activate, close,
              return focus to the trigger · Escape -> close, return focus to the trigger ·
              Tab / Shift+Tab -> close, focus moves on naturally.
     Disabled items stay focusable (aria-disabled) so their reason can be read, and cannot be activated.
   Pointer: click the trigger to toggle; click outside closes (focus is not stolen back).
   Geometry: rows >= 44px (target.min), logical start/end alignment, z-dropdown, elev-3.
   A destructive item is danger text with a word ("Remove item") — never a fill, never colour alone. */

const TYPEAHEAD_MS = 500;

export function Menu({
  label, items = [], onSelect, align = 'start', icon = 'more', triggerText, triggerVariant = 'plain',
  open: openProp, onOpenChange, disabled = false, testId, style, ...rest
}) {
  const uid = useId();
  const triggerId = 'hg-menu-trigger-' + uid;
  const menuId = 'hg-menu-' + uid;
  const [openState, setOpenState] = useState(false);
  const open = openProp != null ? openProp : openState;
  const setOpen = (v) => { if (openProp == null) setOpenState(v); if (onOpenChange) onOpenChange(v); };
  const [active, setActive] = useState(-1);
  const triggerRef = useRef(null);
  const wrapRef = useRef(null);
  const itemRefs = useRef([]);
  const typed = useRef({ buf: '', at: 0 });

  const actionable = items.map((it, i) => (it && it.type !== 'separator' ? i : -1)).filter((i) => i >= 0);
  const firstEnabled = () => actionable.find((i) => !items[i].disabled);
  const lastEnabled = () => [...actionable].reverse().find((i) => !items[i].disabled);

  useEffect(() => {
    if (open && active >= 0 && itemRefs.current[active]) itemRefs.current[active].focus();
  }, [open, active]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setActive(-1); } };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('touchstart', onDoc); };
  }, [open]);

  const openAt = (which) => { if (disabled) return; setOpen(true); setActive(which === 'last' ? lastEnabled() : firstEnabled()); };
  const close = (refocus) => { setOpen(false); setActive(-1); if (refocus && triggerRef.current) triggerRef.current.focus(); };
  const activate = (i) => {
    const it = items[i];
    if (!it || it.disabled) return;
    close(true);
    if (it.onSelect) it.onSelect(it);
    if (onSelect) onSelect(it.key != null ? it.key : it.label, it);
  };
  const move = (delta) => {
    if (!actionable.length) return;
    const pos = actionable.indexOf(active);
    const next = actionable[(pos + delta + actionable.length) % actionable.length];
    setActive(next);
  };
  const typeahead = (ch) => {
    const now = Date.now();
    const t = typed.current;
    t.buf = now - t.at > TYPEAHEAD_MS ? ch : t.buf + ch;
    t.at = now;
    const q = t.buf.toLowerCase();
    const same = q.split('').every((c) => c === q[0]);
    const pos = Math.max(0, actionable.indexOf(active));
    const order = actionable.slice(pos + (same ? 1 : 0)).concat(actionable.slice(0, pos + (same ? 1 : 0)));
    const needle = same ? q[0] : q;
    const hit = order.find((i) => String(items[i].label || '').toLowerCase().startsWith(needle));
    if (hit != null) setActive(hit);
  };

  const onTriggerKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAt('first'); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); openAt('last'); }
  };
  const onMenuKey = (e) => {
    const k = e.key;
    if (k === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (k === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (k === 'Home') { e.preventDefault(); setActive(actionable[0]); }
    else if (k === 'End') { e.preventDefault(); setActive(actionable[actionable.length - 1]); }
    else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (k === 'Tab') { close(false); }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); activate(active); }
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { typeahead(k); }
  };

  const text = Boolean(triggerText);
  return (
    <div ref={wrapRef} data-testid={testId || 'Menu'} style={{ position: 'relative', display: 'inline-block', ...style }} {...rest}>
      <button ref={triggerRef} id={triggerId} type="button"
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        aria-label={text ? undefined : label} aria-disabled={disabled || undefined}
        className={cx('hg-press hg-focus', triggerVariant === 'filled' && 'hg-on-brand')}
        onClick={() => { if (disabled) return; if (open) close(false); else openAt('first'); }}
        onKeyDown={onTriggerKey}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, boxSizing: 'border-box',
          minInlineSize: 44, minBlockSize: 44, paddingInline: text ? 'var(--space-3)' : 0,
          fontFamily: 'var(--font-ui)', fontSize: 'var(--type-label-lg-size)', fontWeight: 'var(--font-weight-semibold)',
          color: triggerVariant === 'filled' ? 'var(--text-on-brand)' : 'var(--text-primary)',
          backgroundColor: triggerVariant === 'filled' ? 'var(--action-primary)' : triggerVariant === 'tonal' ? 'var(--surface-subtle)' : 'transparent',
          border: text ? '1px solid var(--border-interactive)' : '1px solid transparent', borderRadius: 'var(--radius-md)',
          opacity: disabled ? 'var(--state-disabled-opacity)' : 1, cursor: disabled ? 'not-allowed' : 'pointer',
        }}>
        {text ? <><span>{triggerText}</span><Icon name="chevron-down" size={16} weight={open ? 'bold' : 'linear'} /></> : <Icon name={icon} size={20} weight={open ? 'bold' : 'linear'} />}
      </button>
      {open ? (
        <div id={menuId} role="menu" aria-labelledby={triggerId} aria-orientation="vertical" onKeyDown={onMenuKey}
          style={{
            position: 'absolute', insetBlockStart: 'calc(100% + 4px)', [align === 'end' ? 'insetInlineEnd' : 'insetInlineStart']: 0,
            zIndex: 'var(--z-dropdown)', minInlineSize: 208, padding: 'var(--space-1)', boxSizing: 'border-box',
            background: 'var(--surface-raised)', border: '1px solid var(--border-decorative)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--elev-3)',
          }}>
          {items.map((it, i) => (it.type === 'separator' ? (
            <div key={'sep-' + i} role="separator" style={{ blockSize: 1, background: 'var(--border-decorative)', marginBlock: 'var(--space-1)' }} />
          ) : (
            <div key={it.key != null ? it.key : i} ref={(el) => { itemRefs.current[i] = el; }}
              role="menuitem" tabIndex={-1} aria-disabled={it.disabled || undefined}
              data-highlighted={active === i ? '' : undefined}
              className="hg-focus-inset"
              onClick={() => activate(i)}
              onMouseMove={() => { if (active !== i) setActive(i); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minBlockSize: 44, paddingInline: 'var(--space-3)',
                borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-ui)', fontSize: 'var(--type-body-md-size)', textAlign: 'start',
                color: it.destructive ? 'var(--color-danger-600)' : 'var(--text-primary)',
                background: active === i ? 'var(--state-hover-overlay)' : 'transparent',
                opacity: it.disabled ? 'var(--state-disabled-opacity)' : 1, cursor: it.disabled ? 'not-allowed' : 'pointer', outline: 'none',
              }}>
              {it.icon ? <Icon name={it.icon} size={20} /> : null}
              <span style={{ flex: 1, display: 'grid' }}>
                <span>{it.label}</span>
                {it.disabled && it.disabledReason ? <span style={{ fontSize: 'var(--type-caption-size)', color: 'var(--text-tertiary)' }}>{it.disabledReason}</span> : null}
              </span>
              {it.hint ? <span aria-hidden="true" style={{ fontSize: 'var(--type-caption-size)', color: 'var(--text-tertiary)' }}>{it.hint}</span> : null}
            </div>
          )))}
        </div>
      ) : null}
    </div>
  );
}
