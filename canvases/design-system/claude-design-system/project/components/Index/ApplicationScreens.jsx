/* Application detail (RestaurantApplication) and rider application detail (RiderApplication).
   Documents are KycDocuments reviewed one by one; the application decision stays disabled
   while `blockers` is non-empty. */
const { Card, Button, Badge, Select, Input, DataTable, Checkbox, Modal } = window.HalalGoesDesignSystem_d11a47;

function DocTable({ docs, locked, onReject }) {
  return (
    <DataTable caption="Submitted documents" density="compact" rows={docs} rowLabel={r => human(r.doc_type) + ' version ' + r.version}
      rowActions={r => [{ label: 'Open document' }].concat(r.state === 'IN_REVIEW' || r.state === 'SUBMITTED'
        ? [{ type: 'separator' }, { label: 'Approve document', disabled: locked, disabledReason: locked ? 'Another admin holds the lock' : undefined }, { label: 'Reject document…', disabled: locked, disabledReason: locked ? 'Another admin holds the lock' : undefined, onSelect: onReject }] : [])}
      columns={[
      { key: 'doc_type', label: 'Document', render: r => human(r.doc_type) },
      { key: 'version', label: 'Version', numeric: true, render: r => 'v' + r.version },
      { key: 'state', label: 'State', render: r => <KycBadge s={r.state} /> },
      { key: 'valid_until', label: 'Valid until', muted: true, render: r => r.valid_until || '—' },
    ]} />
  );
}

function Blockers({ list }) {
  if (!list.length) return <GapBanner tone="neutral" icon="check" title="No blockers">Every required document is approved and the halal certificate is verified.</GapBanner>;
  return <GapBanner tone="warning" title={list.length + ' blocker' + (list.length > 1 ? 's' : '') + ' before approval'}><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{list.map(b => <li key={b}>{b}</li>)}</ul></GapBanner>;
}

function ApplicationScreen({ state, variant = 'review', go }) {
  const [dlg, setDlg] = React.useState(null);
  const locked = variant === 'locked';
  const ready = variant === 'ready';
  const docs = [
    { id: 'a', doc_type: 'BUSINESS_LICENCE', version: 1, state: 'APPROVED', valid_until: '31 Dec 2026' },
    { id: 'b', doc_type: 'HALAL_CERTIFICATE', version: 2, state: ready ? 'APPROVED' : 'IN_REVIEW', valid_until: '14 Jan 2027' },
    { id: 'c', doc_type: 'FOOD_SAFETY', version: 1, state: ready ? 'APPROVED' : 'SUBMITTED', valid_until: '2 Mar 2027' },
    { id: 'd', doc_type: 'OWNER_ID', version: 1, state: 'APPROVED', valid_until: '9 Jun 2031' },
  ];
  const blockers = ready ? [] : ['Halal certificate not yet verified (checks H1–H7)', 'FOOD_SAFETY document not reviewed'];
  const app = APPLICATIONS[2];
  return (
    <Stateful state={state}
      loading={<GapSkeleton rows={3} />}
      empty={<GapEmptyState icon="orders" title="This application has no submission yet" body="The restaurant registered but has not submitted documents. It stays out of the queue until it does." />}
      error={<GapErrorState title="Could not load this application" terminal exit="Back to the queue" onExit={() => go('queue')} code="404 RESTAURANT_APPLICATION_NOT_FOUND" />}>
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        {locked
          ? <GapBanner tone="warning" icon="lock" title="Maryam K. holds this application until 14:32">Read-only for you. Decisions and document reviews unlock when the lock is released or expires.</GapBanner>
          : <GapBanner tone="info" icon="lock" title="You hold the review lock until 14:48" />}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px', gap: 'var(--space-5)', alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <Card radius="lg" variant="outlined" style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div><h3 style={{ margin: 0, fontSize: 'var(--type-heading-md-size)', fontWeight: 600 }}>{app.display_name}</h3><ShortId id={app.restaurant_id} /></div>
                <OnboardingBadge s={ready ? 'DOCUMENTS_REVIEW' : app.onboarding_state} />
              </div>
              <GapKeyValue rows={[
                ['Legal name', 'Karahi House Restaurant Inc.'], ['Address', '3025 Kennedy Rd, Unit 4, Toronto ON'],
                ['Submitted', app.submitted_at + ' · first submission'], ['SLA due', app.sla_due_at],
              ]} />
            </Card>
            <DocTable docs={docs} locked={locked} onReject={() => setDlg('doc')} />
            <Card radius="lg" variant="outlined" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>Halal certificate</div>
                <div style={{ fontSize: 'var(--type-body-sm-size)', color: 'var(--text-tertiary)' }}>{ready ? 'Verified · all seven checks pass' : '5 of 7 checks recorded'}</div>
              </div>
              {ready ? <AdminHalal s="CERTIFIED" /> : <AdminHalal s="UNVERIFIED" />}
              <Button variant="secondary" iconEnd="chevron-right" onPress={() => go('verification')}>Open verification</Button>
            </Card>
          </div>
          <Card radius="lg" variant="outlined" style={{ display: 'grid', gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 'var(--type-heading-md-size)', fontWeight: 600 }}>Application decision</h3>
            <Blockers list={blockers} />
            <Button size="lg" disabled={blockers.length > 0 || locked} onPress={() => setDlg('approve')}>Approve application</Button>
            <Button variant="ghost" disabled={locked} onPress={() => setDlg('reject')}>Reject application…</Button>
          </Card>
        </div>
      </div>
      <Modal contained open={dlg === 'approve'} variant="confirm" onClose={() => setDlg(null)} title="Approve Karahi House?"
        description="The restaurant moves to payout setup and menu. It is listed only while its halal certificate stays verified."
        confirmLabel="Approve application" onConfirm={() => setDlg(null)} />
      <Modal contained open={dlg === 'reject'} variant="confirm" destructive onClose={() => setDlg(null)} title="Reject this application?"
        description="The restaurant sees the reason. It can submit again later."
        confirmLabel="Reject application" onConfirm={() => setDlg(null)}>
        <Select label="Reason (RestaurantRejectApplicationReasonCode)" value="DOCUMENTS_INSUFFICIENT" onValueChange={() => {}}
          options={opts(['HALAL_CERTIFICATION_INVALID', 'DOCUMENTS_INSUFFICIENT', 'IDENTITY_UNVERIFIED', 'OUTSIDE_SERVICE_AREA', 'PROHIBITED_CUISINE_OR_PRODUCT', 'SUSPECTED_FRAUD', 'DUPLICATE_APPLICATION', 'OTHER'])} />
      </Modal>
      <Modal contained open={dlg === 'doc'} variant="confirm" destructive onClose={() => setDlg(null)} title="Reject this document?"
        description="The applicant is asked to upload it again." confirmLabel="Reject document" onConfirm={() => setDlg(null)}>
        <Select label="Reason (DocumentRejectionReasonCode)" value="ILLEGIBLE" onValueChange={() => {}}
          options={opts(['ILLEGIBLE', 'EXPIRED', 'WRONG_DOCUMENT_TYPE', 'NAME_MISMATCH', 'ADDRESS_MISMATCH', 'UNRECOGNISED_CERTIFIER', 'SUSPECTED_FORGERY', 'SUSPECTED_ALTERATION', 'INCOMPLETE_PAGES', 'OTHER'])} />
      </Modal>
    </Stateful>
  );
}

