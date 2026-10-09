/* Halal verification console (/certificates/:id), replacing the old certification queue.
   Order of work: document beside the transcription form -> the seven checks -> decision.
   The seven checks are the DS HalalChecklist fed the API's HalalCertificate: it owns the
   H5/H7 server-computed lock, the "System suggested" H2–H4 rows, the 20-character override
   note, the all-seven-PASS approval gate and the reject reason (HalalRejectionReasonCode).
   This screen adds only the review lock (take-next, review_lock_expires_at, visible owner)
   and the confirm Modals. Never red for a halal state. */
const { Card, Button, Input, Select, HalalChecklist, Modal, Toast } = window.HalalGoesDesignSystem_d11a47;

/* Document viewer placeholder. Gap: DocumentViewer. The scan is served from a private
   bucket through a short-lived presigned URL (invariant 7). */
function GapDocumentViewer({ expired }) {
  return (
    <Gap name="DocumentViewer" style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto', minHeight: 520, background: 'var(--surface-sunken)', border: '1px solid var(--border-decorative)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--surface-raised)', borderBottom: '1px solid var(--border-decorative)', fontSize: 'var(--type-body-sm-size)' }}>
        <span style={{ flex: 1 }}>halal-certificate.pdf · page 1 of 2</span>
        <span style={{ color: 'var(--text-tertiary)' }}>Private link · expires in 4:12</span>
      </div>
      <div style={{ display: 'grid', placeItems: 'center', padding: 24, color: 'var(--text-tertiary)', textAlign: 'center', fontSize: 'var(--type-body-sm-size)' }}>
        {expired
          ? <span style={{ display: 'grid', gap: 10, justifyItems: 'center' }}>The private link expired.<Button size="sm" variant="secondary" iconStart="refresh">Get a new link</Button></span>
          : 'Certificate scan renders here (zoom, rotate, page through)'}
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', padding: 8, background: 'var(--surface-raised)', borderTop: '1px solid var(--border-decorative)' }}>
        <Button size="sm" variant="ghost" iconStart="back">Prev</Button><Button size="sm" variant="ghost" iconEnd="chevron-right">Next</Button>
      </div>
    </Gap>
  );
}

