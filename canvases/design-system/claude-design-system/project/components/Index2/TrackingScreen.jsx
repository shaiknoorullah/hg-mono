/* Live tracking (GET /v1/orders/{id}/tracking -> OrderTracking), tamper report and rating.
   - StatusTimeline (audience="customer") takes the contract OrderState and OrderTracking.timeline
     (OrderTransition[]) as they arrive; the component's shared mapping decides the steps.
   - Seal copy follows real handoff events (bindPackageSeal, scanPickup, scanDelivery). It never
     uses the halal toast tone and never claims an outcome before the scan that proves it.
   - Rider card: RiderPublicProfile only (first_name, last_initial, photo_url, vehicle_type,
     rating_avg). No messaging: the contract has none at V1 (D-24). */
const { AppBar, Card, Button, StatusTimeline, Countdown, Icon, Rating, Price, Badge, Input, IconButton } = window.HalalGoesDesignSystem_d11a47;

/* Wire timestamps (RFC 3339). 'HH:MM' is shorthand for today at that time in Toronto. */
const iso = at => /^\d\d:\d\d$/.test(at) ? '2026-09-28T' + at + ':00-04:00' : at;
const hhmm = at => at.slice(11, 16);
const T = (to, at, actor = 'SYSTEM', reason = null) => ({ to_state: to, at: iso(at), actor_kind: actor, reason });
const BASE = [T('AUTHORIZED', '18:42', 'CUSTOMER'), T('RESTAURANT_PENDING', '18:42')];
const WITH_PREP = [...BASE, T('PREPARING', '18:44', 'RESTAURANT')];

/* Each variant is one OrderTracking payload (plus the order's can_cancel and handoff events). */
const TRACK = {
  RESTAURANT_PENDING: { state: 'RESTAURANT_PENDING', timeline: BASE, can_cancel: true, deadline_at: iso('18:45'), seal: {} },
  REJECTED: { state: 'REJECTED', timeline: [...BASE, T('REJECTED', '18:43', 'RESTAURANT', 'KITCHEN_AT_CAPACITY')], seal: {} },
  TIMED_OUT: { state: 'REJECTED', timeline: [...BASE, T('REJECTED', '18:45', 'SYSTEM', 'ACCEPT_WINDOW_EXPIRED')], seal: {} },
  PREPARING: { state: 'PREPARING', timeline: WITH_PREP, eta: '19:14', eta_at: iso('19:14'), window: 10, seal: { bound_at: '18:58' } },
  NO_RIDER_FOUND: { state: 'READY_FOR_PICKUP', dispatch_state: 'NO_RIDER_FOUND', timeline: [...WITH_PREP, T('READY_FOR_PICKUP', '18:59', 'RESTAURANT')], seal: { bound_at: '18:58' } },
  PICKED_UP: { state: 'PICKED_UP', timeline: [...WITH_PREP, T('READY_FOR_PICKUP', '18:59', 'RESTAURANT'), T('PICKED_UP', '19:02', 'RIDER')], eta: '19:14', eta_at: iso('19:14'), window: 5, rider: true, seal: { bound_at: '18:58', pickup: 'INTACT' } },
  ARRIVED: { state: 'ARRIVED', timeline: [...WITH_PREP, T('READY_FOR_PICKUP', '18:59', 'RESTAURANT'), T('PICKED_UP', '19:02', 'RIDER'), T('ARRIVED', '19:12', 'RIDER')], rider: true, seal: { bound_at: '18:58', pickup: 'INTACT' } },
  DELIVERED: { state: 'DELIVERED', timeline: [...WITH_PREP, T('READY_FOR_PICKUP', '18:59', 'RESTAURANT'), T('PICKED_UP', '19:02', 'RIDER'), T('ARRIVED', '19:12', 'RIDER'), T('DELIVERED', '19:13', 'RIDER')], rider: true, seal: { bound_at: '18:58', pickup: 'INTACT', delivery: 'INTACT' } },
  DELIVERED_BROKEN: { state: 'DELIVERED', timeline: [...WITH_PREP, T('READY_FOR_PICKUP', '18:59', 'RESTAURANT'), T('PICKED_UP', '19:02', 'RIDER'), T('ARRIVED', '19:12', 'RIDER'), T('DELIVERED', '19:13', 'RIDER')], rider: true, seal: { bound_at: '18:58', pickup: 'INTACT', delivery: 'BROKEN' } },
  FAILED: { state: 'FAILED', timeline: [...WITH_PREP, T('PICKED_UP', '19:02', 'RIDER'), T('FAILED', '19:30', 'SUPPORT', 'Customer unreachable at the door')], seal: { bound_at: '18:58', pickup: 'INTACT' } },
  CANCELLED: { state: 'CANCELLED', timeline: [...BASE, T('CANCELLED', '18:43', 'CUSTOMER', 'ORDERED_BY_MISTAKE')], seal: {} },
  DISPUTED: { state: 'DISPUTED', timeline: [T('DELIVERED', '19:13', 'RIDER'), T('COMPLETED', '19:13'), T('DISPUTED', '19:40', 'CUSTOMER', 'Seal broken on arrival')], seal: { bound_at: '18:58', pickup: 'INTACT', delivery: 'BROKEN' } },
  RESOLVED: { state: 'RESOLVED', timeline: [T('COMPLETED', '19:13'), T('DISPUTED', '19:40', 'CUSTOMER'), T('RESOLVED', '2026-09-29T10:05:00-04:00', 'SUPPORT', 'Outcome recorded by support')], seal: { bound_at: '18:58', pickup: 'INTACT', delivery: 'BROKEN' } },
};
const TRACK_VARIANTS = [
  ['RESTAURANT_PENDING', 'Waiting for restaurant (can cancel)'], ['REJECTED', 'Rejected by restaurant'], ['TIMED_OUT', 'Restaurant timed out'],
  ['PREPARING', 'Preparing (sealed)'], ['NO_RIDER_FOUND', 'No rider found yet'], ['PICKED_UP', 'On the way'], ['ARRIVED', 'Rider arrived'],
  ['DELIVERED', 'Delivered → rate'], ['DELIVERED_BROKEN', 'Delivered, seal scan broken'], ['FAILED', 'Delivery failed'], ['CANCELLED', 'Cancelled by you'],
  ['DISPUTED', 'Disputed'], ['RESOLVED', 'Resolved'],
].map(([id, label]) => ({ id, label }));

