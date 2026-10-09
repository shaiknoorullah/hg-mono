/* Active trip: one artboard per AssignmentState (K-37), with the seal scan at pickup and delivery,
   proof of delivery per required_pod_method, and the exception path. Transitions are strictly
   forward. Instructions, buzzer, unit, items and allergens are permanent content (K-38), never a
   toast, and exist only because the offer was accepted (Assignment payload). */
const { Button, StatusTimeline, Card, Input, Badge, Checkbox, Price, Icon, RadioGroup } = window.HalalGoesDesignSystem_d11a47;

const TRIP_VARIANTS = [
  { id: 'ASSIGNED', label: 'ASSIGNED' },
  { id: 'EN_ROUTE_TO_PICKUP', label: 'EN_ROUTE_TO_PICKUP' },
  { id: 'ARRIVED_AT_PICKUP', label: 'ARRIVED_AT_PICKUP · pickup seal scan' },
  { id: 'PICKED_UP', label: 'PICKED_UP' },
  { id: 'EN_ROUTE_TO_DROPOFF', label: 'EN_ROUTE_TO_DROPOFF' },
  { id: 'ARRIVED_AT_DROPOFF', label: 'ARRIVED_AT_DROPOFF · delivery seal scan' },
  { id: 'POD_OTP', label: 'Proof of delivery · OTP' },
  { id: 'POD_PHOTO', label: 'Proof of delivery · PHOTO' },
  { id: 'POD_ATTEST', label: 'Proof of delivery · PHOTO_WITH_ATTESTATION' },
  { id: 'DELIVERED', label: 'DELIVERED' },
  { id: 'UNDELIVERABLE', label: 'UNDELIVERABLE (report)' },
  { id: 'RETURNING', label: 'RETURNING' },
  { id: 'RETURNED', label: 'RETURNED' },
  { id: 'CANCELLED_BY_PLATFORM', label: 'CANCELLED_BY_PLATFORM' },
  { id: 'REASSIGNED', label: 'REASSIGNED' },
];

/* StatusTimeline draws OrderState only; AssignmentState is not OrderState. The progress strip is
   therefore StatusTimeline audience="rider" fed with the ORDER state the Assignment payload carries
   (pickup.order_state), sampled per step below. The AssignmentState itself is the artboard variant,
   and each step's content (scan, proof of delivery, exception) is the kit's own list. */
const ORDER_STATE_AT = { ASSIGNED: 'PREPARING', EN_ROUTE_TO_PICKUP: 'PREPARING', ARRIVED_AT_PICKUP: 'READY_FOR_PICKUP', PICKED_UP: 'PICKED_UP', EN_ROUTE_TO_DROPOFF: 'PICKED_UP', ARRIVED_AT_DROPOFF: 'ARRIVED', POD_OTP: 'ARRIVED', POD_PHOTO: 'ARRIVED', POD_ATTEST: 'ARRIVED', DELIVERED: 'DELIVERED' };

function PickupDetails({ a }) {
  return (
    <Card variant="outlined" radius="lg">
      <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <SectionLabel>Pickup</SectionLabel>
        <GapKeyValue labelWidth={96} rows={[['Restaurant', a.pickup.restaurant_name], ['Address', a.pickup.address], ['Order code', a.order_code, { mono: true }], ['Pickup notes', a.pickup.pickup_notes]]} />
      </div>
    </Card>
  );
}
function DropoffDetails({ a }) {
  const d = a.dropoff;
  return (
    <Card variant="outlined" radius="lg">
      <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <SectionLabel>Drop-off</SectionLabel>
        <GapKeyValue labelWidth={96} rows={[
          ['Customer', d.customer_display_name], ['Address', d.address], ['Unit', d.unit], ['Buzzer', d.buzzer, { mono: true }],
          ['Instructions', d.delivery_instructions.map(i => INSTRUCTION_TEXT[i]).join(' · ')], ['Note', d.special_instructions],
        ]} />
      </div>
    </Card>
  );
}
function ItemsCard({ a }) {
  return (
    <Card variant="outlined" radius="lg">
      <SectionLabel>Items · check against the bag</SectionLabel>
      <ItemsList items={a.items} />
    </Card>
  );
}

