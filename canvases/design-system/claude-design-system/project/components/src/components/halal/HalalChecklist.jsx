import React, { useId, useMemo, useState } from 'react';
import { Button } from '../core/Button.jsx';
import { Icon } from '../core/Icon.jsx';
import { Skel, Tick } from '../internal/ui.jsx';
import {
  HALAL_CHECK_ORDER, HALAL_CHECK_DESCRIPTION, HALAL_CHECK_LOCK_REASON, HALAL_REJECTION_REASONS, RESULT_LABEL,
  OVERRIDE_NOTE_MIN_LENGTH, SCOPE_TEXT_ADMIN, isServerComputedCheck, isOverride, openApprovalGate, openRejectionGate,
} from './halal-contract.js';
import { formatAbsoluteDate } from '../internal/format.js';
import '../internal/css.js';

/* HalalChecklist (admin) — 02-components.md §14, A-15. The seven-check verification form.
   Mirrors packages/ui-web/src/certification/HalalChecklist.tsx.

   - Takes the API's HalalCertificate (and its `checks`). REQUIRED: with no certificate it shows
     an empty state; it NEVER synthesises results. Missing checks read "Not yet recorded".
   - Seven rows, fixed order H1_LEGIBLE_COMPLETE -> H7_UNIQUE_NOT_REUSED, each a <fieldset> with a
     legend (key + title), the plain-English description, a three-way control PASS / FAIL /
     Not assessed (a radio group, >= 44px options, the selected one carries a tick and a word — never
     colour alone), a note field with a counter, and "Record H{n}".
   - H5_DATES_VALID and H7_UNIQUE_NOT_REUSED are server-computed and NOT overridable: read-only,
     lock glyph, computed result, reason in aria-describedby. No control is offered.
   - H2/H3/H4 show the server's suggestion ("System suggested: Pass"); departing from it requires
     a note of >= 20 characters — blocked with an explanatory error, not a silent disable.
   - Approve renders ONLY when all seven are PASS; otherwise the footer NAMES the outstanding
     keys ("2 checks are outstanding — H1, H6"). Reject needs >= 1 FAIL and a reason code + text.
     Approve and Reject are >= 24px apart.
   - A persistent note says every value and decision is audited.
   - Slate, never red, for a failed check (invariant 9). No green fill (the seal owns green).
   States: loading (seven skeleton rows) · error (Retry; nothing recorded) · readOnly / decided. */

