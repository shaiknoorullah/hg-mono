import React, { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../core/Icon.jsx';
import { FieldText, Skel } from '../internal/ui.jsx';
import { reportClientError } from '../internal/report.js';
import '../internal/css.js';

/* Select — 02-components.md §5. Choice from a closed, server-defined set.
   Variants:
   - native (default): a real <select> — the accessible path; mobile gets the platform picker.
   - listbox: the COMBOBOX pattern for long lists (> 8, e.g. the halal issuing-body registry):
     trigger role="combobox" + aria-expanded + aria-controls; popup role="listbox"; options
     role="option" + aria-selected; ArrowUp/Down, Home/End, type-ahead, Enter selects, Escape
     closes and returns focus to the trigger. `searchable` adds a filter field.
     (The native app renders this as a Sheet — the spec's `sheet` variant.)
   ≤ 3 short options belong in SegmentedControl, and a binary is a Switch or Radio, never a Select.
   Field chrome as Input: label required, focus = own 2px border, errorText linked + role=alert.
   loading shows skeleton rows inside the list, never an empty list; emptyText when no options. */

export function Select({
  label, variant = 'native', options = [], value, onChange, onValueChange, placeholder = 'Choose…',
  searchable = false, helperText, errorText, required = false, disabled = false, loading = false,
  emptyText = 'No options available', size = 'md', id, testId, style, ...rest
}) {
  if (!label) reportClientError('FIELD_UNLABELLED', { component: 'Select' });
  const uid = useId();
  const fid = id || 'hg-select-' + uid;
  const helpId = fid + '-help', errId = fid + '-error', listId = fid + '-list', labelId = fid + '-label';
  const invalid = Boolean(errorText);
  const h = size === 'lg' ? 52 : 44;
  const describedBy = [helperText ? helpId : null, invalid ? errId : null].filter(Boolean).join(' ') || undefined;
  const chrome = {
    position: 'relative', display: 'flex', alignItems: 'center', boxSizing: 'border-box', minBlockSize: h,
    background: disabled ? 'var(--surface-subtle)' : 'var(--surface-raised)', borderRadius: 'var(--radius-md)',
    opacity: disabled ? 'var(--state-disabled-opacity)' : 1,
  };
  const labelEl = (
    <label id={labelId} htmlFor={fid} style={{ fontSize: 'var(--type-label-md-size)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--text-secondary)' }}>
      {label}{required ? <span aria-hidden="true" style={{ color: 'var(--color-brand-700)' }}> *</span> : null}
    </label>
  );
  const texts = <>{helperText ? <FieldText id={helpId} text={helperText} /> : null}{invalid ? <FieldText id={errId} text={errorText} error /> : null}</>;

  if (variant !== 'listbox') {
    return (
      <div data-testid={testId || 'Select'} data-variant="native" style={{ display: 'grid', gap: 'var(--space-1)', ...style }}>
        {labelEl}
        <div className="hg-field" data-invalid={invalid ? '' : undefined} data-disabled={disabled ? '' : undefined} style={chrome}>
          <select id={fid} value={value == null ? '' : value} disabled={disabled || loading} required={required}
            aria-required={required || undefined} aria-invalid={invalid || undefined} aria-describedby={describedBy} aria-busy={loading || undefined}
            onChange={(e) => { if (onChange) onChange(e); if (onValueChange) onValueChange(e.target.value); }}
            style={{
              appearance: 'none', WebkitAppearance: 'none', flex: 1, blockSize: h - 2, paddingInlineStart: 'var(--space-3)', paddingInlineEnd: 40,
              border: 'none', background: 'transparent', fontFamily: 'var(--font-ui)', fontSize: 'var(--type-body-md-size)',
              color: value ? 'var(--text-primary)' : 'var(--text-placeholder)', cursor: disabled ? 'not-allowed' : 'pointer',
            }} {...rest}>
            <option value="" disabled={required}>{loading ? 'Loading…' : options.length ? placeholder : emptyText}</option>
            {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
          </select>
          <span aria-hidden="true" style={{ position: 'absolute', insetInlineEnd: 'var(--space-3)', pointerEvents: 'none', color: 'var(--text-tertiary)' }}><Icon name="chevron-down" size={20} /></span>
        </div>
        {texts}
      </div>
    );
  }

  return <Listbox {...{ label, fid, labelEl, labelId, listId, texts, describedBy, invalid, chrome, h, options, value, onChange, onValueChange, placeholder, searchable, required, disabled, loading, emptyText, testId, style }} />;
}

function Listbox({ label, fid, labelEl, labelId, listId, texts, describedBy, invalid, chrome, h, options, value, onChange, onValueChange, placeholder, searchable, required, disabled, loading, emptyText, testId, style }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const trigger = useRef(null);
  const search = useRef(null);
  const list = useRef(null);
  const wrap = useRef(null);
  const typed = useRef({ buf: '', at: 0 });
  const shown = searchable && query ? options.filter((o) => String(o.label).toLowerCase().includes(query.toLowerCase())) : options;
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return undefined;
    (searchable ? search.current : list.current)?.focus();
    const onDoc = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const openList = () => {
    if (disabled) return;
    setQuery('');
    const i = options.findIndex((o) => o.value === value);
    setActive(i >= 0 ? i : options.findIndex((o) => !o.disabled));
    setOpen(true);
  };
  const close = () => { setOpen(false); trigger.current && trigger.current.focus(); };
  const choose = (o) => {
    if (!o || o.disabled) return;
    if (onValueChange) onValueChange(o.value);
    if (onChange) onChange(o.value);
    close();
  };
  const step = (d) => {
    if (!shown.length) return;
    let i = active;
    for (let n = 0; n < shown.length; n += 1) { i = (i + d + shown.length) % shown.length; if (!shown[i].disabled) break; }
    setActive(i);
  };
  const onKeys = (e) => {
    const k = e.key;
    if (k === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (k === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (k === 'Home') { e.preventDefault(); setActive(0); }
    else if (k === 'End') { e.preventDefault(); setActive(shown.length - 1); }
    else if (k === 'Enter') { e.preventDefault(); choose(shown[active]); }
    else if (k === 'Escape') { e.preventDefault(); close(); }
    else if (k === 'Tab') { setOpen(false); }
    else if (!searchable && k.length === 1 && !e.metaKey && !e.ctrlKey) {
      const t = typed.current; const now = Date.now();
      t.buf = now - t.at > 500 ? k : t.buf + k; t.at = now;
      const i = shown.findIndex((o) => !o.disabled && String(o.label).toLowerCase().startsWith(t.buf.toLowerCase()));
      if (i >= 0) setActive(i);
    }
  };
  const optId = (i) => listId + '-opt-' + i;

  return (
    <div ref={wrap} data-testid={testId || 'Select'} data-variant="listbox" style={{ display: 'grid', gap: 'var(--space-1)', position: 'relative', ...style }}>
      {labelEl}
      <div className="hg-field" data-invalid={invalid ? '' : undefined} data-disabled={disabled ? '' : undefined} style={chrome}>
        <button ref={trigger} id={fid} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open}
          aria-controls={listId} aria-labelledby={labelId + ' ' + fid} aria-describedby={describedBy}
          aria-required={required || undefined} aria-invalid={invalid || undefined} aria-disabled={disabled || undefined}
          onClick={() => (open ? close() : openList())}
          onKeyDown={(e) => { if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openList(); } }}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', blockSize: h - 2, paddingInlineStart: 'var(--space-3)', paddingInlineEnd: 40,
            border: 'none', background: 'transparent', outline: 'none', textAlign: 'start', fontFamily: 'var(--font-ui)',
            fontSize: 'var(--type-body-md-size)', color: selected ? 'var(--text-primary)' : 'var(--text-placeholder)', cursor: disabled ? 'not-allowed' : 'pointer',
          }}>
          {selected ? selected.label : placeholder}
        </button>
        <span aria-hidden="true" style={{ position: 'absolute', insetInlineEnd: 'var(--space-3)', pointerEvents: 'none', color: 'var(--text-tertiary)' }}><Icon name="chevron-down" size={20} weight={open ? 'bold' : 'linear'} /></span>
      </div>
      {texts}
      {open ? (
        <div style={{
          position: 'absolute', insetBlockStart: 'calc(100% + 4px)', insetInlineStart: 0, insetInlineEnd: 0, zIndex: 'var(--z-dropdown)',
          background: 'var(--surface-raised)', border: '1px solid var(--border-decorative)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--elev-3)', padding: 'var(--space-1)',
        }}>
          {searchable ? (
            <div className="hg-field" style={{ ...chrome, marginBlockEnd: 'var(--space-1)', paddingInline: 'var(--space-2)', gap: 'var(--space-2)' }}>
              <Icon name="search" size={18} />
              <input ref={search} type="search" aria-label={'Search ' + (typeof label === 'string' ? label.toLowerCase() : 'options')}
                role="combobox" aria-controls={listId} aria-expanded="true" aria-autocomplete="list"
                aria-activedescendant={active >= 0 && shown[active] ? optId(active) : undefined}
                value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); }} onKeyDown={onKeys}
                style={{ flex: 1, border: 'none', background: 'transparent', blockSize: 40, fontFamily: 'var(--font-ui)', fontSize: 'var(--type-body-md-size)', color: 'var(--text-primary)' }} />
            </div>
          ) : null}
          <div ref={list} id={listId} role="listbox" aria-labelledby={labelId} tabIndex={searchable ? -1 : 0} aria-busy={loading || undefined}
            aria-activedescendant={!searchable && active >= 0 && shown[active] ? optId(active) : undefined}
            onKeyDown={searchable ? undefined : onKeys} style={{ maxBlockSize: 280, overflowY: 'auto', outline: 'none' }}>
            {loading ? [0, 1, 2, 3].map((i) => <div key={i} style={{ padding: 'var(--space-3)' }}><Skel w={i % 2 ? '55%' : '75%'} h={14} /></div>)
              : shown.length === 0 ? <div role="presentation" style={{ padding: 'var(--space-3)', color: 'var(--text-tertiary)', fontSize: 'var(--type-body-sm-size)' }}>{query ? 'No matches for “' + query + '”' : emptyText}</div>
                : shown.map((o, i) => (
                  <div key={o.value} id={optId(i)} role="option" aria-selected={o.value === value} aria-disabled={o.disabled || undefined}
                    onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)} onMouseMove={() => setActive(i)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minBlockSize: 44, paddingInline: 'var(--space-3)', borderRadius: 'var(--radius-sm)',
                      background: i === active ? 'var(--state-hover-overlay)' : 'transparent', boxShadow: i === active ? 'inset 0 0 0 2px var(--border-brand)' : 'none',
                      opacity: o.disabled ? 'var(--state-disabled-opacity)' : 1, cursor: o.disabled ? 'not-allowed' : 'pointer',
                    }}>
                    <span style={{ flex: 1, display: 'grid' }}>
                      <span style={{ fontSize: 'var(--type-body-md-size)', color: 'var(--text-primary)' }}>{o.label}</span>
                      {o.description ? <span style={{ fontSize: 'var(--type-caption-size)', color: 'var(--text-tertiary)' }}>{o.description}</span> : null}
                    </span>
                    {o.value === value ? <span style={{ color: 'var(--action-primary)' }}><Icon name="check" weight="bold" size={18} /></span> : null}
                  </div>
                ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
