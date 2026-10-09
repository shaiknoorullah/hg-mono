const { DataTable, Badge, Button } = window.HalalGoesDesignSystem_d11a47;

/* RestaurantStaffUser: roles RESTAURANT_MANAGER / RESTAURANT_STAFF, StaffStatus. */
const ROLE_LABEL = { RESTAURANT_MANAGER: 'Manager', RESTAURANT_STAFF: 'Staff' };
const STATUS_TONE = { ACTIVE: 'neutral', INVITED: 'info', SUSPENDED: 'warning', DEACTIVATED: 'neutral' };

function StaffScreen({ state }) {
  return (
    <Stateful state={state}
      loading={<GapSkeleton rows={3} height={48} />}
      empty={<GapEmptyState icon="profile" title="Only you so far" body="Invite managers and kitchen staff. Staff can run the order queue; managers can also edit the menu and hours." action="Invite staff" />}
      error={<GapErrorState title="Couldn't load your team" onRetry={() => {}} />}>
      <div style={{ display: 'grid', gap: 'var(--space-4)', maxWidth: 1040 }}>
        <div style={{ display: 'flex' }}><Button iconStart="plus">Invite staff</Button></div>
        <DataTable caption="Restaurant staff" hideCaption density="comfortable" rows={STAFF}
          rowLabel={r => r.full_name}
          rowActions={r => [
            { label: 'Change role' },
            ...(r.status === 'INVITED' ? [{ label: 'Resend invite' }] : []),
            { type: 'separator' },
            { label: 'Deactivate ' + r.full_name.split(' ')[0], destructive: true }]}
          columns={[
          { key: 'full_name', label: 'Name' },
          { key: 'email', label: 'Email', muted: true },
          { key: 'role', label: 'Role', render: r => ROLE_LABEL[r.role] },
          { key: 'status', label: 'Status', render: r => <Badge variant={STATUS_TONE[r.status]} size="sm">{r.status === 'INVITED' ? 'Invite sent' : r.status.toLowerCase()}</Badge> },
          { key: 'last', label: 'Last sign-in', muted: true, render: r => r.last_login_at || '—' },
        ]} />
      </div>
    </Stateful>
  );
}
Object.assign(window, { StaffScreen });