export function HalalChecklist({
  certificate, checks: checksProp, status = 'ready', errorMessage, onRetry, onRecord, onApprove, onReject,
  recordingKey = null, deciding = false, readOnly = false, testId, style,
}) {
  const uid = useId();
  const headingId = 'hg-halal-checklist-' + uid;
  const checks = checksProp || (certificate && certificate.checks) || [];
  const [drafts, setDrafts] = useState({});
  const [rowErrors, setRowErrors] = useState({});
  const [reason, setReason] = useState('');
  const [reasonText, setReasonText] = useState('');
  const [rejectError, setRejectError] = useState(null);
  const byKey = useMemo(() => { const m = {}; checks.forEach((c) => { m[c.check_key] = c; }); return m; }, [checks]);
  const root = { 'data-testid': testId || 'HalalChecklist', style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', fontFamily: 'var(--font-ui)', color: 'var(--text-primary)', ...style } };

  if (status === 'loading') {
    return (
      <section {...root} aria-busy="true" aria-label="Halal certification checklist">
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Loading the certification checklist…</p>
        {HALAL_CHECK_ORDER.map((k) => <Skel key={k} h={96} r="var(--radius-md)" />)}
      </section>
    );
  }
  if (status === 'error') {
    return (
      <section {...root} role="alert" aria-label="Halal certification checklist">
        <div style={{ display: 'grid', gap: 'var(--space-3)', justifyItems: 'start', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', background: 'var(--color-danger-50)', border: '1px solid var(--color-danger-100)', color: 'var(--color-danger-700)' }}>
          <h2 style={{ margin: 0, fontSize: 'var(--type-heading-sm-size)' }}>Couldn’t load the checklist</h2>
          <p style={{ margin: 0 }}>{errorMessage || 'The seven checks could not be loaded, so no decision can be recorded. Nothing has been changed.'}</p>
          {onRetry ? <Button variant="tertiary" iconStart="refresh" onPress={onRetry}>Retry</Button> : null}
        </div>
      </section>
    );
  }
  if (!certificate) {
    return (
      <section {...root} aria-label="Halal certification checklist">
        <p style={{ margin: 0, fontWeight: 'var(--font-weight-semibold)' }}>No certificate selected</p>
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Choose a certificate from the review queue to record its seven checks.</p>
      </section>
    );
  }

  const decided = certificate.status && certificate.status !== 'PENDING';
  const locked = readOnly || decided;
  const approval = openApprovalGate(certificate.id, certificate.checklist_version, checks);
  const rejection = openRejectionGate(certificate.id, checks);
  const draftFor = (c) => drafts[c.check_key] || { result: c.result, note: c.note || '' };
  const setDraft = (key, patch) => {
    setDrafts((prev) => ({ ...prev, [key]: { ...(prev[key] || { result: (byKey[key] || {}).result || 'NOT_ASSESSED', note: (byKey[key] || {}).note || '' }), ...patch } }));
    setRowErrors((prev) => ({ ...prev, [key]: undefined }));
  };
  const record = (key) => {
    const c = byKey[key];
    if (!c || !onRecord || isServerComputedCheck(key)) return;
    const d = draftFor(c);
    if (isOverride(c, d.result) && d.note.trim().length < OVERRIDE_NOTE_MIN_LENGTH) {
      setRowErrors((prev) => ({ ...prev, [key]: 'This departs from the system’s evaluation, so it needs a note of at least ' + OVERRIDE_NOTE_MIN_LENGTH + ' characters saying why. The note appears in the halal register report.' }));
      return;
    }
    onRecord({ checkKey: key, result: d.result, note: d.note || undefined });
  };
  const submitReject = () => {
    if (!onReject || !rejection.open) return;
    if (!reason) { setRejectError('Choose a reason code. A rejection without one cannot be explained to the restaurant.'); return; }
    if (reasonText.trim().length < OVERRIDE_NOTE_MIN_LENGTH) { setRejectError('The reason text is sent verbatim to the restaurant; it needs at least ' + OVERRIDE_NOTE_MIN_LENGTH + ' characters.'); return; }
    setRejectError(null);
    onReject(rejection.gate, { reasonCode: reason, reasonText: reasonText.trim() });
  };

  const scopeText = certificate.scope ? SCOPE_TEXT_ADMIN[certificate.scope] : null;
  const fields = [
    ['Certificate number', <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--type-mono-md-size)' }}>{certificate.certificate_number || '—'}</span>],
    ['Issuing body', (certificate.issuing_body && certificate.issuing_body.name) || '—'],
    ['Certified legal name', certificate.certified_legal_name || '—'],
    ['Certified address', certificate.certified_address || '—'],
    ['Issued on', formatAbsoluteDate(certificate.issued_on) || '—'],
    ['Expires on', formatAbsoluteDate(certificate.expires_on) || '—'],
    ['Scope', scopeText || '—'],
  ];
  const outstandingShort = approval.outstanding.map((k) => k.split('_')[0]);

  return (
    <section {...root} aria-labelledby={headingId}>
      <header style={{ display: 'grid', gap: 'var(--space-2)' }}>
        <h2 id={headingId} style={{ margin: 0, fontSize: 'var(--type-heading-lg-size)' }}>Halal certification checklist</h2>
        <p data-testid="HalalChecklist-audit-note" style={{ margin: 0, fontSize: 'var(--type-caption-size)', color: 'var(--text-secondary)' }}>
          Every value you record here, and every decision, is written to the audit log with your identity and the time.
        </p>
      </header>

      <dl data-testid="HalalChecklist-transcription" style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 'var(--space-4)', rowGap: 'var(--space-2)', padding: 'var(--space-4)', border: '1px solid var(--border-decorative)', borderRadius: 'var(--radius-md)' }}>
        {fields.map(([k, v]) => <React.Fragment key={k}><dt style={{ fontSize: 'var(--type-label-md-size)', color: 'var(--text-secondary)' }}>{k}</dt><dd style={{ margin: 0, fontSize: 'var(--type-body-md-size)' }}>{v}</dd></React.Fragment>)}
      </dl>

      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {HALAL_CHECK_ORDER.map((key, i) => (
          <li key={key}>
            <CheckRow uid={uid} index={i + 1} checkKey={key} check={byKey[key]} draft={byKey[key] ? draftFor(byKey[key]) : null}
              error={rowErrors[key]} busy={recordingKey === key} locked={locked} canRecord={Boolean(onRecord)}
              onResult={(r) => setDraft(key, { result: r })} onNote={(n) => setDraft(key, { note: n })} onRecord={() => record(key)} />
          </li>
        ))}
      </ol>

      <footer data-testid="HalalChecklist-decision" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        {decided ? (
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>This certificate is {String(certificate.status).toLowerCase()}. No further checks can be recorded against it.</p>
        ) : (
          <>
            {approval.open && onApprove && !locked ? (
              <div style={{ display: 'grid', gap: 'var(--space-2)', justifyItems: 'start' }} data-testid="HalalChecklist-approve-zone">
                <p style={{ margin: 0, fontSize: 'var(--type-body-sm-size)', color: 'var(--text-secondary)' }}>All seven checks pass. Approving records this certificate as verified and makes the restaurant eligible to go live; it does not by itself approve the restaurant.</p>
                <Button variant="primary" loading={deciding} onPress={() => onApprove(approval.gate)} testId="HalalChecklist-approve">Approve certificate</Button>
              </div>
            ) : (
              <p data-testid="HalalChecklist-outstanding" style={{ margin: 0, padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--surface-subtle)', border: '1px solid var(--border-decorative)', color: 'var(--text-secondary)' }}>
                {outstandingShort.length === 0 ? 'Approval is unavailable on this surface.'
                  : 'Approval is unavailable: ' + outstandingShort.length + (outstandingShort.length === 1 ? ' check is' : ' checks are') + ' outstanding — ' + outstandingShort.join(', ') + '.'}
              </p>
            )}
            {onReject && !locked ? (
              <div data-testid="HalalChecklist-reject-zone" style={{ display: 'grid', gap: 'var(--space-3)', justifyItems: 'start' }}>
                {!rejection.open ? (
                  <p style={{ margin: 0, fontSize: 'var(--type-body-sm-size)', color: 'var(--text-tertiary)' }}>Rejection becomes available once at least one check is recorded as Fail.</p>
                ) : (
                  <>
                    <label style={{ display: 'grid', gap: 'var(--space-1)', fontSize: 'var(--type-label-md-size)', inlineSize: 'min(420px, 100%)' }}>
                      Rejection reason
                      <span className="hg-field" style={{ display: 'flex', borderRadius: 'var(--radius-md)', background: 'var(--surface-raised)' }}>
                        <select value={reason} onChange={(e) => setReason(e.target.value)} required aria-required="true"
                          style={{ flex: 1, blockSize: 42, paddingInline: 'var(--space-3)', border: 'none', background: 'transparent', fontFamily: 'var(--font-ui)', fontSize: 'var(--type-body-md-size)', color: 'var(--text-primary)' }}>
                          <option value="">Choose a reason…</option>
                          {HALAL_REJECTION_REASONS.map((r) => <option key={r} value={r}>{r.split('_').join(' ').toLowerCase()}</option>)}
                        </select>
                      </span>
                    </label>
                    <NoteField label="Reason sent to the restaurant" value={reasonText} onChange={setReasonText} min={OVERRIDE_NOTE_MIN_LENGTH} suffix="Sent verbatim." />
                    {rejectError ? <p role="alert" style={{ margin: 0, fontSize: 'var(--type-body-sm-size)', color: 'var(--color-danger-600)' }}>{rejectError}</p> : null}
                    <Button variant="danger" destructive loading={deciding} onPress={submitReject} testId="HalalChecklist-reject">Reject certificate</Button>
                  </>
                )}
              </div>
            ) : null}
          </>
        )}
      </footer>
    </section>
  );
}

function titleFor(key) {
  const w = key.split('_').slice(1).join(' ').toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function NoteField({ label, value, onChange, min, disabled, invalid, describedBy, suffix, required }) {
  const uid = useId();
  const count = value.trim().length;
  return (
    <div style={{ display: 'grid', gap: 'var(--space-1)', inlineSize: '100%' }}>
      <label htmlFor={'hg-note-' + uid} style={{ fontSize: 'var(--type-label-md-size)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--text-secondary)' }}>{label}</label>
      <span className="hg-field" data-invalid={invalid ? '' : undefined} style={{ display: 'flex', borderRadius: 'var(--radius-md)', background: 'var(--surface-raised)' }}>
        <textarea id={'hg-note-' + uid} rows={2} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined} aria-describedby={['hg-note-count-' + uid, describedBy].filter(Boolean).join(' ')} aria-required={required || undefined}
          style={{ flex: 1, padding: 'var(--space-3)', border: 'none', background: 'transparent', resize: 'vertical', fontFamily: 'var(--font-ui)', fontSize: 'var(--type-body-md-size)', color: 'var(--text-primary)' }} />
      </span>
      <span id={'hg-note-count-' + uid} style={{ fontSize: 'var(--type-caption-size)', color: 'var(--text-tertiary)', fontVariantNumeric: 'var(--numeric-tabular)' }}>
        {count}/{min} characters{required ? ' — required' : ''}{suffix ? '. ' + suffix : ''}
      </span>
    </div>
  );
}

function CheckRow({ uid, index, checkKey, check, draft, error, busy, locked, canRecord, onResult, onNote, onRecord }) {
  const server = isServerComputedCheck(checkKey);
  const short = checkKey.split('_')[0];
  const legendId = 'hg-check-' + uid + '-' + checkKey;
  const lockId = legendId + '-lock';
  const errId = legendId + '-error';
  const result = (draft && draft.result) || (check && check.result) || 'NOT_ASSESSED';
  const suggested = check && check.computed_result ? check.computed_result : null;
  const overriding = check ? isOverride(check, result) : false;
  const inert = locked || busy || !canRecord;
  return (
    <fieldset data-testid={'HalalChecklist-check-' + checkKey} data-server-computed={server ? 'true' : 'false'}
      aria-readonly={server || locked ? true : undefined} aria-describedby={server ? lockId : undefined}
      style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', minInlineSize: 0,
        border: '1px solid ' + (server ? 'var(--border-interactive)' : 'var(--border-decorative)'), background: server ? 'var(--surface-subtle)' : 'var(--surface-raised)' }}>
      <legend id={legendId} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', padding: '0 var(--space-1)', fontSize: 'var(--type-label-lg-size)', fontWeight: 'var(--font-weight-semibold)' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--type-mono-md-size)' }}>{short}</span>
        <span>{titleFor(checkKey)}</span>
        {server ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--type-label-sm-size)', fontWeight: 'var(--font-weight-medium)', color: 'var(--text-secondary)' }}><Icon name="lock" size={14} />Server-computed · not overridable</span> : null}
      </legend>
      <p style={{ margin: 0, fontSize: 'var(--type-body-sm-size)', color: 'var(--text-secondary)' }}>{HALAL_CHECK_DESCRIPTION[checkKey]}</p>
      {!check ? (
        <p style={{ margin: 0, fontSize: 'var(--type-body-sm-size)', color: 'var(--text-tertiary)' }}>Not yet recorded.</p>
      ) : server ? (
        <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
          <p style={{ margin: 0 }}><strong>{RESULT_LABEL[check.computed_result || check.result]}</strong> — computed by the server.</p>
          <p id={lockId} style={{ margin: 0, fontSize: 'var(--type-caption-size)', color: 'var(--text-secondary)' }}>{HALAL_CHECK_LOCK_REASON[checkKey]}</p>
        </div>
      ) : (
        <>
          {suggested ? <p data-testid={'suggested-' + checkKey} style={{ margin: 0, fontSize: 'var(--type-body-sm-size)', color: 'var(--text-secondary)' }}>System suggested: <strong>{RESULT_LABEL[suggested]}</strong>. Changing it requires a note.</p> : null}
          <div role="radiogroup" aria-labelledby={legendId} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            {['PASS', 'FAIL', 'NOT_ASSESSED'].map((v) => {
              const on = result === v;
              return (
                <label key={v} className="hg-choice" data-disabled={inert ? '' : undefined} style={{ position: 'relative', cursor: inert ? 'not-allowed' : 'pointer' }}>
                  <input type="radio" className="hg-choice-input hg-sr" name={legendId} value={v} checked={on} disabled={inert} onChange={() => onResult(v)} />
                  <span className="hg-choice-ctl" style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, minBlockSize: 44, paddingInline: 'var(--space-3)', boxSizing: 'border-box',
                    borderRadius: 'var(--radius-sm)', fontSize: 'var(--type-label-md-size)', fontWeight: 'var(--font-weight-semibold)',
                    border: '1px solid ' + (on ? 'var(--border-brand)' : 'var(--border-interactive)'),
                    background: on ? 'var(--state-selected-tint)' : 'var(--surface-raised)', color: 'var(--text-primary)',
                    opacity: inert ? 'var(--state-disabled-opacity)' : 1,
                  }}>
                    {on ? <Tick size={14} /> : null}{RESULT_LABEL[v]}
                  </span>
                </label>
              );
            })}
          </div>
          <NoteField label={'Note' + (overriding ? ' (required for this override)' : ' (optional)')} value={(draft && draft.note) || ''} onChange={onNote}
            min={OVERRIDE_NOTE_MIN_LENGTH} disabled={inert} invalid={Boolean(error)} describedBy={error ? errId : undefined} required={overriding} />
          {error ? <p id={errId} role="alert" style={{ margin: 0, fontSize: 'var(--type-body-sm-size)', color: 'var(--color-danger-600)' }}>{error}</p> : null}
          {canRecord ? <div><Button variant="tertiary" size="md" loading={busy} disabled={locked} onPress={onRecord} testId={'HalalChecklist-record-' + checkKey}>{'Record ' + short}</Button></div> : null}
        </>
      )}
      <span className="hg-sr">Check {index} of seven.</span>
    </fieldset>
  );
}