const REASON = { KITCHEN_AT_CAPACITY: 'the kitchen is at capacity', ORDERED_BY_MISTAKE: 'ordered by mistake' };

function SealRow({ seal, state, go }) {
  const rows = [];
  if (seal.bound_at) rows.push(['lock', 'Sealed at the kitchen', 'Tamper-evident seal bound to this order at ' + seal.bound_at]);
  if (seal.pickup) rows.push(['check', 'Seal scanned at pickup', seal.pickup === 'INTACT' ? 'Your rider scanned it on collection.' : 'Scan recorded; support has the trail.']);
  if (seal.delivery) rows.push([seal.delivery === 'INTACT' ? 'check' : 'warning', 'Seal scanned at your door', seal.delivery === 'INTACT' ? 'The scan at delivery matched this order.' : 'The scan at delivery recorded a broken seal.']);
  if (!rows.length) return null;
  const canReport = ['DELIVERED', 'COMPLETED'].includes(state);
  return (
    <Card radius="lg" variant="outlined">
      <div style={{ fontSize: 'var(--type-label-lg-size)', fontWeight: 600, marginBottom: 2 }}>Seal</div>
      {rows.map(([i, t, s]) => <GapListRow key={t} icon={i} title={t} sub={s} />)}
      {canReport && <Button variant="tertiary" fullWidth iconStart="warning" style={{ marginTop: 10 }} onPress={() => go('tamper')}>Seal broken? Report it</Button>}
    </Card>
  );
}

