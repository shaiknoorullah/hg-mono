import React, { useEffect, useId } from 'react';
import { HalalBadge } from './HalalBadge.jsx';
import { HalalShield } from './HalalShield.jsx';
import { Button } from '../core/Button.jsx';
import { Skel } from '../internal/ui.jsx';
import { HALAL_DISPLAY_STATES, SCOPE_TEXT_CUSTOMER } from './halal-contract.js';
import { formatAbsoluteDate } from '../internal/format.js';
import { reportClientError } from '../internal/report.js';
import '../internal/css.js';

/* HalalCertificationPanel — 02-components.md §13. The always-reachable certification section
   on the restaurant detail page, above the menu. Fed by the API's `CertificationPanel` payload
   (GET /restaurants/{id}/certification) — passed through as `certification`, never assembled
   from defaults. There are NO placeholder strings and NO default state.

   Composition, in order: 1 HalalBadge lg/detail · 2 "Certified by {body}" · 3 certificate number
   (mono), Issued, "Valid until {absolute date}" in <time datetime> · 4 renewal note ONLY for
   EXPIRING_SOON: "Certificate renews {absolute date}" on the brass tint with the solid-clock
   shield (a note, not an alert) · 5 scope in plain English · 6 "View certificate" (tertiary;
   opening it is recorded, and says so) · 7 the standing line, always present · 8 "Report a
   halal concern" (ghost).
   There is NO customer-facing checklist: the seven checks are admin-only (HalalChecklist).

   States: loading — the seal's silhouette reserved at full size (a skeleton, NEVER a spinner in
   the seal slot) · error — the panel stays, says the details could not be loaded, offers Retry,
   and draws NO seal (no cached or defaulted state is trusted) · display_state missing/unknown —
   renders nothing and reports HALAL_DISPLAY_STATE_MISSING · UNVERIFIED — renders nothing (an
   uncertified kitchen is invisible to customers, C-12 R1).
   EXPIRED uses the slate tint — never red. The seal never animates.
   A11y: role="region" + aria-labelledby a VISIBLE "Halal certification" heading. */

