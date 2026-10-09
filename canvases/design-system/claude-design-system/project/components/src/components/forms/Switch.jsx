import React, { useId } from 'react';
import { FieldText, Spinner } from '../internal/ui.jsx';
import { reportClientError } from '../internal/report.js';
import '../internal/css.js';

/* Switch — 02-components.md §8. Immediate, self-applying binary state (rider online/offline,
   restaurant accepting orders, item availability, admin flags).
   - role="switch" + aria-checked on a real <button>; the focus ring lands on the track.
   - Track: border.strong OFF (>= 3:1 against the surface, WCAG 1.4.11) / action.trackOn
     (brand.600) ON. Never green.
   - `stateLabel` {on, off} is REQUIRED and rendered as visible text ("Online" / "Offline"):
     state is never conveyed by thumb position alone.
   - loading: spinner in the thumb, the switch STAYS IN ITS OLD POSITION until the server
     confirms (no optimistic flip that snaps back), aria-busy, presses ignored.
   - The row is the label; the switch is the one control (44px target). */

export function Switch({
  label, description, stateLabel, checked = false, onCheckedChange, onChange, loading = false,
  disabled = false, error, name, size = 'md', id, testId, style, ...rest
}) {
  if (!stateLabel || !stateLabel.on || !stateLabel.off) reportClientError('SWITCH_STATE_LABEL_MISSING', { label });
  const uid = useId();
  const fid = id || 'hg-switch-' + uid;
  const labelId = fid + '-label', stateId = fid + '-state', descId = fid + '-desc', errId = fid + '-error';
  const w = size === 'sm' ? 40 : 48, h = size === 'sm' ? 24 : 28, knob = h - 6;
  const inert = disabled || loading;
  const words = stateLabel || { on: 'On', off: 'Off' };
  const toggle = (e) => {
    if (inert) { e.preventDefault(); return; }
    if (onCheckedChange) onCheckedChange(!checked);
    if (onChange) onChange(!checked, e);
  };
  return (
    <div data-testid={testId || 'Switch'} style={style}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minBlockSize: 44, opacity: disabled ? 'var(--state-disabled-opacity)' : 1 }}>
        <span style={{ flex: 1, display: 'grid', gap: 2 }}>
          <label id={labelId} htmlFor={fid} style={{ fontSize: 'var(--type-body-md-size)', color: 'var(--text-primary)', cursor: inert ? 'default' : 'pointer' }}>{label}</label>
          {description ? <span id={descId} style={{ fontSize: 'var(--type-body-sm-size)', color: 'var(--text-tertiary)' }}>{description}</span> : null}
        </span>
        <span id={stateId} aria-hidden="true" style={{ fontSize: 'var(--type-label-md-size)', fontWeight: 'var(--font-weight-semibold)', color: checked ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
          {checked ? words.on : words.off}
        </span>
        <button id={fid} type="button" role="switch" aria-checked={checked} aria-labelledby={labelId}
          aria-describedby={[description ? descId : null, error ? errId : null].filter(Boolean).join(' ') || undefined}
          aria-busy={loading || undefined} aria-disabled={disabled || undefined}
          className="hg-focus hg-hit" onClick={toggle} {...rest}
          style={{
            flex: '0 0 auto', inlineSize: w, blockSize: h, padding: 3, boxSizing: 'border-box', border: 'none',
            borderRadius: 'var(--radius-full)', background: checked ? 'var(--action-track-on)' : 'var(--border-strong)',
            display: 'flex', alignItems: 'center', justifyContent: checked ? 'flex-end' : 'flex-start',
            cursor: disabled ? 'not-allowed' : loading ? 'progress' : 'pointer',
            transition: 'background-color var(--duration-base) var(--ease-standard)',
          }}>
          <span aria-hidden="true" style={{
            inlineSize: knob, blockSize: knob, borderRadius: 'var(--radius-full)', background: 'var(--color-neutral-0)',
            boxShadow: 'var(--elev-1)', display: 'grid', placeItems: 'center', color: 'var(--text-secondary)',
          }}>{loading ? <Spinner size={knob - 8} /> : null}</span>
        </button>
        {name ? <input type="hidden" name={name} value={checked ? 'on' : 'off'} /> : null}
      </div>
      <span className="hg-sr" aria-live="polite">{loading ? 'Updating ' + label : ''}</span>
      {error ? <FieldText id={errId} text={error} error /> : null}
    </div>
  );
}
