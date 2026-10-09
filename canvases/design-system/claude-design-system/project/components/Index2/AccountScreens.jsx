/* Orders (GET /v1/orders -> OrderSummary[]), Alerts (GET /v1/notifications), Profile,
   Addresses (GET /v1/addresses) and the address form (POST/PUT /v1/addresses). */
const { AppBar, Card, Button, Price, Icon, Input, Select, Switch, IconButton, Badge } = window.HalalGoesDesignSystem_d11a47;

function OrderRow({ o, go }) {
  return (
    <GapListRow icon="orders" onClick={() => go('tracking', o.state === 'PREPARING' ? 'PREPARING' : o.state === 'REJECTED' ? 'REJECTED' : 'RESOLVED')}
      title={<span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{o.restaurant.name}<OrderStateBadge state={o.state} /></span>}
      sub={o.code + ' · ' + o.placed_at + ' · ' + o.first_item_names.join(', ')}
      right={<Price cents={o.total_cents} size="sm" />} />
  );
}

function OrdersScreen({ state, go }) {
  return (
    <Screen header={<AppBar tone="cream" title="Orders" />} footer={<Tabs value="orders" go={go} />}>
      <Stateful state={state}
        loading={<GapSkeleton rows={3} height={56} />}
        empty={<GapEmptyState icon="orders" title="No orders yet" body="Your active order and past orders show here." action="Discover restaurants" onAction={() => go('home')} />}
        error={<GapErrorState title="Couldn't load your orders" body="Pull to refresh or try again." />}>
        <div style={{ display: 'grid', gap: 18 }}>
          <section><H2>Active</H2>{ORDERS_ACTIVE.map(o => <OrderRow key={o.id} o={o} go={go} />)}</section>
          <section><H2>Past orders</H2>{ORDERS_PAST.map(o => <OrderRow key={o.id} o={o} go={go} />)}</section>
        </div>
      </Stateful>
    </Screen>
  );
}

function AlertsScreen({ state, go }) {
  return (
    <Screen header={<AppBar tone="cream" title="Alerts" actions={<Button variant="ghost" size="sm">Mark all read</Button>} />} footer={<Tabs value="alerts" go={go} />}>
      <Stateful state={state}
        loading={<GapSkeleton rows={3} height={56} />}
        empty={<GapEmptyState icon="bell" title="You're all caught up" body="Order updates and support replies appear here." />}
        error={<GapErrorState title="Couldn't load alerts" />}>
        {NOTIFICATIONS.map(n => (
          <GapListRow key={n.id} icon={n.kind === 'REFUND' ? 'check' : 'orders'} onClick={() => go('orders')}
            title={<span style={{ fontWeight: n.read_at ? 500 : 700 }}>{n.title}</span>} sub={n.body}
            right={<span style={{ display: 'grid', justifyItems: 'end', gap: 4, fontSize: 'var(--type-caption-size)', color: 'var(--text-tertiary)' }}>{n.created_at}
              {!n.read_at && <span aria-label="Unread" style={{ width: 8, height: 8, borderRadius: 'var(--radius-full)', background: 'var(--action-primary)' }} />}</span>} chevron={false} />
        ))}
      </Stateful>
    </Screen>
  );
}

function ProfileScreen({ state, go }) {
  const [push, setPush] = React.useState(true);
  const [marketing, setMarketing] = React.useState(false);
  return (
    <Screen header={<AppBar tone="cream" title="Profile" />} footer={<Tabs value="profile" go={go} />}>
      <Stateful state={state} loading={<GapSkeleton rows={2} />} error={<GapErrorState title="Couldn't load your profile" />}>
        <div style={{ display: 'grid', gap: 14 }}>
          <Card radius="lg" variant="outlined">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <GapAvatar name="Aisha Malik" />
              <div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>Aisha M.</div><Muted>(416) 555-0134 · signed in with phone</Muted></div>
              <Button variant="ghost" size="sm" accessibilityLabel="Edit name">Edit</Button>
            </div>
          </Card>
          <Card radius="lg" variant="outlined" padding="0 var(--space-4)">
            <GapListRow icon="map" title="Addresses" sub={ADDRESSES.length + ' saved'} onClick={() => go('addresses')} style={{ borderTop: 'none' }} />
            <GapListRow icon="lock" title="Payment methods" sub="Visa •••• 4242" onClick={() => {}} />
            <GapListRow icon="info" title="How we verify halal" onClick={() => {}} />
          </Card>
          <Card radius="lg" variant="outlined">
            <div style={{ fontSize: 'var(--type-label-lg-size)', fontWeight: 600, marginBottom: 4 }}>Notifications</div>
            <Switch label="Order updates" description="App notifications about your active order" stateLabel={{ on: 'On', off: 'Off' }} checked={push} onCheckedChange={setPush} />
            <Switch label="News and offers by email" description="Off unless you turn it on" stateLabel={{ on: 'On', off: 'Off' }} checked={marketing} onCheckedChange={setMarketing} />
          </Card>
          <Button variant="ghost">Sign out</Button>
        </div>
      </Stateful>
    </Screen>
  );
}