function PodBlock({ method }) {
  const [attest, setAttest] = React.useState(false);
  if (method === 'OTP') return (
    <Card variant="outlined" radius="lg">
      <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <div style={{ fontSize: 'var(--type-heading-sm-size)', fontWeight: 600 }}>Ask for the 4-digit code</div>
        <Body>The customer sees it in their app. It proves you handed the order over in person.</Body>
        {/* The POD code is 4 digits (contract ^[0-9]{4}$); the DS otp variant is fixed at 6 cells, so numeric + maxLength. */}
        <Input size="lg" label="Delivery code" variant="numeric" maxLength={4} placeholder="4 digits" />
      </div>
    </Card>
  );
  return (
    <Card variant="outlined" radius="lg">
      <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <div style={{ fontSize: 'var(--type-heading-sm-size)', fontWeight: 600 }}>Take a photo of the drop-off</div>
        <Body>Show the bag at the door, with the unit number in frame if you can.</Body>
        <GapScanner height={130} caption="Camera: photo of the bag at the door" />
        {method === 'PHOTO_WITH_ATTESTATION' && (
          <Checkbox label="I left the order where the customer asked" description="Required for this drop-off." checked={attest} onCheckedChange={setAttest} />
        )}
      </div>
    </Card>
  );
}

/* Nothing pre-selected; Send stays disabled until a reason is chosen. */
function UndeliverableReasons() {
  const [r, setR] = React.useState(null);
  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <RadioGroup label="What went wrong?" value={r} onValueChange={setR} required
        options={['Customer not answering', 'Address can’t be found', 'Unsafe to deliver', 'Order damaged'].map(x => ({ value: x, label: x }))} />
      <Button size="xl" fullWidth variant="secondary" disabled={!r}>{r ? 'Send to support' : 'Choose a reason'}</Button>
    </div>
  );
}

