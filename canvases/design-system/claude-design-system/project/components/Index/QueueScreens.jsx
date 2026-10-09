/* The three review queues: restaurant applications (/), rider applications, menu reviews.
   Rows are the contract's summaries. Claiming goes through take-next, which sets
   assigned_admin_id and review_lock_expires_at; the lock owner is always visible. */
const { DataTable, Button, Select, Switch, Badge, Icon, Card, Input, Modal } = window.HalalGoesDesignSystem_d11a47;

function SlaCell({ r }) {
  if (r.sla === 'waiting') return <span style={{ color: 'var(--text-tertiary)' }}>Waiting on applicant</span>;
  return <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
    <span style={{ fontVariantNumeric: 'var(--numeric-tabular)' }}>{r.sla_due_at}</span>
    {r.sla === 'breached' && <Badge variant="warning" size="sm" icon="clock">SLA breached</Badge>}
  </span>;
}
function LockCell({ r }) {
  if (!r.assigned_admin_id) return <span style={{ color: 'var(--text-tertiary)' }}>Unclaimed</span>;
  return <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
    <Icon name="lock" size="sm" color="var(--text-tertiary)" />{r.lock_owner}
    <span style={{ color: 'var(--text-tertiary)', fontVariantNumeric: 'var(--numeric-tabular)' }}>· {r.review_lock_expires_at}</span>
  </span>;
}

function QueueToolbar({ filterLabel, filterOptions, filterValue, onTakeNext, count }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <Select label={filterLabel} value={filterValue} onValueChange={() => {}} options={filterOptions} style={{ minWidth: 200 }} />
      <Switch size="sm" label="SLA breached only" stateLabel={{ on: 'On', off: 'Off' }} checked={filterValue === 'breached'} onCheckedChange={() => {}} />
      <span style={{ marginLeft: 'auto', fontSize: 'var(--type-body-sm-size)', color: 'var(--text-tertiary)', alignSelf: 'center' }}>{count} waiting · oldest first</span>
      <Button iconEnd="chevron-right" disabled={count === 0} onPress={onTakeNext}>Take next</Button>
    </div>
  );
}

/* The DS DataTable owns loading, error, first-run empty and filtered-empty (C-32). */
function QueueBody({ state, variant, rows, columns, onRowClick, noun, onClear, rowLabel }) {
  const filtered = variant === 'filtered';
  const shown = state === 'populated' && !filtered ? rows : [];
  return (
    <DataTable caption={'Restaurant, rider and menu review queue: ' + noun} hideCaption density="compact" rows={shown} columns={columns}
      status={state === 'loading' ? 'loading' : state === 'error' ? 'error' : 'ready'}
      errorMessage={'The ' + noun + ' queue did not respond. Nothing was claimed.'} onRetry={() => {}}
      filtersActive={filtered} onClearFilters={onClear}
      emptyState={{ title: 'Queue clear', description: 'Every ' + noun.replace(/s$/, '') + ' has a decision. New submissions appear here oldest first.' }}
      onRowActivate={onRowClick} rowLabel={rowLabel}
      rowActions={r => [{ label: 'Open', onSelect: () => onRowClick(r) }, { label: r.assigned_admin_id ? 'Claimed' : 'Claim and open', disabled: !!r.assigned_admin_id, disabledReason: r.lock_owner ? 'Locked by ' + r.lock_owner : undefined, onSelect: () => onRowClick(r) }]} />
  );
}

function OnboardingQueueScreen({ state, variant, go }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <QueueToolbar filterLabel="Onboarding state" filterValue={variant === 'filtered' ? 'breached' : 'DOCUMENTS_REVIEW'}
        filterOptions={[{ value: 'DOCUMENTS_REVIEW', label: 'In review' }, { value: 'DOCUMENTS_REJECTED', label: 'Fix documents' }, { value: 'breached', label: 'In review · SLA breached' }]}
        count={state === 'populated' && variant !== 'filtered' ? APPLICATIONS.length : 0} onTakeNext={() => go('application')} />
      <QueueBody state={state} variant={variant} noun="applications" onClear={() => go('queue')} onRowClick={() => go('application')} rowLabel={r => 'application ' + r.display_name} rows={APPLICATIONS} columns={[
        { key: 'display_name', label: 'Restaurant', render: r => <span style={{ display: 'grid' }}><strong style={{ fontWeight: 600 }}>{r.display_name}</strong><ShortId id={r.restaurant_id} /></span> },
        { key: 'city', label: 'City', muted: true, render: r => r.city + ', ' + r.province },
        { key: 'onboarding_state', label: 'State', render: r => <OnboardingBadge s={r.onboarding_state} /> },
        { key: 'submission_count', label: 'Submission', numeric: true, render: r => r.submission_count > 1 ? <Badge variant="info" size="sm">Resubmitted ×{r.submission_count}</Badge> : 'First' },
        { key: 'sla_due_at', label: 'SLA due', render: r => <SlaCell r={r} /> },
        { key: 'lock', label: 'Assignee', render: r => <LockCell r={r} /> },
      ]} />
    </div>
  );
}