function AddressesScreen({ state, go }) {
  return (
    <Screen header={<AppBar tone="cream" onBack={() => go('profile')} backLabel="Back to Profile" title="Addresses" />}
      footer={<div style={{ padding: 'var(--space-4)' }}><Button fullWidth size="lg" variant="tertiary" iconStart="plus" onPress={() => go('address-form')}>Add address</Button></div>}>
      <Stateful state={state} loading={<GapSkeleton rows={2} height={56} />}
        empty={<GapEmptyState icon="map" title="No saved addresses" body="Add one so restaurants can show whether they deliver to you." action="Add address" onAction={() => go('address-form')} />}
        error={<GapErrorState title="Couldn't load addresses" />}>
        {ADDRESSES.map(a => (
          <GapListRow key={a.id} icon={a.label === 'Home' ? 'home' : 'map'} onClick={() => go('address-form', 'edit')}
            title={<span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{a.label}{a.is_default && <Badge variant="neutral" size="sm">Default</Badge>}</span>}
            sub={[a.line1, a.unit && 'Unit ' + a.unit, a.city + ' ' + a.postal_code].filter(Boolean).join(' · ')} />
        ))}
      </Stateful>
    </Screen>
  );
}

function AddressFormScreen({ state, variant, go }) {
  const edit = variant === 'edit', invalid = variant === 'invalid';
  const a = edit ? ADDRESSES[0] : {};
  return (
    <Screen header={<AppBar tone="cream" onBack={() => go('addresses')} backLabel="Back to Addresses" title={edit ? 'Edit address' : 'New address'} />}
      footer={state === 'populated' ? <div style={{ padding: 'var(--space-4)' }}><Button fullWidth size="lg">Save address</Button></div> : null}>
      <Stateful state={state} loading={<GapSkeleton rows={2} />} error={<GapErrorState title="Couldn't save the address" body="Nothing was changed. Try again." />}>
        <div style={{ display: 'grid', gap: 12 }}>
          {invalid && <GapBanner tone="warning" title="We can't deliver to this address yet">HalalGoes serves Ontario only at launch.</GapBanner>}
          <Input label="Street address" value={a.line1 || (invalid ? '1 Main St' : '')} onChange={() => {}} iconStart="map" required />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Input label="Unit" value={a.unit || ''} onChange={() => {}} />
            <Input label="Buzzer" value={a.buzzer || ''} onChange={() => {}} helperText="Shared with your rider after they accept" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Input label="City" value={a.city || (invalid ? 'Montréal' : '')} onChange={() => {}} required />
            <Input label="Postal code" value={a.postal_code || (invalid ? 'H2X' : '')} onChange={() => {}} required errorText={invalid ? 'Use the format A1A 1A1' : undefined} />
          </div>
          <Select label="Province" value={invalid ? 'QC' : 'ON'} onValueChange={() => {}} options={[{ value: 'ON', label: 'Ontario' }, { value: 'QC', label: 'Québec (not served yet)' }]} />
          <Input label="Delivery notes" value={a.delivery_notes || ''} onChange={() => {}} placeholder="e.g. side door" />
          <Input label="Label" value={a.label || ''} onChange={() => {}} placeholder="Home, Work…" />
          <Switch label="Use as default address" stateLabel={{ on: 'Default', off: 'Not default' }} checked={!!a.is_default} onCheckedChange={() => {}} />
        </div>
      </Stateful>
    </Screen>
  );
}
Object.assign(window, { OrdersScreen, AlertsScreen, ProfileScreen, AddressesScreen, AddressFormScreen });