const KEYS = ['H1_LEGIBLE_COMPLETE', 'H2_ISSUER_ACCEPTED', 'H3_NAME_MATCH', 'H4_ADDRESS_MATCH', 'H5_DATES_VALID', 'H6_SCOPE_SUFFICIENT', 'H7_UNIQUE_NOT_REUSED'];
const LOCKED_KEYS = ['H5_DATES_VALID', 'H7_UNIQUE_NOT_REUSED'];
/* Per variant: [result per check], H5 computed result, certificate status. */
const START = {
  incomplete: { results: ['PASS', 'PASS', 'PASS', 'NOT_ASSESSED', 'PASS', 'NOT_ASSESSED', 'PASS'], status: 'PENDING' },
  allpass: { results: ['PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS'], status: 'PENDING' },
  onefail: { results: ['PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'FAIL', 'PASS'], status: 'PENDING', notes: { H6_SCOPE_SUFFICIENT: 'Scope printed as SUPPLIER_CHAIN_ONLY: covers the meat supplier, not the kitchen.' } },
  locked: { results: ['PASS', 'PASS', 'NOT_ASSESSED', 'NOT_ASSESSED', 'PASS', 'NOT_ASSESSED', 'PASS'], status: 'PENDING' },
  rejected: { results: ['PASS', 'PASS', 'PASS', 'PASS', 'FAIL', 'NOT_ASSESSED', 'PASS'], status: 'REJECTED' },
};
const SUGGESTED = { H2_ISSUER_ACCEPTED: 'PASS', H3_NAME_MATCH: 'PASS', H4_ADDRESS_MATCH: 'PASS' };

function buildCertificate(variant) {
  const v = START[variant];
  return {
    id: ID.cert, status: v.status, checklist_version: 1,
    certificate_number: 'HMA-ON-2026-0417', issuing_body: { name: BODIES[0].name },
    certified_legal_name: 'Karahi House Restaurant Inc.', certified_address: '3025 Kennedy Rd, Unit 4, Toronto ON M1V 1S3',
    issued_on: '2026-01-15', expires_on: variant === 'rejected' ? '2026-09-30' : '2027-01-14', scope: variant === 'onefail' ? 'SUPPLIER_CHAIN_ONLY' : 'WHOLE_ESTABLISHMENT',
    checks: KEYS.map((k, i) => ({
      check_key: k, result: v.results[i],
      computed_result: LOCKED_KEYS.includes(k) ? v.results[i] : SUGGESTED[k] || null,
      overridable: !LOCKED_KEYS.includes(k),
      note: (v.notes && v.notes[k]) || null,
      checked_at: v.results[i] === 'NOT_ASSESSED' ? null : '2026-09-03T14:0' + i + ':00-04:00',
    })),
  };
}

function VerificationScreen({ state, variant = 'incomplete' }) {
  const [cert, setCert] = React.useState(() => buildCertificate(variant));
  const [dialog, setDialog] = React.useState(null);
  const [done, setDone] = React.useState(null);
  React.useEffect(() => { setCert(buildCertificate(variant)); setDone(null); setDialog(null); }, [variant]);
  const locked = variant === 'locked';
  const rejected = variant === 'rejected';
  const ro = locked || rejected;
  const record = ({ checkKey, result, note }) => setCert(c => ({ ...c, checks: c.checks.map(ch => ch.check_key === checkKey ? { ...ch, result, note: note || ch.note } : ch) }));
  return (
    <Stateful state={state}
      loading={<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}><GapSkeleton rows={1} height={480} /><HalalChecklist status="loading" /></div>}
      empty={<div style={{ display: 'grid', gap: 16 }}><GapEmptyState icon="orders" title="No certificate on this application" body="The restaurant has not uploaded a halal certificate yet. It cannot be verified or listed without one." /><HalalChecklist certificate={null} /></div>}
      error={<HalalChecklist status="error" errorMessage="The certificate record or its private link failed to load. Nothing was changed." onRetry={() => {}} />}>
      <div style={{ position: 'relative', display: 'grid', gap: 'var(--space-4)' }}>
        {locked && <GapBanner tone="warning" icon="lock" title="Maryam K. is reviewing this certificate">Locked until 14:32 (review_lock_expires_at). You can read it; you cannot record checks or decide until the lock is released or expires.</GapBanner>}
        {!ro && <GapBanner tone="info" icon="lock" title="You hold the review lock until 14:48">Claimed with Take next. The lock renews while you work.</GapBanner>}
        {rejected && <GapBanner tone="neutral" title="Rejected · Expired or expiring (EXPIRED_OR_EXPIRING)">Decided by you at 14:21. H5 failed: the certificate expires within the minimum remaining window. The restaurant has been asked for a renewed certificate.</GapBanner>}
        {done && <Toast variant="success" title={done} onDismiss={() => setDone(null)} />}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1fr)', gap: 'var(--space-5)', alignItems: 'start' }}>
          <GapDocumentViewer />
          <Card radius="lg" variant="outlined" style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: 'var(--type-heading-md-size)', fontWeight: 600 }}>Transcription</h3>
              <ShortId id={ID.cert} />
            </div>
            <p style={{ margin: 0, fontSize: 'var(--type-body-sm-size)', color: 'var(--text-tertiary)' }}>Type exactly what the certificate says. The restaurant never types these fields.</p>
            <Input label="Certified legal name" value={cert.certified_legal_name} onChange={() => {}} readOnly={ro} />
            <Input label="Certified address" value={cert.certified_address} onChange={() => {}} readOnly={ro} />
            <Input label="Certificate number" helperText="Sample free text, as printed on the certificate" value={cert.certificate_number} onChange={() => {}} readOnly={ro} />
            <Select label="Issuing body" value={BODIES[0].id} onValueChange={() => {}} disabled={ro}
              options={BODIES.filter(b => b.status === 'ACCEPTED').map(b => ({ value: b.id, label: b.name }))} helperText="From the registry. Only ACCEPTED bodies satisfy H2." />
            <Select label="Scope" value={cert.scope} onValueChange={() => {}} disabled={ro}
              options={opts(['WHOLE_ESTABLISHMENT', 'KITCHEN_ONLY', 'SPECIFIC_MENU_ITEMS', 'SUPPLIER_CHAIN_ONLY'])} helperText="Specific items or supplier-only scopes fail H6." />
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 12 }}>
              <Input label="Issued on" helperText="YYYY-MM-DD" value={cert.issued_on} onChange={() => {}} readOnly={ro} />
              <Input label="Expires on" helperText="YYYY-MM-DD" value={cert.expires_on} onChange={() => {}} readOnly={ro} />
            </div>
            <Button variant="secondary" disabled={ro} style={{ justifySelf: 'start' }}>Save transcription</Button>
          </Card>
        </div>

        <HalalChecklist certificate={cert} readOnly={locked}
          onRecord={record}
          onApprove={() => setDialog('approve')}
          onReject={() => setDialog('reject')} />

        <Modal contained open={dialog === 'approve'} variant="confirm" onClose={() => setDialog(null)} title="Approve Karahi House?"
          description="The badge goes live on every customer surface immediately. HalalGoes records that it verified the certificate — it does not certify the food."
          confirmLabel="Approve and publish" onConfirm={() => { setDialog(null); setDone('Certificate approved for Karahi House'); }} />
        <Modal contained open={dialog === 'reject'} variant="confirm" destructive onClose={() => setDialog(null)} title="Reject this certificate?"
          description="The restaurant sees the reason and can upload a new certificate. It stays off the app until one is approved."
          confirmLabel="Reject certificate" onConfirm={() => { setDialog(null); setDone('Certificate rejected. The restaurant has been told why.'); }} />
      </div>
    </Stateful>
  );
}
Object.assign(window, { VerificationScreen });
