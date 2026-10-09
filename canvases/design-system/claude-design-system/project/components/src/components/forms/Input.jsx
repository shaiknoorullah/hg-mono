import React, { useId, useState } from 'react';
import { Icon } from '../core/Icon.jsx';
import { FieldText, Spinner } from '../internal/ui.jsx';
import { reportClientError } from '../internal/report.js';
import '../internal/css.js';

/* Input — 02-components.md §3, focus per docs/decisions/focus-indicator.md.
   - `label` is REQUIRED and always visible; placeholder is never the label.
   - Bordered field: 1px border.interactive · hover border.strong (pointer only) · focus = its own
     border at 2px in the focus colour (border.brand), NO ring, NO glow · error = 2px danger border
     AND, when focused, the two-layer ring (the one case with two indicators, two meanings).
   - Ids come from useId (never from label text). helperText and errorText are linked through
     aria-describedby; errorText is role="alert" with an icon (never colour-only); the input
     gets aria-invalid; `required` reaches the <input> (required + aria-required).
   - States: disabled (surface.subtle, disabled opacity) · readOnly · loading (trailing spinner,
     still editable unless readOnly) · success (trailing check in success.600 — no green fill).
   - Variants: text · email · tel (+1, autoComplete tel) · numeric · password · search · otp
     (6 cells over ONE real field, autoComplete one-time-code, paste-aware).
   - maxLength with characterCount shows a counter and announces remaining characters at 80%
     and at the limit. */

const VARIANT_ATTRS = {
  text: { type: 'text' },
  email: { type: 'email', inputMode: 'email', autoComplete: 'email' },
  tel: { type: 'tel', inputMode: 'tel', autoComplete: 'tel-national' },
  numeric: { type: 'text', inputMode: 'numeric', pattern: '[0-9]*' },
  password: { type: 'password', autoComplete: 'current-password' },
  search: { type: 'search', inputMode: 'search' },
  otp: { type: 'text', inputMode: 'numeric', autoComplete: 'one-time-code', pattern: '[0-9]*', maxLength: 6 },
};

