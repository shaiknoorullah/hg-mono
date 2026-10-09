const { Card, Button, Badge, Price, Countdown, Icon, Modal, RadioGroup, Select, Input, StatusTimeline } = window.HalalGoesDesignSystem_d11a47;

/* Columns follow OrderState. The queue reads RESTAURANT_PENDING, PREPARING and READY_FOR_PICKUP;
   "Collected" is read-only and fills only when the rider's pickup scan succeeds (PICKED_UP). */
const QUEUE_COLS = [
  { key: 'RESTAURANT_PENDING', label: 'New', hint: 'Accept within 3 min' },
  { key: 'PREPARING', label: 'Preparing' },
  { key: 'READY_FOR_PICKUP', label: 'Ready for pickup' },
  { key: 'PICKED_UP', label: 'Collected', hint: 'Rider scan' },
];

function OrderLines({ lines }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
      {lines.map(i => (
        <li key={i.name} style={{ display: 'flex', gap: 8, fontSize: 'var(--type-body-sm-size)' }}>
          <span style={{ fontVariantNumeric: 'var(--numeric-tabular)', color: 'var(--text-tertiary)', width: 18 }}>{i.quantity}×</span>
          <span style={{ flex: 1 }}>
            {i.name}
            {i.addon_names && <span style={{ display: 'block', color: 'var(--text-tertiary)' }}>+ {i.addon_names.join(', ')}</span>}
            {i.note && <span style={{ display: 'block', color: 'var(--text-secondary)', fontStyle: 'italic' }}>“{i.note}”</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* Decline opens a reason-code dialog (POST .../reject needs RestaurantRejectReasonCode) and says
   what it costs the customer and the restaurant (K-22). */
function RejectDialog({ order, onClose, onConfirm }) {
  const [reason, setReason] = React.useState('');
  return (
    <Modal open contained title={'Decline order #' + order.code + '?'} onClose={onClose}
      description="The customer's payment is released — they are not charged. Declines count toward your 7-day decline rate."
      actions={<>
        <Button variant="tertiary" onPress={onClose}>Keep order</Button>
        <Button variant="danger" destructive disabled={!reason} onPress={() => onConfirm(reason)}>Decline order #{order.code}</Button>
      </>}>
      <RadioGroup label="Reason (required)" name={'reject-' + order.code} required value={reason || null} onValueChange={setReason}
        options={REJECT_REASONS.map(([value, label]) => ({ value, label }))} />
    </Modal>
  );
}

/* POST .../delay with a DelayReasonCode. */
function DelayDialog({ order, onClose }) {
  const [mins, setMins] = React.useState('10');
  const [reason, setReason] = React.useState('HIGH_VOLUME');
  return (
    <Modal open contained title={'Add a delay to #' + order.code} onClose={onClose}
      description="The customer sees the new time. The rider is dispatched against it."
      actions={<><Button variant="tertiary" onPress={onClose}>Cancel</Button><Button onPress={onClose}>Add delay</Button></>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <Select label="Reason" defaultValue="HIGH_VOLUME" value={reason} onValueChange={setReason} options={DELAY_REASONS.map(([value, label]) => ({ value, label }))} />
        <RadioGroup label="Extra time" name={'delay-' + order.code} orientation="horizontal" value={mins} onValueChange={setMins}
          options={['5', '10', '15'].map(m => ({ value: m, label: m + ' min' }))} />
      </div>
    </Modal>
  );
}

/* Seal binding (POST /v1/orders/{id}/handoff/seal), a separate step from Mark ready (K-23). */
function SealBindRow({ order }) {
  const [code, setCode] = React.useState('');
  const [bound, setBound] = React.useState(order.seal_code);
  if (bound) return <Badge variant="neutral" icon="lock">Sealed · {bound}</Badge>;
  return (
    <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'minmax(0,1fr)' }}>
      <Input label="Seal code" placeholder="Scan or type the code" value={code} onValueChange={setCode} style={{ gridTemplateColumns: 'minmax(0,1fr)' }} />
      <Button variant="tertiary" size="md" iconStart="lock" onPress={() => setBound(code || 'HG-48220')}>Bind seal</Button>
    </div>
  );
}

function OrderCard({ o, expired, onReject, onDelay }) {
  return (
    <Card radius="lg" variant={o.state === 'RESTAURANT_PENDING' ? 'elevated' : 'outlined'} padding="0">
      <div style={{ padding: 'var(--space-4)', display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 'var(--type-label-lg-size)', fontWeight: 700, fontVariantNumeric: 'var(--numeric-tabular)' }}>#{o.code}</span>
          <Badge variant="neutral" size="sm">{hhmm(o.placed_at)}</Badge>
        </div>
        <div style={{ fontSize: 'var(--type-heading-sm-size)', fontWeight: 600 }}>{o.customer}</div>
        <OrderLines lines={o.lines} />
        <div style={{ paddingTop: 8, borderTop: '1px solid var(--border-decorative)' }}><Price cents={o.total_cents} size="md" /></div>
        {o.state !== 'RESTAURANT_PENDING' && <StatusTimeline audience="restaurant" state={o.state} orientation="compact" />}
        {o.state === 'RESTAURANT_PENDING' && !expired && (
          <Countdown expiresAt={o.deadline_at} serverNow={SERVER_TIME} windowSeconds={180} variant="bar" size="sm" label="to accept · server deadline" />
        )}
      </div>
      <div style={{ padding: '0 var(--space-4) var(--space-4)', display: 'grid', gap: 8 }}>
        {o.state === 'RESTAURANT_PENDING' && expired && (
          <GapBanner tone="warning" icon="clock" title="Timed out — payment released">
            Nobody accepted #{o.code} within 3 minutes. The customer was not charged and it counts as a missed order.
          </GapBanner>
        )}
        {o.state === 'RESTAURANT_PENDING' && !expired && (
          <>
            <Button variant="primary" critical fullWidth iconStart="check" accessibilityLabel={'Accept order #' + o.code}>Accept</Button>
            <div style={{ height: 24 }} aria-hidden="true" />
            <Button variant="ghost" size="sm" onPress={() => onReject(o)} accessibilityLabel={'Decline order #' + o.code} style={{ justifySelf: 'center' }}>Decline…</Button>
          </>
        )}
        {o.state === 'PREPARING' && (
          <>
            <SealBindRow order={o} />
            <Button variant="secondary" iconStart="check" fullWidth disabled={!o.seal_code}>Mark ready</Button>
            {!o.seal_code && <span style={{ fontSize: 'var(--type-caption-size)', color: 'var(--text-tertiary)' }}>Bind the seal first.</span>}
            <Button variant="ghost" size="sm" iconStart="clock" onPress={() => onDelay(o)}>Add delay</Button>
          </>
        )}
        {o.state === 'READY_FOR_PICKUP' && (
          <div style={{ display: 'grid', gap: 6, fontSize: 'var(--type-body-sm-size)', color: 'var(--text-secondary)' }}>
            <Badge variant="neutral" icon="lock" size="sm">Sealed · {o.seal_code}</Badge>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--text-tertiary)' }}><Icon name="clock" size="sm" />Waiting for the rider to scan the seal</span>
          </div>
        )}
        {o.state === 'PICKED_UP' && (
          <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--type-body-sm-size)', color: 'var(--text-tertiary)' }}>
            <Icon name="check" size="sm" /> Picked up {hhmm(o.picked_up_at)} · rider scanned {o.seal_code}
          </span>
        )}
      </div>
    </Card>
  );
}

function QueueBoard({ orders, expired }) {
  const [rejecting, setRejecting] = React.useState(null);
  const [delaying, setDelaying] = React.useState(null);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 'var(--space-4)', alignItems: 'start' }}>
      {QUEUE_COLS.map(c => {
        const list = orders.filter(o => o.state === c.key);
        return (
          <section key={c.key} style={{ display: 'grid', gap: 'var(--space-3)', alignContent: 'start', minWidth: 0, gridTemplateColumns: 'minmax(0,1fr)' }}>
            <header style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 'var(--type-heading-sm-size)', fontWeight: 600 }}>{c.label}</h2>
              <span style={{ fontSize: 'var(--type-label-md-size)', color: 'var(--text-tertiary)', fontVariantNumeric: 'var(--numeric-tabular)' }}>{list.length}</span>
              {c.hint && <span style={{ marginLeft: 'auto', fontSize: 'var(--type-caption-size)', color: 'var(--text-tertiary)' }}>{c.hint}</span>}
            </header>
            {list.map(o => <OrderCard key={o.id} o={o} expired={expired} onReject={setRejecting} onDelay={setDelaying} />)}
            {list.length === 0 && <GapEmptyState icon="orders" title="Nothing here" style={{ padding: 'var(--space-6) var(--space-3)', border: '1px dashed var(--border-decorative)', borderRadius: 'var(--radius-lg)' }} />}
          </section>
        );
      })}
      {rejecting && <RejectDialog order={rejecting} onClose={() => setRejecting(null)} onConfirm={() => setRejecting(null)} />}
      {delaying && <DelayDialog order={delaying} onClose={() => setDelaying(null)} />}
    </div>
  );
}