function TrackingScreen({ state, variant, go }) {
  const t = TRACK[variant] || TRACK.PREPARING;
  const last = t.timeline[t.timeline.length - 1];
  const title = t.eta ? 'Arriving ' + t.eta : ORDER_STATE[t.state][0];
  const header = <AppBar tone="cream" title={title} subtitle={'Zaytoun Grill · order A7Q2' + (t.window ? ' · ±' + t.window + ' min' : '')}
    actions={<Button variant="ghost" size="sm" onPress={() => go('orders')}>Orders</Button>} />;
  const showMap = ['PICKED_UP', 'ARRIVED', 'PREPARING', 'READY_FOR_PICKUP'].includes(t.state);
  return (
    <Screen header={header} footer={<Tabs value="orders" go={go} />} pad={false}>
      <Stateful state={state}
        loading={<div style={{ padding: 16 }}><GapSkeleton rows={3} height={80} /></div>}
        empty={<GapEmptyState icon="orders" title="No order to track" body="Your active orders show here." action="Discover restaurants" onAction={() => go('home')} />}
        error={<GapErrorState title="Live updates paused" body="We'll reconnect automatically. Your order is still going ahead." />}>
        {showMap && <GapMap height={170} pins={[{ kind: 'restaurant', label: 'restaurant_location' }, ...(t.rider ? [{ kind: 'rider', label: 'rider_location' }] : []), { kind: 'customer', label: 'destination_location' }]} />}
        <div style={{ padding: 'var(--space-4)', display: 'grid', gap: 12 }}>
          {t.state === 'RESTAURANT_PENDING' && (
            <GapBanner tone="info" icon="clock" title="Waiting for Zaytoun Grill to accept">
              Your card is authorised, not charged. If the restaurant doesn't accept by {hhmm(t.deadline_at)}, the authorisation is released.
              <Countdown expiresAt={t.deadline_at} serverNow={SERVER_NOW} windowSeconds={180} variant="bar" size="sm" label="Restaurant has" style={{ marginTop: 8 }} />
            </GapBanner>
          )}
          {t.state === 'REJECTED' && (
            <GapBanner tone="warning" title={last.actor_kind === 'SYSTEM' ? 'The restaurant didn\'t respond in time' : 'Zaytoun Grill couldn\'t take this order'}
              action={<Button size="sm" variant="secondary" onPress={() => go('home')}>Find another</Button>}>
              {last.actor_kind === 'SYSTEM' ? 'No answer within 3 minutes.' : 'Reason: ' + REASON[last.reason] + '.'} You were not charged: the authorisation on your card was voided.
            </GapBanner>
          )}
          {t.dispatch_state === 'NO_RIDER_FOUND' && <GapBanner tone="warning" icon="clock" title="Still looking for a rider">Your food is ready and sealed. Support has been alerted and will update you here.</GapBanner>}
          {t.state === 'CANCELLED' && <GapBanner tone="neutral" title="You cancelled this order">Reason: {REASON[last.reason]}. The authorisation on your card was released.</GapBanner>}
          {t.state === 'FAILED' && <GapBanner tone="warning" title="This delivery failed" action={<Button size="sm" variant="secondary">Get help</Button>}>{last.reason}. Support will follow up on your payment.</GapBanner>}
          {t.state === 'DISPUTED' && <GapBanner tone="info" title="A person is reviewing this order">You reported: {last.reason.toLowerCase()}. We'll notify you when it's resolved.</GapBanner>}
          {t.state === 'RESOLVED' && <GapBanner tone="neutral" icon="check" title="Resolved">{last.reason} on 29 September at {hhmm(last.at)}. See Alerts for the details.</GapBanner>}
          {t.state === 'DELIVERED' && (
            <GapBanner tone="neutral" icon="check" title={'Delivered at ' + hhmm(last.at)} action={<Button size="sm" variant="secondary" onPress={() => go('rate')}>Rate</Button>}>How was it?</GapBanner>
          )}

          {t.rider && (
            <Card radius="lg" variant="outlined">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <GapAvatar name={RIDER.first_name + ' ' + RIDER.last_initial} src={RIDER.photo_url} />
                <div style={{ flex: 1, display: 'grid', gap: 2 }}>
                  <div style={{ fontSize: 'var(--type-label-lg-size)', fontWeight: 600 }}>{RIDER.first_name} {RIDER.last_initial}.</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--type-body-sm-size)', color: 'var(--text-tertiary)' }}>
                    <span>{VEHICLE_LABEL[RIDER.vehicle_type]}</span>
                    <Rating value={RIDER.rating_avg} size="sm" showCount={false} />
                  </div>
                </div>
              </div>
            </Card>
          )}

          <Card radius="lg" variant="outlined">
            <StatusTimeline audience="customer" state={t.state} transitions={t.timeline} estimatedAt={t.eta_at || null}
              deadlineAt={t.deadline_at || null} showTimes now={Date.parse(SERVER_NOW)} />
            {t.can_cancel && <Button variant="ghost" fullWidth iconStart="close" destructive>Cancel order</Button>}
          </Card>

          <SealRow seal={t.seal} state={t.state} go={go} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
            <Halal halal={R_ZAYTOUN.halal} restaurantId={R_ZAYTOUN.id} />
            <Price cents={QUOTE.total_cents} size="md" />
          </div>
        </div>
      </Stateful>
    </Screen>
  );
}