function ActiveScreen({ variant, state, go }) {
  const a = ASSIGNMENT;
  const [tpl, setTpl] = React.useState(false);
  const v = variant;
  const toDropoff = ['PICKED_UP', 'EN_ROUTE_TO_DROPOFF', 'ARRIVED_AT_DROPOFF', 'POD_OTP', 'POD_PHOTO', 'POD_ATTEST'].includes(v);
  const terminal = { DELIVERED: 1, RETURNED: 1, CANCELLED_BY_PLATFORM: 1, REASSIGNED: 1 }[v];

  const cta = {
    ASSIGNED: 'Start trip to restaurant', EN_ROUTE_TO_PICKUP: 'I’ve arrived at the restaurant', PICKED_UP: 'Start trip to customer',
    EN_ROUTE_TO_DROPOFF: 'I’ve arrived', POD_OTP: 'Confirm delivery', POD_PHOTO: 'Confirm delivery', POD_ATTEST: 'Confirm delivery',
    RETURNING: 'I’m back at the restaurant', RETURNED: 'Back to waiting', DELIVERED: 'Back to waiting', CANCELLED_BY_PLATFORM: 'Back to waiting', REASSIGNED: 'Back to waiting',
  }[v];

  const content = () => {
    if (state === 'loading') return <GapSkeleton rows={2} />;
    if (state === 'error') return <GapErrorState title="Couldn’t update the trip" body="Your last step wasn’t saved. Nothing changed for the customer. Try again." />;
    if (v === 'DELIVERED') return (
      <>
        <GapEmptyState icon="check" title="Delivered" body={a.order_code + ' is complete. Your earnings for it will show in Earnings once finalised.'} />
        <Card variant="outlined" radius="lg"><EstimateLine earnings={a.earnings} /></Card>
      </>
    );
    if (v === 'UNDELIVERABLE') return (
      <>
        <GapBanner tone="warning" title="Can’t deliver?">Tell us why. Support is notified and you’ll be told whether to return the order to the restaurant.</GapBanner>
        <Card variant="outlined" radius="lg">
          <UndeliverableReasons />
        </Card>
      </>
    );
    if (v === 'RETURNING') return (<><GapBanner tone="info" title="Return the order to the restaurant">Support asked you to take it back. The seal stays on; don’t open the bag.</GapBanner><PickupDetails a={a} /></>);
    if (v === 'RETURNED') return <GapEmptyState icon="check" title="Returned to the restaurant" body="Thanks. Support will settle this trip; any payment for it shows in Earnings." />;
    if (v === 'CANCELLED_BY_PLATFORM') return <GapEmptyState icon="close" title="This trip was cancelled" body="HalalGoes cancelled the order. If you already collected it, support will tell you what to do with it." />;
    if (v === 'REASSIGNED') return <GapEmptyState icon="profile" title="This trip moved to another rider" body="Support reassigned it. You don’t need to do anything." />;
    return (
      <>
        {!toDropoff && <PickupDetails a={a} />}
        {v === 'ARRIVED_AT_PICKUP' && <><ItemsCard a={a} /><SealScan phase="pickup" /></>}
        {toDropoff && <DropoffDetails a={a} />}
        {(v === 'PICKED_UP' || v === 'EN_ROUTE_TO_DROPOFF') && <GapBanner tone="neutral" icon="lock">Keep the bag sealed. Don’t open it, even to check.</GapBanner>}
        {v === 'ARRIVED_AT_DROPOFF' && <SealScan phase="delivery" />}
        {v === 'POD_OTP' && <PodBlock method="OTP" />}
        {v === 'POD_PHOTO' && <PodBlock method="PHOTO" />}
        {v === 'POD_ATTEST' && <PodBlock method="PHOTO_WITH_ATTESTATION" />}
        {toDropoff
          ? <ContactActions who={a.dropoff.customer_display_name.split(' ')[0]} alias={a.dropoff.phone_alias} setTemplatesOpen={setTpl} />
          : <ContactActions who="restaurant" alias={a.pickup.phone_alias} setTemplatesOpen={setTpl} />}
        {v !== 'ARRIVED_AT_PICKUP' && <ItemsCard a={a} />}
        <Button variant="ghost" size="md" iconStart="warning" onPress={() => go('trip', 'UNDELIVERABLE')} style={{ justifySelf: 'start' }}>
          {toDropoff ? 'I can’t deliver this' : 'Problem at pickup'}
        </Button>
      </>
    );
  };

  const orderState = ORDER_STATE_AT[v];
  return (
    <RiderScreen title={terminal ? 'Trip ended' : v === 'UNDELIVERABLE' ? 'Report a problem' : 'Trip · ' + a.order_code}
      subtitle={a.pickup.restaurant_name + (toDropoff || v === 'DELIVERED' ? ' → ' + a.dropoff.address.split(',')[0] : '')}
      footer={cta && state === 'populated' ? <Button size="xl" fullWidth onPress={() => terminal && go('home')}>{cta}</Button> : null}
      overlay={<TemplatesSheet open={tpl} onClose={() => setTpl(false)} />}>
      {!terminal && orderState && state === 'populated' && (
        <GapMap height={130} caption="Route from the assignment's GeoPoints"
          pins={toDropoff ? [{ kind: 'rider', label: 'you' }, { kind: 'customer', label: 'dropoff' }] : [{ kind: 'rider', label: 'you' }, { kind: 'restaurant', label: 'pickup' }]} />
      )}
      <Pad>
        {orderState && !terminal && <StatusTimeline audience="rider" orientation="compact" state={orderState} />}
        {a.tracking_health !== 'HEALTHY' && <GapBanner tone="warning">Your location is not updating.</GapBanner>}
        {content()}
      </Pad>
    </RiderScreen>
  );
}

Object.assign(window, { ActiveScreen, TRIP_VARIANTS });
