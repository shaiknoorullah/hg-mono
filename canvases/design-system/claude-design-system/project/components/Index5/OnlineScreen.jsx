/* Home / availability, drawn from RiderDashboard {mode, today, active_assignment, current_offer,
   tracking_health, blocking_reasons}. K-32: there is no list of offers and no offer count; the
   rider waits, and the single current_offer arrives full-screen (Offer artboard).
   K-33: no acceptance rate and no review count (not in the contract). */
const { Card, Button, Switch, Price, Badge, Icon } = window.HalalGoesDesignSystem_d11a47;

const HOME_VARIANTS = [
  { id: 'ONLINE_IDLE', label: 'Online · waiting for an offer' },
  { id: 'OFFLINE', label: 'Offline' },
  { id: 'ONLINE_STALE', label: 'Online · location stale (ONLINE_STALE)' },
  { id: 'DEGRADED', label: 'Online · tracking DEGRADED' },
  { id: 'BLOCKED', label: 'Blocked (blocking_reasons)' },
  { id: 'ON_DELIVERY', label: 'On a delivery (active_assignment)' },
];

function TodayCard() {
  return (
    <Card variant="outlined" radius="lg">
      <SectionLabel>Today</SectionLabel>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4, gap: 8 }}>
        <Price cents={TODAY.gross_cents} size="xl" onDark />
        <span style={{ fontSize: 'var(--type-body-md-size)', color: 'var(--text-primary)', fontVariantNumeric: 'var(--numeric-tabular)' }}>{TODAY.trips} trips · {hoursText(TODAY.online_seconds)} online</span>
      </div>
    </Card>
  );
}

function OnlineScreen({ variant, state, go }) {
  const online = variant !== 'OFFLINE' && variant !== 'BLOCKED';
  const title = { OFFLINE: 'Offline', BLOCKED: 'Offline', ON_DELIVERY: 'On a delivery' }[variant] || 'Online';
  const subtitle = { OFFLINE: 'Go online to receive offers', BLOCKED: 'You can’t go online yet', ONLINE_STALE: 'No offers while we can’t see you', ON_DELIVERY: ASSIGNMENT.order_code }[variant] || 'Waiting for an offer';
  const body = () => {
    if (state === 'loading') return <GapSkeleton rows={2} />;
    if (state === 'error') return <GapErrorState title="Can’t reach HalalGoes" body="Your status didn’t load. While we can’t reach you, you won’t receive offers." />;
    return (
      <>
        {variant === 'ONLINE_IDLE' && (
          <GapEmptyState icon="clock" title="Waiting for an offer"
            body="Offers come one at a time. When one arrives it fills the screen, and you have 30 seconds to answer. Keep the app open." />
        )}
        {variant === 'OFFLINE' && (
          <GapEmptyState icon="info" title="You’re offline" body="Go online when you’re ready to deliver. You only get offers while you’re online." action="Go online" />
        )}
        {variant === 'ONLINE_STALE' && (
          <GapBanner tone="warning" icon="map" title="You’re online, but we can’t see your location"
            action={<Button size="sm" variant="secondary">Fix</Button>}>
            No offers will arrive until your location updates. Turn on location for HalalGoes and keep the app open.
          </GapBanner>
        )}
        {variant === 'DEGRADED' && (
          <GapBanner tone="info" icon="map" title="Weak location signal">Offers may be slower to reach you. Move somewhere with a clearer view of the sky.</GapBanner>
        )}
        {variant === 'BLOCKED' && (
          <>
            <GapBanner tone="warning" title="Before you can go online">Sort out the items below. Each one links to where you fix it.</GapBanner>
            <div>
              <GapListRow icon="warning" title="Vehicle insurance expired" sub="Upload a current policy" onClick={() => go('profile')} />
              <GapListRow icon="warning" title="Payouts not set up" sub="Finish Stripe setup" onClick={() => go('onboarding', 'payout')} />
            </div>
          </>
        )}
        {variant === 'ON_DELIVERY' && (
          <Card radius="lg" onPress={() => go('trip', 'EN_ROUTE_TO_PICKUP')} accessibilityLabel={'Resume trip ' + ASSIGNMENT.order_code + ' to ' + ASSIGNMENT.pickup.restaurant_name}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ color: 'var(--text-primary)' }}><Icon name="map" size="lg" /></span>
              <div style={{ flex: 1, display: 'grid', gap: 2 }}>
                <span style={{ fontWeight: 600 }}>Head to {ASSIGNMENT.pickup.restaurant_name}</span>
                <span style={{ fontSize: 'var(--type-body-sm-size)' }}>{ASSIGNMENT.order_code} · Resume</span>
              </div>
              <Icon name="chevron-right" size="md" />
            </div>
          </Card>
        )}
        <TodayCard />
      </>
    );
  };
  return (
    <RiderScreen title={title} subtitle={subtitle} tab="home" go={go}
      actions={variant === 'BLOCKED' || variant === 'ON_DELIVERY' ? null
        : <Switch size="sm" label="Availability" stateLabel={{ on: 'Online', off: 'Offline' }} checked={online} onCheckedChange={() => {}} />}>
      <Pad>{body()}</Pad>
    </RiderScreen>
  );
}

Object.assign(window, { OnlineScreen, HOME_VARIANTS });