/* Tamper report: POST /v1/orders/{id}/handoff/tamper-report {photo_object_id, note (5-500)}.
   Filed by the customer, never the rider. No outcome is promised (claims.ts SEAL / REJECTED). */
function TamperReportScreen({ state, variant, go }) {
  const header = <AppBar tone="cream" onBack={() => go('tracking', 'DELIVERED')} backLabel="Back to order A7Q2" title="Report a broken seal" subtitle="Order A7Q2 · Zaytoun Grill" />;
  if (variant === 'sent') {
    return <Screen header={header}><GapEmptyState icon="check" title="Report sent" body="A person will look at your photo together with the kitchen, pickup and delivery scans. We'll update you in Alerts." action="Back to order" onAction={() => go('tracking', 'DELIVERED')} /></Screen>;
  }
  const invalid = variant === 'invalid';
  return (
    <Screen header={header} footer={state === 'populated' ? <div style={{ padding: 'var(--space-4)' }}><Button fullWidth size="lg" disabled={invalid}>Send report</Button></div> : null}>
      <Stateful state={state} loading={<GapSkeleton rows={2} />} error={<GapErrorState title="Couldn't send your report" body="Your photo and note are kept. Try again." />}>
        <div style={{ display: 'grid', gap: 14 }}>
          <Muted>Take a photo of the seal as it arrived. Please don't throw the packaging away yet.</Muted>
          <GapFileUpload label="Photo of the seal" hint="Take or choose a photo" state={invalid ? 'error' : 'done'} fileName="IMG_2031.jpg" error={invalid ? 'Add a photo of the seal.' : undefined} />
          <Input label="What did you see?" placeholder="e.g. the seal was torn across the bag" value={invalid ? 'torn' : 'The label was torn across the opening.'} onChange={() => {}} required
            maxLength={500} characterCount errorText={invalid ? 'Tell us a little more (at least 5 characters).' : undefined} helperText={invalid ? undefined : '5–500 characters'} />
        </div>
      </Stateful>
    </Screen>
  );
}

/* Rating: PUT /v1/orders/{id}/rating {food{score,tags,review}, rider{score,comment}}. */
function RateScreen({ state, variant, go }) {
  const [food, setFood] = React.useState(4);
  const [rider, setRider] = React.useState(5);
  const header = <AppBar tone="cream" onBack={() => go('tracking', 'DELIVERED')} backLabel="Back to order A7Q2" title="Rate your order" subtitle="A7Q2 · Zaytoun Grill" />;
  if (variant === 'sent') return <Screen header={header}><GapEmptyState icon="star" title="Thanks for rating" body="Ratings are shown as an average on the restaurant and rider." action="Done" onAction={() => go('orders')} /></Screen>;
  return (
    <Screen header={header} footer={state === 'populated' ? <div style={{ padding: 'var(--space-4)' }}><Button fullWidth size="lg" onPress={() => go('rate', 'sent')}>Submit</Button></div> : null}>
      <Stateful state={state} loading={<GapSkeleton rows={2} />} error={<GapErrorState title="Couldn't save your rating" />}>
        <div style={{ display: 'grid', gap: 18 }}>
          <div style={{ display: 'grid', gap: 8 }}>
            <H2>The food</H2><Rating variant="input" label="Rate the food" value={food} onChange={setFood} />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{['Food quality', 'Portion size', 'Packaging', 'Value', 'Speed'].map((t, i) => <GapChip key={t} label={t} selected={i === 0} />)}</div>
            <Input label="Anything to add? (optional)" placeholder="Visible to the restaurant" />
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <H2>Your rider, {RIDER.first_name}</H2><Rating variant="input" label={'Rate your rider, ' + RIDER.first_name} value={rider} onChange={setRider} />
            <Input label="Comment (optional)" />
          </div>
        </div>
      </Stateful>
    </Screen>
  );
}
Object.assign(window, { TrackingScreen, TamperReportScreen, RateScreen, TRACK_VARIANTS });
