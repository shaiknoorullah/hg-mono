import React, { createContext, useContext, useId } from 'react';
import { Price } from '../data/Price.jsx';
import { FieldText } from '../internal/ui.jsx';
import '../internal/css.js';

/* Radio + RadioGroup — 02-components.md §7. Exactly one from a set (variants, refund reasons,
   tip amount, payment method).
   - ALWAYS inside a RadioGroup: a <fieldset role="radiogroup"> with a visible legend
     (aria-labelledby). Native radios sharing a name make the group ONE tab stop; arrow keys move
     and select within it.
   - The drawn control is the input's next sibling, so the focus ring lands on the control.
   - The whole row is the target (>= 44px). Control 20 or 24. Selected = brand, never green.
   - disabledReason ("Out of stock") in text.tertiary, linked to its option.
   - priceDeltaCents renders through Price (sign always).
   - Required-group validation (`error`) is announced ON THE GROUP, not on the last option. */

const Ctx = createContext(null);

export function RadioGroup({
  label, name, value, onChange, onValueChange, options, children, orientation = 'vertical', required = false,
  disabled = false, error, size = 20, hideLabel = false, testId, style, ...rest
}) {
  const uid = useId();
  const legendId = 'hg-radiogroup-' + uid;
  const errId = legendId + '-error';
  const groupName = name || legendId;
  const select = (v, e) => { if (onChange) onChange(v, e); if (onValueChange) onValueChange(v); };
  return (
    <Ctx.Provider value={{ name: groupName, value, select, disabled, size, invalid: Boolean(error) }}>
      <fieldset role="radiogroup" aria-labelledby={legendId} aria-required={required || undefined}
        aria-invalid={error ? true : undefined} aria-describedby={error ? errId : undefined}
        data-testid={testId || 'RadioGroup'} style={{ border: 'none', margin: 0, padding: 0, minInlineSize: 0, ...style }} {...rest}>
        <legend id={legendId} className={hideLabel ? 'hg-sr' : undefined} style={{ padding: 0, marginBlockEnd: 'var(--space-1)', fontSize: 'var(--type-label-md-size)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--text-secondary)' }}>
          {label}{required ? <span aria-hidden="true" style={{ color: 'var(--color-brand-700)' }}> *</span> : null}
        </legend>
        <div style={{ display: 'flex', flexDirection: orientation === 'horizontal' ? 'row' : 'column', flexWrap: 'wrap', columnGap: 'var(--space-4)' }}>
          {options ? options.map((o) => <Radio key={o.value} {...o} />) : children}
        </div>
        {error ? <FieldText id={errId} text={error} error /> : null}
      </fieldset>
    </Ctx.Provider>
  );
}

export function Radio({ label, description, value, disabled: disabledProp = false, disabledReason, priceDeltaCents, checked: checkedProp, onChange, name: nameProp, id, testId, style, ...rest }) {
  const g = useContext(Ctx);
  const uid = useId();
  const fid = id || 'hg-radio-' + uid;
  const size = g ? g.size : 20;
  const checked = g ? g.value === value : Boolean(checkedProp);
  const disabled = disabledProp || (g && g.disabled);
  const descId = fid + '-desc', reasonId = fid + '-reason';
  const describedBy = [description ? descId : null, disabled && disabledReason ? reasonId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div data-testid={testId || 'Radio'} style={style}>
      <label htmlFor={fid} className="hg-choice" data-disabled={disabled ? '' : undefined} style={{
        display: 'flex', gap: 'var(--space-3)', alignItems: description ? 'flex-start' : 'center', minBlockSize: 44,
        paddingBlock: 'var(--space-2)', cursor: disabled ? 'not-allowed' : 'pointer', position: 'relative',
      }}>
        <input id={fid} type="radio" className="hg-choice-input hg-sr" name={g ? g.name : nameProp} value={value}
          checked={checked} disabled={disabled} aria-describedby={describedBy}
          onChange={(e) => { if (g) g.select(value, e); if (onChange) onChange(e); }} {...rest} />
        <span aria-hidden="true" className="hg-choice-ctl" style={{
          flex: '0 0 auto', inlineSize: size, blockSize: size, boxSizing: 'border-box', display: 'grid', placeItems: 'center',
          marginBlockStart: description ? 2 : 0, borderRadius: 'var(--radius-full)', background: 'var(--surface-raised)',
          border: '1.5px solid ' + (g && g.invalid ? 'var(--color-danger-500)' : checked ? 'var(--action-primary)' : 'var(--border-interactive)'),
          opacity: disabled ? 'var(--state-disabled-opacity)' : 1,
          transition: 'border-color var(--duration-fast) var(--ease-standard)',
        }}>
          {checked ? <span style={{ inlineSize: size / 2, blockSize: size / 2, borderRadius: 'var(--radius-full)', background: 'var(--action-primary)' }} /> : null}
        </span>
        <span style={{ flex: 1, display: 'grid', gap: 2, opacity: disabled ? 'var(--state-disabled-opacity)' : 1 }}>
          <span style={{ fontSize: 'var(--type-body-md-size)', color: 'var(--text-primary)' }}>{label}</span>
          {description ? <span id={descId} style={{ fontSize: 'var(--type-body-sm-size)', color: 'var(--text-tertiary)' }}>{description}</span> : null}
        </span>
        {typeof priceDeltaCents === 'number' ? <Price cents={priceDeltaCents} sign="always" size="sm" style={{ color: 'var(--text-secondary)' }} /> : null}
      </label>
      {disabled && disabledReason ? <div id={reasonId} style={{ fontSize: 'var(--type-caption-size)', color: 'var(--text-tertiary)', paddingInlineStart: size + 12 }}>{disabledReason}</div> : null}
    </div>
  );
}
