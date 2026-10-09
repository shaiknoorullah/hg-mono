const { AppBar, Switch, Badge, Button } = window.HalalGoesDesignSystem_d11a47;

/* Nav matches apps/restaurant/src/components/Shell.tsx: Orders, Menu, Hours, Payouts, Staff, Settings.
   There is no Certification route: certificate documents live in Settings → Documents (K-20/K-26).
   No Print (no ticket endpoint, K-30) and no sidebar halal badge: the restaurant side has no read of
   its HalalDisplayState, so the only certificate line is the expiring notice in Settings. */
const RESTAURANT_NAV = [
  { value: 'orders', label: 'Orders', icon: 'orders' },
  { value: 'menu', label: 'Menu' },
  { value: 'hours', label: 'Hours', icon: 'clock' },
  { value: 'payouts', label: 'Payouts' },
  { value: 'staff', label: 'Staff', icon: 'profile' },
  { value: 'settings', label: 'Settings' },
];

/* Heartbeat status (K-24): the order screen checks in with POST /v1/restaurant/heartbeat; after 5
   minutes without one the server treats the restaurant as CLOSED_OFFLINE and offers it nothing. */
function HeartbeatStatus({ availability }) {
  const a = availability;
  if (a.open_state === 'CLOSED_OFFLINE') return <Badge variant="warning" icon="warning">Offline · last check-in {hhmm(a.last_heartbeat_at)}</Badge>;
  if (a.open_state === 'PAUSED') return <Badge variant="neutral" icon="clock">Paused until {hhmm(a.pause_until)}</Badge>;
  return <Badge variant="info" icon="refresh">Live · checked in {Math.round((Date.parse(SERVER_TIME) - Date.parse(a.last_heartbeat_at)) / 1000)} s ago</Badge>;
}

function RestaurantShell({ view, onNav, availability = AVAILABILITY.live, children, title }) {
  const [accepting, setAccepting] = React.useState(availability.is_accepting_orders && availability.open_state !== 'PAUSED');
  const current = RESTAURANT_NAV.find(n => n.value === view);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '236px 1fr', minHeight: 780, background: 'var(--surface-base)' }}>
      <aside style={{ background: 'var(--surface-chrome)', color: 'var(--text-on-accent)', display: 'grid', gridTemplateRows: 'auto 1fr auto' }}>
        <div style={{ padding: '18px 18px 14px' }}>
          <GapWordmark size={19} tone="onDark" sub="Restaurant partner" />
        </div>
        <GapSideNav items={RESTAURANT_NAV.map(n => n.value === 'orders' ? { ...n, count: ORDERS.filter(o => o.state === 'RESTAURANT_PENDING').length } : n)} value={view} onChange={v => onNav && onNav(v)} />
        <div style={{ padding: 16, borderTop: '1px solid var(--border-decorative)', fontSize: 'var(--type-caption-size)', color: 'var(--text-on-accent)', opacity: .8 }}>
          {RESTAURANT.display_name}
        </div>
      </aside>
      <main style={{ display: 'grid', gridTemplateRows: 'auto 1fr', minWidth: 0 }}>
        <AppBar tone="raised" title={title || (current && current.label)} subtitle={RESTAURANT.display_name + ' · ' + RESTAURANT.address}
          actions={<>
            <HeartbeatStatus availability={availability} />
            <Switch size="sm" label="Orders" stateLabel={{ on: 'Accepting orders', off: 'Paused' }} checked={accepting} onCheckedChange={setAccepting} />
          </>} />
        <div style={{ overflowY: 'auto', padding: 'var(--space-6)', display: 'grid', gap: 'var(--space-4)', alignContent: 'start' }}>
          {availability.missed_order_count > 0 && (
            <GapBanner tone="warning" title={availability.missed_order_count + ' orders timed out this week'}>
              They were not accepted within 3 minutes, so the customers' payments were released. Keep this screen open and sound on while you are accepting orders.
            </GapBanner>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
Object.assign(window, { RestaurantShell, RESTAURANT_NAV, HeartbeatStatus });