export function Input({
  label, variant = 'text', size = 'md', value, defaultValue, onChange, onValueChange, placeholder,
  helperText, errorText, required = false, disabled = false, readOnly = false, loading = false, success = false,
  prefix, suffix, iconStart, maxLength, characterCount = false, autoComplete, inputMode, id, testId, style, ...rest
}) {
  if (!label) reportClientError('FIELD_UNLABELLED', { component: 'Input' });
  const uid = useId();
  const fid = id || 'hg-input-' + uid;
  const helpId = fid + '-help';
  const errId = fid + '-error';
  const countId = fid + '-count';
  const attrs = VARIANT_ATTRS[variant] || VARIANT_ATTRS.text;
  const [inner, setInner] = useState(defaultValue != null ? String(defaultValue) : '');
  const val = value != null ? String(value) : inner;
  const limit = maxLength || attrs.maxLength;
  const [said, setSaid] = useState('');
  const invalid = Boolean(errorText);
  const h = size === 'lg' ? 52 : 44;

  const handle = (e) => {
    let next = e.target.value;
    if (variant === 'otp' || variant === 'numeric') next = next.replace(/\D+/g, '');
    if (variant === 'otp') next = next.slice(0, 6);
    if (value == null) setInner(next);
    if (limit && characterCount) {
      const n = next.length;
      if (n === limit) setSaid('Character limit reached.');
      else if (n >= Math.ceil(limit * 0.8) && val.length < Math.ceil(limit * 0.8)) setSaid((limit - n) + ' characters left.');
    }
    // onChange gets the native event; onValueChange gets the cleaned value (digits only for otp/numeric).
    if (onChange) onChange(e);
    if (onValueChange) onValueChange(next);
  };

  const describedBy = [helperText ? helpId : null, invalid ? errId : null, limit && characterCount ? countId : null].filter(Boolean).join(' ') || undefined;
  const inputProps = {
    id: fid, ...attrs, value: val, onChange: handle, placeholder, disabled, readOnly, required,
    'aria-required': required || undefined, 'aria-invalid': invalid || undefined, 'aria-describedby': describedBy,
    maxLength: limit, autoComplete: autoComplete || attrs.autoComplete, inputMode: inputMode || attrs.inputMode,
  };

  const shell = {
    display: 'flex', alignItems: 'center', gap: 'var(--space-2)', boxSizing: 'border-box', minBlockSize: h, paddingInline: 'var(--space-3)',
    background: disabled ? 'var(--surface-subtle)' : 'var(--surface-raised)', borderRadius: 'var(--radius-md)',
    opacity: disabled ? 'var(--state-disabled-opacity)' : 1, cursor: disabled ? 'not-allowed' : 'text',
  };
  const text = {
    flex: 1, minInlineSize: 0, border: 'none', background: 'transparent', padding: 0, blockSize: h - 2,
    fontFamily: 'var(--font-ui)', fontSize: 'var(--type-body-md-size)', color: 'var(--text-primary)',
    fontVariantNumeric: variant === 'tel' || variant === 'numeric' || variant === 'otp' ? 'var(--numeric-tabular)' : 'normal',
  };

  return (
    <div data-testid={testId || 'Input'} data-variant={variant} style={{ display: 'grid', gap: 'var(--space-1)', ...style }}>
      <label htmlFor={fid} style={{ fontSize: 'var(--type-label-md-size)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--text-secondary)' }}>
        {label}{required ? <span aria-hidden="true" style={{ color: 'var(--color-brand-700)' }}> *</span> : null}
      </label>
      {variant === 'otp' ? (
        <div className="hg-field" data-invalid={invalid ? '' : undefined} data-disabled={disabled ? '' : undefined}
          style={{ ...shell, position: 'relative', justifyContent: 'space-between', paddingInline: 'var(--space-2)', inlineSize: 'fit-content', gap: 'var(--space-2)' }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} aria-hidden="true" style={{
              inlineSize: 36, blockSize: h - 12, display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-sm)',
              background: 'var(--surface-sunken)', fontSize: 'var(--type-heading-md-size)', fontWeight: 'var(--font-weight-semibold)',
              fontVariantNumeric: 'var(--numeric-tabular)', color: 'var(--text-primary)',
            }}>{val[i] || ''}</span>
          ))}
          <input {...rest} {...inputProps} style={{ position: 'absolute', inset: 0, opacity: 0, inlineSize: '100%', blockSize: '100%', border: 'none', caretColor: 'transparent' }} />
        </div>
      ) : (
        <div className="hg-field" data-invalid={invalid ? '' : undefined} data-disabled={disabled ? '' : undefined} style={shell}>
          {iconStart || variant === 'search' ? <span style={{ color: 'var(--text-tertiary)' }}><Icon name={iconStart || 'search'} size={20} /></span> : null}
          {variant === 'tel' && !prefix ? <span aria-hidden="true" style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'var(--numeric-tabular)' }}>+1</span> : null}
          {prefix ? <span style={{ color: 'var(--text-secondary)' }}>{prefix}</span> : null}
          <input {...rest} {...inputProps} style={text} />
          {loading ? <span style={{ color: 'var(--text-tertiary)' }}><Spinner size={16} /></span> : null}
          {success && !loading && !invalid ? <span style={{ color: 'var(--color-success-600)' }}><Icon name="check" size={20} accessibilityLabel="Valid" /></span> : null}
          {suffix ? <span style={{ color: 'var(--text-secondary)' }}>{suffix}</span> : null}
        </div>
      )}
      {helperText ? <FieldText id={helpId} text={helperText} /> : null}
      {invalid ? <FieldText id={errId} text={errorText} error /> : null}
      {limit && characterCount ? (
        <div id={countId} style={{ fontSize: 'var(--type-caption-size)', color: 'var(--text-tertiary)', textAlign: 'end', fontVariantNumeric: 'var(--numeric-tabular)' }}>{val.length}/{limit}</div>
      ) : null}
      <span className="hg-sr" aria-live="polite">{said}</span>
    </div>
  );
}