function RiderApplicationScreen({ state, variant = 'review', go }) {
  const locked = variant === 'locked';
  const docs = [
    { id: 'a', doc_type: 'GOVERNMENT_ID', version: 1, state: 'IN_REVIEW', valid_until: '4 Feb 2030' },
    { id: 'b', doc_type: 'WORK_ELIGIBILITY', version: 1, state: 'IN_REVIEW', valid_until: null },
    { id: 'c', doc_type: 'PROFILE_PHOTO', version: 2, state: 'SUBMITTED', valid_until: null },
  ];
  return (
    <Stateful state={state} loading={<GapSkeleton rows={3} />}
      empty={<GapEmptyState icon="orders" title="No documents submitted yet" body="The applicant has not finished onboarding." />}
      error={<GapErrorState title="Could not load this application" terminal exit="Back to the queue" onExit={() => go('riders')} />}>
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        {locked ? <GapBanner tone="warning" icon="lock" title="Maryam K. holds this application until 14:40" /> : <GapBanner tone="info" icon="lock" title="You hold the review lock until 14:52" />}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px', gap: 'var(--space-5)', alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <Card radius="lg" variant="outlined" style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div><h3 style={{ margin: 0, fontSize: 'var(--type-heading-md-size)', fontWeight: 600 }}>Yusuf Ahmed</h3><ShortId id={ID.rid1} /></div>
                <OnboardingBadge s="DOCUMENTS_REVIEW" />
              </div>
              <GapKeyValue rows={[['Vehicle', 'Bicycle (licence, registration and insurance not required)'], ['Age from ID', '24 (computed_age_years)'], ['Attempt', '1'], ['SLA due', RIDER_APPS[0].sla_due_at]]} />
            </Card>
            <DocTable docs={docs} locked={locked} />
          </div>
          <Card radius="lg" variant="outlined" style={{ display: 'grid', gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 'var(--type-heading-md-size)', fontWeight: 600 }}>Decision</h3>
            <Blockers list={['3 documents not reviewed']} />
            <Button size="lg" disabled>Approve rider</Button>
            <div style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 'var(--type-label-md-size)', fontWeight: 600, color: 'var(--text-secondary)' }}>Ask to redo (documents_to_redo)</span>
              <Checkbox label="Profile photo" checked={false} onCheckedChange={() => {}} disabled={locked} disabledReason={locked ? 'Another admin holds the lock' : undefined} />
              <Checkbox label="Work eligibility" checked={false} onCheckedChange={() => {}} disabled={locked} disabledReason={locked ? 'Another admin holds the lock' : undefined} />
            </div>
            <Button variant="ghost" disabled={locked}>Send back to applicant…</Button>
          </Card>
        </div>
      </div>
    </Stateful>
  );
}
Object.assign(window, { ApplicationScreen, RiderApplicationScreen });