/* Browsers block audio until a user gesture, so going live starts with enabling sound (K-24). */
function SoundGate() {
  return (
    <Card radius="lg" variant="elevated" style={{ maxWidth: 520, justifySelf: 'center', marginTop: 'var(--space-8)' }}>
      <GapEmptyState icon="bell" title="Turn on order alerts to go live"
        body="New orders ring on this screen. You have 3 minutes to accept each one, so keep this tab open with sound on."
        action="Enable sound and go live" />
    </Card>
  );
}

function QueueScreen({ state, variant }) {
  if (variant === 'sound') return <SoundGate />;
  return (
    <Stateful state={state}
      loading={<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 16 }}>{[0, 1, 2, 3].map(i => <GapSkeleton key={i} rows={2} />)}</div>}
      empty={<GapEmptyState icon="orders" title="No live orders" body="New orders appear here and ring. Keep this screen open: it checks in with the server so you keep receiving them." />}
      error={<GapErrorState title="Couldn't load the queue" body="Your orders are safe on the server. The screen retries on its own; if it keeps failing you will stop receiving new orders after 5 minutes." onRetry={() => {}} />}>
      <>
        {variant === 'offline' && (
          <GapBanner tone="warning" title="Connection lost — you are not receiving new orders">
            This screen has not checked in since {hhmm(AVAILABILITY.offline.last_heartbeat_at)}. Reconnecting… Orders already accepted are unaffected.
          </GapBanner>
        )}
        <QueueBoard orders={ORDERS} expired={variant === 'expired'} />
      </>
    </Stateful>
  );
}
Object.assign(window, { QueueScreen });
