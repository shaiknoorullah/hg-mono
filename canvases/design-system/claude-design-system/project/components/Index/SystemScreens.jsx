/* System (DependencyReport), Staff (StaffUser) and the halal issuing-body registry
   (HalalIssuingBody). Registry status is never shown in red or solid green: only ACCEPTED
   satisfies check H2, and it is a registry fact, not a halal display state. */
const { DataTable, Badge, Button, Card, Select, Input, Modal } = window.HalalGoesDesignSystem_d11a47;

function SystemScreen({ state, variant = 'healthy' }) {
  const down = variant === 'degraded';
  const deps = [
    { dependency: 'postgres', resolved_address: '10.0.3.12:5432', connected: true },
    { dependency: 'redis', resolved_address: '10.0.3.14:6379', connected: !down },
    { dependency: 'minio', resolved_address: '10.0.3.16:9000', connected: true },
    { dependency: 'stripe', resolved_address: 'api.stripe.com:443', connected: true },
  ];
  const probes = [
    { probe: 'bucket_privacy', passed: true, detail: 'Every bucket is private' },
    { probe: 'postgis', passed: true, detail: 'PostGIS 3.4' },
    { probe: 'stripe_livemode', passed: true, detail: 'Test mode on staging, as configured' },
    { probe: 'email_dns', passed: true, detail: 'SPF and DKIM found' },
    { probe: 'sms_sender', passed: false, detail: 'No approved A2P sender (O-03 open)' },
  ];
  const ok = (v, yes, no) => <Badge variant={v ? 'outline' : 'warning'} size="sm" icon={v ? 'check' : 'warning'}>{v ? yes : no}</Badge>;
  return (
    <Stateful state={state} loading={<GapSkeleton rows={2} />}
      empty={<GapEmptyState icon="info" title="No dependencies reported" body="The server returned an empty report. That is itself a fault: every environment has at least Postgres." />}
      error={<GapErrorState title="The server did not answer" body="/health/ready failed. The report cannot be loaded while the API is down." />}>
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Badge variant="neutral" size="md">staging</Badge>
          {down && <GapBanner tone="warning" style={{ flex: 1 }} title="Redis is not connected">The system stays correct without Redis; it is slower. Rate limits and live updates fall back.</GapBanner>}
        </div>
        <DataTable caption="Dependencies" density="compact" rows={deps} rowLabel={r => r.dependency} columns={[
          { key: 'dependency', label: 'Dependency' },
          { key: 'resolved_address', label: 'Resolved address (actual, not configured)', mono: true },
          { key: 'connected', label: 'Connection', render: r => ok(r.connected, 'Connected', 'Not connected') },
        ]} />
        <DataTable caption="Boot probes" density="compact" rows={probes} rowLabel={r => r.probe} columns={[
          { key: 'probe', label: 'Boot probe', mono: true },
          { key: 'passed', label: 'Result', render: r => ok(r.passed, 'Passed', 'Failed') },
          { key: 'detail', label: 'Detail', muted: true },
        ]} />
        <p style={{ margin: 0, fontSize: 'var(--type-caption-size)', color: 'var(--text-tertiary)' }}>Configured-versus-actual comparison is not in DependencyReport yet; it lives on the non-contract /debug/deps route until the contract is widened.</p>
      </div>
    </Stateful>
  );
}

const STAFF_STATUS = { INVITED: 'info', ACTIVE: 'outline', SUSPENDED: 'warning', DEACTIVATED: 'neutral' };
const STAFF = [
  { id: ID.me, full_name: 'Aminah Rahman', email: 'aminah@halalgoes.ca', role: 'ADMIN', status: 'ACTIVE', mfa_enrolled: true, last_login_at: 'Today 08:02' },
  { id: ID.other, full_name: 'Maryam Khan', email: 'maryam@halalgoes.ca', role: 'ADMIN', status: 'ACTIVE', mfa_enrolled: true, last_login_at: 'Today 09:40' },
  { id: '0192b3c4-72b3-7c44-8d55-e6f708192a3b', full_name: 'Idris Okafor', email: 'idris@halalgoes.ca', role: 'SUPPORT_AGENT', status: 'INVITED', mfa_enrolled: false, last_login_at: null },
  { id: '0192b3c4-83c4-7d55-9e66-f708192a3b4c', full_name: 'Sana Qureshi', email: 'sana@halalgoes.ca', role: 'SUPER_ADMIN', status: 'ACTIVE', mfa_enrolled: true, last_login_at: '2 Sept' },
];

