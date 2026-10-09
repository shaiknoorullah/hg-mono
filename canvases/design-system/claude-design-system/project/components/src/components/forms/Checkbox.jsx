import React, { useEffect, useId, useRef } from 'react';
import { Price } from '../data/Price.jsx';
import { Tick, Bar, FieldText } from '../internal/ui.jsx';
import '../internal/css.js';

/* Checkbox — 02-components.md §6. Independent booleans (multi-select add-ons, consent, admin
   bulk selection).
   - A real <input type="checkbox"> carries the semantics; the drawn box is its next sibling, so
     the two-layer focus ring lands ON THE CONTROL (input:focus-visible + box), never on an
     invisible element.
   - indeterminate sets the DOM property, so assistive tech announces "mixed", not checked.
   - The whole row is the target (>= 44px); hover/pressed overlay the control.
   - checked = brand fill + onBrand tick — never green. Control 20 or 24.
   - disabledReason is shown in text.tertiary ("Out of stock") and linked to the input.
   - priceDeltaCents renders through Price (sign always). error is linked + announced. */

export function Checkbox({
  label, description, checked = false, indeterminate = false, onChange, onCheckedChange, disabled = false,
  disabledReason, priceDeltaCents, error, size = 20, name, value, id, testId, style, ...rest
}) {
  const uid = useId();
  const fid = id || 'hg-checkbox-' + uid;
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = Boolean(indeterminate); }, [indeterminate]);
  const on = checked || indeterminate;
  const descId = fid + '-desc', reasonId = fid + '-reason', errId = fid + '-error';
  const describedBy = [description ? descId : null, disabled && disabledReason ? reasonId : null, error ? errId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div data-testid={testId || 'Checkbox'} style={style}>
      <label htmlFor={fid} className="hg-choice" data-disabled={disabled ? '' : undefined} style={{
        display: 'flex', gap: 'var(--space-3)', alignItems: description ? 'flex-start' : 'center', minBlockSize: 44,
        paddingBlock: 'var(--space-2)', cursor: disabled ? 'not-allowed' : 'pointer', position: 'relative',
      }}>
        <input ref={ref} id={fid} type="checkbox" className="hg-choice-input hg-sr" name={name} value={value}
          checked={checked} disabled={disabled} aria-describedby={describedBy} aria-invalid={error ? true : undefined}
          onChange={(e) => { if (onChange) onChange(e); if (onCheckedChange) onCheckedChange(e.target.checked); }} {...rest} />
        <span aria-hidden="true" className="hg-choice-ctl" style={{
          flex: '0 0 auto', inlineSize: size, blockSize: size, boxSizing: 'border-box', display: 'grid', placeItems: 'center',
          marginBlockStart: description ? 2 : 0, borderRadius: 'var(--radius-xs)', color: 'var(--text-on-brand)',
          background: on ? 'var(--action-primary)' : 'var(--surface-raised)',
          border: '1.5px solid ' + (error ? 'var(--color-danger-500)' : on ? 'var(--action-primary)' : 'var(--border-interactive)'),
          opacity: disabled ? 'var(--state-disabled-opacity)' : 1,
          transition: 'background-color var(--duration-fast) var(--ease-standard)',
        }}>
          {indeterminate ? <Bar size={size - 6} /> : checked ? <Tick size={size - 6} /> : null}
        </span>
        <span style={{ flex: 1, display: 'grid', gap: 2, opacity: disabled ? 'var(--state-disabled-opacity)' : 1 }}>
          <span style={{ fontSize: 'var(--type-body-md-size)', color: 'var(--text-primary)' }}>{label}</span>
          {description ? <span id={descId} style={{ fontSize: 'var(--type-body-sm-size)', color: 'var(--text-tertiary)' }}>{description}</span> : null}
        </span>
        {typeof priceDeltaCents === 'number' ? <Price cents={priceDeltaCents} sign="always" size="sm" style={{ color: 'var(--text-secondary)' }} /> : null}
      </label>
      {disabled && disabledReason ? <div id={reasonId} style={{ fontSize: 'var(--type-caption-size)', color: 'var(--text-tertiary)', paddingInlineStart: size + 12 }}>{disabledReason}</div> : null}
      {error ? <FieldText id={errId} text={error} error /> : null}
    </div>
  );
}
