/* The offer (DispatchOffer): DS Sheet variant="full" dismissible={false} — no scrim tap, no Escape,
   no close button until the server's expires_at (D-14). It replaces the old offer surface.
   K-34: Countdown windowSeconds={30} (dispatch.offer_ttl_seconds), driven by expires_at and
   server_time from the payload, never a local constant. Outcomes: expired, withdrawn, taken (409).
   K-35: before acceptance only dropoff.area is known: no buzzer, no unit, no ready time.
   K-36: 'Estimated $X · tip so far $Y'. Accept is the one 72px critical action at the thumb;
   Decline sits at the top, away from the thumb, and asks for an OfferRejectReasonCode. */
const { Countdown, Button, Price, Icon, Badge, Card, Sheet, RadioGroup } = window.HalalGoesDesignSystem_d11a47;

const OFFER_VARIANTS = [
  { id: 'live', label: 'Live offer (PENDING)' },
  { id: 'decline', label: 'Decline → reason picker' },
  { id: 'EXPIRED', label: 'Outcome: expired' },
  { id: 'WITHDRAWN', label: 'Outcome: withdrawn' },
  { id: 'taken', label: 'Outcome: already taken (409)' },
];

function OfferOutcome({ icon, title, body, go }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateRows: '1fr auto', background: 'var(--surface-base)', color: 'var(--text-primary)' }}>
      <div style={{ display: 'grid', alignContent: 'center' }}><GapEmptyState icon={icon} title={title} body={body} /></div>
      <div style={{ padding: 'var(--space-4) var(--space-4) var(--space-6)' }}>
        <Button size="xl" fullWidth variant="secondary" onPress={() => go('home')}>Back to waiting</Button>
      </div>
    </div>
  );
}

/* Reason picker. A bottom Sheet stacked ABOVE the offer sheet: the wrapper is a positioned layer
   one step over z-offer-sheet, and the Sheet is `contained` inside it. */
function DeclineSheet({ open, onClose }) {
  const [reason, setReason] = React.useState(null);
  if (!open) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 'calc(var(--z-offer-sheet) + 1)' }}>
      <Sheet open contained title="Why are you declining?" onClose={onClose} maxHeight="88%"
        footer={<div style={{ display: 'grid', gap: 8 }}>
          <Button size="xl" fullWidth variant="secondary" disabled={!reason}>{reason ? 'Decline offer' : 'Choose a reason'}</Button>
          <Button size="md" fullWidth variant="ghost" onPress={onClose}>Keep the offer</Button>
        </div>}>
        <RadioGroup label="Decline reason" hideLabel value={reason} onValueChange={setReason} required
          options={OFFER_REJECT_REASONS.map(([code, label]) => ({ value: code, label }))} />
        <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--type-caption-size)', color: 'var(--text-secondary)' }}>The timer keeps running while you choose.</p>
      </Sheet>
    </div>
  );
}

function OfferScreen({ variant, state, go }) {
  const [declining, setDeclining] = React.useState(variant === 'decline');
  React.useEffect(() => setDeclining(variant === 'decline'), [variant]);
  if (variant === 'EXPIRED') return <OfferOutcome go={go} icon="clock" title="The offer expired" body="Nobody answered within 30 seconds, so it went to another rider. It doesn’t count against you." />;
  if (variant === 'WITHDRAWN') return <OfferOutcome go={go} icon="close" title="This offer was withdrawn" body="The order changed or was cancelled before anyone accepted it." />;
  if (variant === 'taken') return <OfferOutcome go={go} icon="profile" title="Another rider took this one" body="Offers go to a few riders at once and the first to accept gets it. Stay online for the next one." />;
  const o = OFFER;
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--surface-base)' }}>
      <Sheet open contained variant="full" dismissible={false} title="New delivery offer"
        footer={<Button size="xl" critical fullWidth loading={state === 'loading'} onPress={() => go('trip', 'ASSIGNED')}>{state === 'error' ? 'Try accepting again' : 'Accept'}</Button>}>
        <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Button size="sm" variant="tertiary" onPress={() => setDeclining(true)}>Decline…</Button>
            <Badge variant="brand" appearance="solid" size="sm">New offer</Badge>
          </div>
          <div style={{ display: 'grid', justifyItems: 'center', gap: 4, textAlign: 'center' }}>
            <Countdown variant="ring" size="lg" onDark label="to answer"
              expiresAt={o.expires_at} serverNow={o.server_time} windowSeconds={30} />
            <span style={{ fontSize: 'var(--type-caption-size)', color: 'var(--text-secondary)' }}>Timed by the server: expires_at − server_time</span>
          </div>
          <div style={{ textAlign: 'center', display: 'grid', gap: 4, justifyItems: 'center' }}>
            <span style={{ fontSize: 'var(--type-body-md-size)' }}>Estimated</span>
            <Price cents={o.earnings.estimated_total_cents} size="xl" onDark />
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'baseline', fontSize: 'var(--type-body-md-size)' }}>tip so far <Price cents={o.earnings.tip_so_far_cents} size="md" onDark /> · it can still change</span>
          </div>
          <Card variant="outlined" radius="lg">
            <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
              {[[null, 'Pickup · ' + o.pickup.restaurant_name, o.pickup.address_short], ['map', 'Drop-off area', o.dropoff.area]].map(([icon, t, s]) => (
                <div key={t} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <span style={{ width: 20, marginTop: 2 }}>{icon ? <Icon name={icon} size="md" /> : null}</span>
                  <span style={{ display: 'grid', gap: 2 }}>
                    <span style={{ fontSize: 'var(--type-body-lg-size)', fontWeight: 600 }}>{t}</span>
                    <span style={{ fontSize: 'var(--type-body-md-size)' }}>{s}</span>
                  </span>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--border-decorative)' }}>
                <Badge variant="outline" icon="map">{kmText(o.distance_m)}</Badge>
                <Badge variant="outline" icon="clock">{minText(o.est_duration_s)}</Badge>
                <Badge variant="outline" icon="cart">{o.items_count} items</Badge>
              </div>
              <span style={{ fontSize: 'var(--type-caption-size)', color: 'var(--text-secondary)' }}>The exact address, unit and buzzer arrive when you accept.</span>
            </div>
          </Card>
          {state === 'error' && <GapBanner tone="warning" title="Couldn’t accept">The network dropped. Try again while the timer is still running.</GapBanner>}
        </div>
      </Sheet>
      <DeclineSheet open={declining} onClose={() => setDeclining(false)} />
    </div>
  );
}

Object.assign(window, { OfferScreen, OFFER_VARIANTS });