function StaffScreen({ state }) {
  const [invite, setInvite] = React.useState(false);
  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex' }}><Button iconStart="plus" onPress={() => setInvite(true)} style={{ marginLeft: 'auto' }}>Invite staff</Button></div>
        <DataTable caption="Staff accounts" hideCaption density="compact" rows={state === 'populated' ? STAFF : []}
          status={state === 'loading' ? 'loading' : state === 'error' ? 'error' : 'ready'} errorMessage="Staff did not load." onRetry={() => {}}
          emptyState={{ title: 'Only you so far', description: 'Invite support agents and admins. Each must set up an authenticator app on first sign-in.', action: <Button onPress={() => setInvite(true)}>Invite staff</Button> }}
          rowLabel={r => r.full_name}
          rowActions={r => [{ label: 'Change role…' }, { label: r.status === 'SUSPENDED' ? 'Reinstate' : 'Suspend…', destructive: r.status !== 'SUSPENDED' }, { type: 'separator' }, { label: 'Reset two-step sign-in…', destructive: true }]}
          columns={[
          { key: 'full_name', label: 'Name', render: r => <span style={{ display: 'grid' }}><strong style={{ fontWeight: 600 }}>{r.full_name}</strong><span style={{ color: 'var(--text-tertiary)' }}>{r.email}</span></span> },
          { key: 'role', label: 'Role', render: r => <Badge variant="neutral" size="sm">{human(r.role)}</Badge> },
          { key: 'status', label: 'Status', render: r => <Badge variant={STAFF_STATUS[r.status]} size="sm">{human(r.status)}</Badge> },
          { key: 'mfa_enrolled', label: 'Two-step', render: r => r.mfa_enrolled ? <Badge variant="outline" size="sm" icon="lock">TOTP on</Badge> : <Badge variant="warning" size="sm">Not set up — cannot sign in</Badge> },
          { key: 'last_login_at', label: 'Last sign-in', muted: true, render: r => r.last_login_at || 'Never' },
          { key: 'id', label: 'Id', render: r => <ShortId id={r.id} /> },
        ]} />
      <Modal contained open={invite} onClose={() => setInvite(false)} title="Invite staff" description="They receive an email link and must set up two-step sign-in before first use."
        actions={<><Button variant="ghost" onPress={() => setInvite(false)}>Cancel</Button><Button onPress={() => setInvite(false)}>Send invite</Button></>}>
        <div style={{ display: 'grid', gap: 12 }}>
          <Input label="Full name" value="" onChange={() => {}} />
          <Input label="Work email" variant="email" value="" onChange={() => {}} />
          <Select label="Role" value="SUPPORT_AGENT" onValueChange={() => {}} options={opts(['SUPPORT_AGENT', 'ADMIN', 'SUPER_ADMIN'])} />
        </div>
      </Modal>
    </div>
  );
}

const BODY_STATUS = { PROPOSED: 'info', ACCEPTED: 'outline', SUSPENDED: 'warning', RETIRED: 'neutral', REJECTED: 'neutral' };

function IssuingBodiesScreen({ state }) {
  const rows = BODIES.concat([{ id: '0192a001-0004-7004-8004-000000000004', name: 'Example Halal Council (proposed)', aliases: [], country: 'CA', region: 'QC', website: null, status: 'PROPOSED', requires_issuer_confirmation: false }]);
  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <GapBanner tone="neutral" style={{ flex: 1 }}>Only ACCEPTED bodies satisfy check H2, at the moment of review. Suspending a body blocks new certificates; it does not revoke existing ones. The registry is not a ranking.</GapBanner>
        <Button iconStart="plus">Propose a body</Button>
      </div>
        <DataTable caption="Halal issuing-body registry" hideCaption density="compact" rows={state === 'populated' ? rows : []}
          status={state === 'loading' ? 'loading' : state === 'error' ? 'error' : 'ready'} errorMessage="The registry did not load." onRetry={() => {}}
          emptyState={{ title: 'The registry is empty', description: 'No certificate can pass H2 until at least one body is accepted.', action: <Button>Propose a body</Button> }}
          rowLabel={r => r.name}
          rowActions={r => ['ACCEPTED', 'SUSPENDED', 'RETIRED', 'REJECTED'].filter(st => st !== r.status).map(st => ({ label: 'Set ' + human(st).toLowerCase() }))}
          columns={[
          { key: 'name', label: 'Body', render: r => <span style={{ display: 'grid' }}><strong style={{ fontWeight: 600 }}>{r.name}</strong>{r.aliases.length > 0 && <span style={{ color: 'var(--text-tertiary)' }}>Also: {r.aliases.join(', ')}</span>}</span> },
          { key: 'country', label: 'Where', muted: true, render: r => r.country + (r.region ? ' · ' + r.region : '') },
          { key: 'website', label: 'Website', muted: true, render: r => r.website || '—' },
          { key: 'requires_issuer_confirmation', label: 'Issuer confirmation', render: r => r.requires_issuer_confirmation ? 'Required' : '—' },
          { key: 'status', label: 'Status', render: r => <Badge variant={BODY_STATUS[r.status]} size="sm">{human(r.status)}</Badge> },
        ]} />
    </div>
  );
}
Object.assign(window, { SystemScreen, StaffScreen, IssuingBodiesScreen });
