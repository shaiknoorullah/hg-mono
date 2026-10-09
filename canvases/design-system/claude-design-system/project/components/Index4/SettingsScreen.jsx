const { Card, Input, Button, Badge, Icon, Modal } = window.HalalGoesDesignSystem_d11a47;

/* Document list shared by Settings → Documents and onboarding step 2. Upload-only (K-26): the
   restaurant uploads through /v1/uploads + POST /v1/restaurant/documents and sees the KycDocumentState;
   an admin transcribes the certificate fields. No certifying-body picker, no typed number or dates,
   no "verify manually" path. */
function DocumentList({ docs, rejected }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      {DOC_TYPES.map(([type, label, required]) => {
        const d = rejected && rejected[type] ? rejected[type] : docs[type];
        const badge = d ? DOC_STATE_BADGE[d.state] : null;
        return (
          <div key={type} style={{ display: 'grid', gap: 6, paddingTop: 'var(--space-3)', borderTop: '1px solid var(--border-decorative)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 'var(--type-label-lg-size)', fontWeight: 600 }}>{label}</span>
              {!required && <span style={{ fontSize: 'var(--type-caption-size)', color: 'var(--text-tertiary)' }}>Optional</span>}
              <span style={{ marginLeft: 'auto' }}>{badge ? <Badge variant={badge[0]} size="sm">{badge[1]}</Badge> : <Badge variant="neutral" size="sm">Not uploaded</Badge>}</span>
            </div>
            {d && d.state === 'REJECTED' && (
              <GapBanner tone="warning" title={d.rejection_reason_code === 'UNRECOGNISED_CERTIFIER' ? 'We could not accept this issuer' : 'Please upload a new copy'}>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{d.rejection_reason_code}</span> — {d.review_note}
              </GapBanner>
            )}
            <GapFileUpload state={d && d.state !== 'REJECTED' ? 'done' : 'idle'} fileName={d && d.file}
              hint={type === 'HALAL_CERTIFICATE' ? 'The full certificate, every page. PDF, JPG or PNG.' : 'PDF, JPG or PNG'} />
          </div>
        );
      })}
    </div>
  );
}

function SettingsScreen({ state, variant }) {
  const [asking, setAsking] = React.useState(false);
  const cert = DOCS.HALAL_CERTIFICATE;
  const locked = <Icon name="lock" size="sm" color="var(--text-tertiary)" />;
  return (
    <Stateful state={state}
      loading={<GapSkeleton rows={2} height={160} />}
      empty={<GapEmptyState title="Profile not set up" body="Finish onboarding to set up your storefront." action="Continue onboarding" />}
      error={<GapErrorState title="Couldn't load your settings" onRetry={() => {}} />}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 'var(--space-6)', alignItems: 'start', maxWidth: 1080 }}>
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <Card radius="lg" variant="outlined">
            <h3 style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--type-heading-md-size)', fontWeight: 600 }}>Business details</h3>
            <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
              <Input label="Legal name" value={RESTAURANT.legal_name} readOnly suffix={locked} helperText="Locked: matches your halal certificate (check H3)." />
              <Input label="Address" value={RESTAURANT.address} readOnly suffix={locked} iconStart="map" helperText="Locked: matches your halal certificate (check H4)." />
              <div><Button variant="tertiary" size="sm" onPress={() => setAsking(true)}>Request a change</Button></div>
            </div>
          </Card>
          <Card radius="lg" variant="outlined">
            <h3 style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--type-heading-md-size)', fontWeight: 600 }}>Storefront</h3>
            <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
              <Input label="Display name" defaultValue={RESTAURANT.display_name} />
              <Input label="Phone" variant="tel" defaultValue={RESTAURANT.phone} />
              <Input label="Cuisines" defaultValue={RESTAURANT.cuisines.join(', ')} />
              <div><Button>Save changes</Button></div>
            </div>
          </Card>
        </div>
        <Card radius="lg" variant="outlined">
          <h3 style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--type-heading-md-size)', fontWeight: 600 }}>Documents</h3>
          <p style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--type-body-sm-size)', color: 'var(--text-secondary)', lineHeight: 'var(--type-body-sm-line)' }}>
            Upload the document. HalalGoes reads it and records the details; you don't type them in.
          </p>
          {variant === 'expiring' && (
            <GapBanner tone="warning" icon="clock" title={'Your halal certificate expires ' + cert.valid_until} style={{ marginBottom: 'var(--space-3)' }}>
              Upload the renewed certificate before then. If it lapses your storefront is hidden from customers until the new one is approved.
            </GapBanner>
          )}
          <DocumentList docs={DOCS} />
        </Card>
        {asking && (
          <Modal open contained title="Request a change to your legal name or address" onClose={() => setAsking(false)}
            description="Both are checked against your halal certificate. Changing either sends your certificate back to HalalGoes for re-verification before the change takes effect."
            actions={<><Button variant="tertiary" onPress={() => setAsking(false)}>Cancel</Button><Button onPress={() => setAsking(false)}>Send request</Button></>}>
            <Input label="What should change?" placeholder="New legal name or address" />
          </Modal>
        )}
      </div>
    </Stateful>
  );
}
Object.assign(window, { SettingsScreen, DocumentList });