export function HalalCertificationPanel({
  restaurantId, status = 'ready', certification, errorMessage, onRetry, onViewCertificate, onReportConcern,
  headingLevel = 2, testId, style, className,
}) {
  const uid = useId();
  const headingId = 'hg-halal-certification-' + uid;
  const H = 'h' + Math.min(6, Math.max(1, headingLevel));
  const state = certification ? certification.display_state : undefined;
  const known = HALAL_DISPLAY_STATES.indexOf(state) >= 0;
  useEffect(() => {
    if (status === 'ready' && !known) reportClientError('HALAL_DISPLAY_STATE_MISSING', { restaurantId, received: state, surface: 'panel' });
  }, [status, known, state, restaurantId]);

  if (status === 'ready' && (!known || state === 'UNVERIFIED')) return null;
  const expired = status === 'ready' && state === 'EXPIRED';

  const shell = (children, extra) => (
    <section role="region" aria-labelledby={headingId} data-testid={testId || 'HalalCertificationPanel'} data-status={status} className={className}
      style={{
        display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', padding: 'var(--space-5)', borderRadius: 'var(--radius-lg)',
        background: expired ? 'var(--color-halal-expired-tint)' : 'var(--color-halal-certified-tint)',
        border: '1px solid ' + (expired ? 'var(--color-halal-expired-border)' : 'var(--color-halal-certified-tint-border)'),
        color: 'var(--text-primary)', fontFamily: 'var(--font-ui)', ...style,
      }} {...extra}>
      <H id={headingId} style={{ margin: 0, fontSize: 'var(--type-heading-lg-size)', lineHeight: 'var(--type-heading-lg-line)', fontWeight: 'var(--font-weight-semibold)', color: expired ? 'var(--color-halal-expired-text)' : 'var(--color-halal-certified-tint-text)' }}>
        Halal certification
      </H>
      {children}
    </section>
  );

  if (status === 'loading') {
    return shell(
      <>
        <Skel w={160} h={32} r="var(--radius-md)" style={{ opacity: 0.7 }} />
        <Skel w="66%" h={18} /><Skel w="50%" h={18} />
        <span className="hg-sr">Loading halal certification details.</span>
      </>, { 'aria-busy': true },
    );
  }

  if (status === 'error') {
    return shell(
      <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
        <p style={{ margin: 0, fontSize: 'var(--type-body-md-size)' }}>{errorMessage || 'Couldn’t load certification details.'}</p>
        <p style={{ margin: 0, fontSize: 'var(--type-body-sm-size)', color: 'var(--text-secondary)' }}>We won’t show a certification state we can’t confirm right now.</p>
        {onRetry ? <Button variant="tertiary" iconStart="refresh" onPress={onRetry}>Retry</Button> : null}
      </div>,
    );
  }

  const c = certification;
  const issued = formatAbsoluteDate(c.issued_on);
  const expires = formatAbsoluteDate(c.expires_on);
  const verified = formatAbsoluteDate(c.verified_at);
  const standing = c.disclaimer || (verified
    ? 'Certification verified by Halal Goes on ' + verified + '. Halal Goes does not itself certify food.'
    : 'Halal Goes does not itself certify food.');
  const dt = { fontSize: 'var(--type-label-md-size)', color: 'var(--text-secondary)', fontWeight: 'var(--font-weight-semibold)' };
  const dd = { margin: 0, fontSize: 'var(--type-body-md-size)', color: 'var(--text-primary)' };

  return shell(
    <>
      <div><HalalBadge state={state} size="lg" surface="detail" restaurantId={restaurantId} certifyingBodyName={c.certifying_body_name} expiresOn={c.expires_on} /></div>
      {c.certifying_body_name ? (
        <p data-testid="HalalCertificationPanel-body" style={{ margin: 0, fontSize: 'var(--type-heading-sm-size)', fontWeight: 'var(--font-weight-semibold)' }}>Certified by {c.certifying_body_name}</p>
      ) : null}
      {c.certificate_number || issued || expires ? (
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 'var(--space-4)', rowGap: 'var(--space-1)' }}>
          {c.certificate_number ? <><dt style={dt}>Certificate</dt><dd style={{ ...dd, fontFamily: 'var(--font-mono)', fontSize: 'var(--type-mono-md-size)' }}>{c.certificate_number}</dd></> : null}
          {issued ? <><dt style={dt}>Issued</dt><dd style={dd}><time dateTime={c.issued_on}>{issued}</time></dd></> : null}
          {expires ? <><dt style={dt}>Valid until</dt><dd style={dd} data-testid="HalalCertificationPanel-expiry"><time dateTime={c.expires_on}>{expires}</time></dd></> : null}
        </dl>
      ) : null}
      {state === 'EXPIRING_SOON' && expires ? (
        <p data-testid="HalalCertificationPanel-renewal-note" style={{
          margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3)',
          background: 'var(--color-halal-expiring-tint)', border: '1px solid var(--color-halal-expiring-border)',
          borderRadius: 'var(--radius-md)', color: 'var(--color-halal-expiring-text)', fontSize: 'var(--type-body-sm-size)',
        }}>
          <span style={{ color: 'var(--color-halal-expiring-icon)' }}><HalalShield variant="solid-clock" knockout="var(--color-halal-expiring-tint)" /></span>
          <span>Certificate renews <time dateTime={c.expires_on}>{expires}</time>.</span>
        </p>
      ) : null}
      {c.scope && SCOPE_TEXT_CUSTOMER[c.scope] ? (
        <p data-testid="HalalCertificationPanel-scope" style={{ margin: 0, fontSize: 'var(--type-body-sm-size)', color: 'var(--text-secondary)' }}>{SCOPE_TEXT_CUSTOMER[c.scope]}</p>
      ) : null}
      {onViewCertificate && c.certificate_viewable !== false ? (
        <div><Button variant="tertiary" onPress={onViewCertificate} testId="HalalCertificationPanel-view">View certificate<span className="hg-sr"> — opening this is recorded</span></Button></div>
      ) : null}
      <p data-testid="HalalCertificationPanel-disclaimer" style={{ margin: 0, fontSize: 'var(--type-caption-size)', lineHeight: 'var(--type-caption-line)', color: 'var(--text-secondary)' }}>{standing}</p>
      {onReportConcern ? (
        <div><Button variant="ghost" onPress={onReportConcern} testId="HalalCertificationPanel-report">Report a halal concern</Button></div>
      ) : null}
    </>,
  );
}