function RiderQueueScreen({ state, variant, go }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <QueueToolbar filterLabel="Onboarding state" filterValue={variant === 'filtered' ? 'breached' : 'DOCUMENTS_REVIEW'}
        filterOptions={[{ value: 'DOCUMENTS_REVIEW', label: 'In review' }, { value: 'DOCUMENTS_REJECTED', label: 'Fix documents' }, { value: 'breached', label: 'In review · SLA breached' }]}
        count={state === 'populated' && variant !== 'filtered' ? RIDER_APPS.length : 0} onTakeNext={() => go('rider')} />
      <QueueBody state={state} variant={variant} noun="rider applications" onClear={() => go('riders')} onRowClick={() => go('rider')} rowLabel={r => 'rider application ' + r.display_name} rows={RIDER_APPS} columns={[
        { key: 'display_name', label: 'Applicant', render: r => <span style={{ display: 'grid' }}><strong style={{ fontWeight: 600 }}>{r.display_name}</strong><ShortId id={r.rider_account_id} /></span> },
        { key: 'vehicle_type', label: 'Vehicle', muted: true, render: r => human(r.vehicle_type) },
        { key: 'onboarding_state', label: 'State', render: r => <OnboardingBadge s={r.onboarding_state} /> },
        { key: 'attempt_number', label: 'Attempt', numeric: true },
        { key: 'sla_due_at', label: 'SLA due', render: r => <SlaCell r={r} /> },
        { key: 'lock', label: 'Assignee', render: r => <LockCell r={r} /> },
      ]} />
    </div>
  );
}

/* Menu reviews: MenuItemVersion rows with review_status PENDING_REVIEW. Claim-bearing fields
   (dietary/allergen tags, description, image) are what trigger review. */
const MENU_REVIEWS = [
  { id: ID.mv1, restaurant_id: ID.r3, name: 'Chicken karahi', version: 3, review_status: 'PENDING_REVIEW', submitted_at: '3 Sept, 10:12', changed: 'Dietary tags: + SPICY · Allergens: + MILK', live: 'Bone-in, tomato and ginger, cooked to order', pending: 'Bone-in, tomato, ginger and cream, cooked to order' },
  { id: ID.mv2, restaurant_id: ID.r1, name: 'Mixed grill platter', version: 1, review_status: 'PENDING_REVIEW', submitted_at: '3 Sept, 11:40', changed: 'New item · image added', live: null, pending: 'Chicken shish, kofta, lamb, garlic sauce' },
];

function MenuReviewScreen({ state, variant }) {
  const [sel, setSel] = React.useState(MENU_REVIEWS[0]);
  const [reject, setReject] = React.useState(variant === 'reject');
  React.useEffect(() => setReject(variant === 'reject'), [variant]);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: state === 'populated' ? 'minmax(0,1fr) 400px' : 'minmax(0,1fr)', gap: 'var(--space-5)', alignItems: 'start' }}>
        <DataTable caption="Menu changes waiting for review" hideCaption density="compact" rows={state === 'populated' ? MENU_REVIEWS : []}
          status={state === 'loading' ? 'loading' : state === 'error' ? 'error' : 'ready'} errorMessage="Menu reviews did not load. Nothing was decided." onRetry={() => {}}
          emptyState={{ title: 'Queue clear', description: 'No menu changes are waiting for review. Claim-bearing edits (tags, allergens, description, image) appear here.' }}
          onRowActivate={setSel} rowLabel={r => r.name + ' version ' + r.version} columns={[
          { key: 'name', label: 'Item', render: r => <strong style={{ fontWeight: 600 }}>{r.name}</strong> },
          { key: 'restaurant_id', label: 'Restaurant', render: r => <ShortId id={r.restaurant_id} copy={false} /> },
          { key: 'version', label: 'Version', numeric: true, render: r => 'v' + r.version },
          { key: 'changed', label: 'Changed claim fields', muted: true },
          { key: 'submitted_at', label: 'Submitted', muted: true },
        ]} />
        {state === 'populated' && <Card radius="lg" variant="outlined" style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 'var(--type-heading-md-size)', fontWeight: 600 }}>{sel.name} · v{sel.version}</h3>
            <Badge variant="info" size="sm">Pending review</Badge>
          </div>
          <GapKeyValue labelWidth={90} rows={[
            ['Live', sel.live || <span style={{ color: 'var(--text-tertiary)' }}>Not live yet</span>],
            ['Proposed', sel.pending],
            ['Changes', sel.changed],
          ]} />
          <GapBanner tone="neutral">Items can never claim halal themselves: HALAL_CERTIFIED is applied from the restaurant's certificate.</GapBanner>
          {reject ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <Select label="Reason" value="MISSING_ALLERGEN" onValueChange={() => {}} options={opts(['MISLEADING_DESCRIPTION', 'UNSUBSTANTIATED_HALAL_CLAIM', 'INCORRECT_DIETARY_TAG', 'MISSING_ALLERGEN', 'POOR_IMAGE_QUALITY', 'IMAGE_NOT_OF_DISH', 'PROHIBITED_ITEM', 'OFFENSIVE_CONTENT', 'OTHER'])} />
              <Input label="Note to the restaurant" value="The cream in the new description is a milk allergen." onChange={() => {}} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Button variant="ghost" onPress={() => setReject(false)}>Cancel</Button>
                <Button variant="secondary">Send back</Button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="ghost" onPress={() => setReject(true)}>Reject…</Button>
              <Button>Approve version</Button>
            </div>
          )}
        </Card>}
    </div>
  );
}
Object.assign(window, { OnboardingQueueScreen, RiderQueueScreen, MenuReviewScreen, SlaCell, LockCell });
