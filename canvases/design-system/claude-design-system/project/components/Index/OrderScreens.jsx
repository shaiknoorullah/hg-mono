/* Orders (GET /v1/admin/orders, OrderSummary), order detail (OrderAdminView) and refunds.
   Every OrderState has a label and tone; refunds use RefundState in their own column.
   Money lines are the frozen OrderMoney from the server, rendered as given (no client maths). */
const { DataTable, Badge, Price, Button, Input, Select, Card, StatusTimeline, Modal } = window.HalalGoesDesignSystem_d11a47;

function OrdersScreen({ state, variant, go }) {
  const filtered = variant === 'filtered';
  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Input label="Order code" variant="search" placeholder="e.g. A7Q2" value={filtered ? 'ZZ00' : ''} onChange={() => {}} style={{ width: 220 }} />
        <Select label="State" value="" placeholder="All 14 states" onValueChange={() => {}} options={Object.keys(ORDER_STATE).map(k => ({ value: k, label: ORDER_STATE[k][0] }))} style={{ width: 240 }} />
        <Input label="Placed from" helperText="YYYY-MM-DD" value="2026-09-03" onChange={() => {}} style={{ width: 180 }} />
        <span style={{ marginLeft: 'auto', fontSize: 'var(--type-body-sm-size)', color: 'var(--text-tertiary)' }}>Newest first</span>
      </div>
      <DataTable caption="Orders, newest first" hideCaption density="compact" rows={state === 'populated' && !filtered ? ORDERS : []}
        status={state === 'loading' ? 'loading' : state === 'error' ? 'error' : 'ready'} errorMessage="Orders did not load." onRetry={() => {}}
        filtersActive={filtered} onClearFilters={() => go('orders')}
        emptyState={{ title: 'No orders yet', description: 'Orders appear here as soon as a customer pays.' }}
        onRowActivate={() => go('order')} rowLabel={r => 'order ' + r.code}
        rowActions={r => [{ label: 'Open order', onSelect: () => go('order') }, { label: 'Issue refund…', disabled: r.state === 'REJECTED', disabledReason: 'Nothing was captured: the authorisation was voided', onSelect: () => go('refunds') }]}
        columns={[
          { key: 'code', label: 'Order', render: r => <span style={{ display: 'grid' }}><strong style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--type-mono-sm-size)' }}>#{r.code}</strong><ShortId id={r.id} /></span> },
          { key: 'placed_at', label: 'Placed', muted: true, numeric: true },
          { key: 'restaurant', label: 'Restaurant' },
          { key: 'item_count', label: 'Items', numeric: true },
          { key: 'state', label: 'State', render: r => <OrderStateBadge s={r.state} /> },
          { key: 'total_cents', label: 'Total', align: 'end', numeric: true, render: r => <Price cents={r.total_cents} size="sm" /> },
        ]} />
    </div>
  );
}

/* Order detail variants by state. */
const DETAIL = {
  PREPARING: { code: 'A7Q2', state: 'PREPARING', payment: 'REQUIRES_CAPTURE→SUCCEEDED (captured on acceptance)', dispatch: 'OFFERED', money: [3298, 489, 0, 400, 4187], refunds: [], timeline: [['CREATED', 'CUSTOMER', '18:47:02'], ['AUTHORIZED', 'SYSTEM', '18:47:05'], ['RESTAURANT_PENDING', 'SYSTEM', '18:47:05'], ['PREPARING', 'RESTAURANT', '18:48:31']], cancel: true },
  REJECTED: { code: 'Y1LM', state: 'REJECTED', payment: 'CANCELED (authorisation voided, nothing captured)', dispatch: null, money: [2499, 400, 0, 300, 3199], refunds: [], timeline: [['CREATED', 'CUSTOMER', '18:34:10'], ['AUTHORIZED', 'SYSTEM', '18:34:12'], ['RESTAURANT_PENDING', 'SYSTEM', '18:34:12'], ['REJECTED', 'RESTAURANT', '18:35:40', 'KITCHEN_AT_CAPACITY']], cancel: false },
  DELIVERED: { code: 'B4WZ', state: 'DELIVERED', payment: 'SUCCEEDED', dispatch: 'COMPLETED', money: [1349, 350, 0, 200, 1899], refunds: [{ id: ID.ref1, reason_code: 'ITEM_MISSING', amount_cents: 649, state: 'SETTLED', requested_at: '19:22' }], timeline: [['CREATED', 'CUSTOMER', '18:38:00'], ['AUTHORIZED', 'SYSTEM', '18:38:02'], ['RESTAURANT_PENDING', 'SYSTEM', '18:38:02'], ['PREPARING', 'RESTAURANT', '18:38:50'], ['READY_FOR_PICKUP', 'RESTAURANT', '18:52:12'], ['PICKED_UP', 'RIDER', '18:58:40'], ['ARRIVED', 'RIDER', '19:09:02'], ['DELIVERED', 'RIDER', '19:10:15']], cancel: false },
  DISPUTED: { code: 'C3QQ', state: 'DISPUTED', payment: 'SUCCEEDED · chargeback opened', dispatch: 'COMPLETED', money: [1299, 350, 0, 100, 1749], refunds: [{ id: ID.ref1, reason_code: 'HALAL_INTEGRITY', amount_cents: 1749, state: 'PENDING_APPROVAL', requested_at: '20:02' }], timeline: [['CREATED', 'CUSTOMER', '18:12:00'], ['DELIVERED', 'RIDER', '18:49:30'], ['COMPLETED', 'SYSTEM', '19:49:30'], ['DISPUTED', 'SYSTEM', '20:01:12', 'Seal reported broken (tamper report)']], cancel: false },
};

function OrderDetailScreen({ state, variant = 'PREPARING', go }) {
  const d = DETAIL[variant];
  const [dlg, setDlg] = React.useState(null);
  const [pii, setPii] = React.useState(false);
  return (
    <Stateful state={state} loading={<GapSkeleton rows={3} />}
      empty={<GapEmptyState icon="orders" title="Order not found" body="No order has this id or code." action="Back to orders" onAction={() => go('orders')} />}
      error={<GapErrorState title="Could not load this order" />}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 380px', gap: 'var(--space-5)', alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <Card radius="lg" variant="outlined" style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h3 style={{ margin: 0, fontSize: 'var(--type-heading-lg-size)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>#{d.code}</h3>
              <OrderStateBadge s={d.state} />
              <span style={{ marginLeft: 'auto' }}><ShortId id={ID.o1} /></span>
            </div>
            <GapKeyValue rows={[
              ['Restaurant', 'Zaytoun Grill'],
              ['Customer', pii ? 'Aisha Malik · +1 416 555 0134' : 'Aisha M. · phone hidden'],
              ['Payment', d.payment], ['Dispatch', d.dispatch ? human(d.dispatch) : '—'],
            ]} />
            {!pii && <Button size="sm" variant="ghost" onPress={() => setDlg('pii')} style={{ justifySelf: 'start' }}>Reveal contact details…</Button>}
          </Card>
          <Card radius="lg" variant="outlined">
            <h4 style={{ margin: '0 0 12px', fontSize: 'var(--type-heading-sm-size)', fontWeight: 600 }}>Timeline</h4>
            <StatusTimeline audience="admin" state={d.state} showTimes
              transitions={d.timeline.map(([s, actor, at], i) => ({ to_state: s, from_state: i ? d.timeline[i - 1][0] : null, at: '2026-09-03T' + at + '-04:00' }))} />
            <h5 style={{ margin: '14px 0 6px', fontSize: 'var(--type-label-md-size)', fontWeight: 600, color: 'var(--text-secondary)' }}>Audit (OrderTransition.actor_kind, reason)</h5>
            <GapKeyValue labelWidth={90} rows={d.timeline.map(([s, actor, at, reason]) => [at, ORDER_STATE[s][0] + ' · ' + human(actor) + (reason ? ' · ' + reason : '')])} />
          </Card>
          <div style={{ display: 'grid', gap: 8 }}>
            <h4 style={{ margin: 0, fontSize: 'var(--type-heading-sm-size)', fontWeight: 600 }}>Refunds</h4>
            <DataTable caption="Refunds on this order" hideCaption density="compact" rows={d.refunds} rowLabel={r => 'refund ' + human(r.reason_code)}
              emptyState={{ title: 'No refunds on this order', description: 'Issue one from Actions if the customer is owed money.' }} columns={[
              { key: 'id', label: 'Refund', render: r => <ShortId id={r.id} /> },
              { key: 'reason_code', label: 'Reason', render: r => human(r.reason_code) },
              { key: 'requested_at', label: 'Requested', muted: true },
              { key: 'state', label: 'Refund state', render: r => <RefundStateBadge s={r.state} /> },
              { key: 'amount_cents', label: 'Amount', align: 'end', render: r => <Price cents={r.amount_cents} size="sm" /> },
            ]} />
          </div>
        </div>
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <Card radius="lg" variant="outlined">
            <h4 style={{ margin: '0 0 8px', fontSize: 'var(--type-heading-sm-size)', fontWeight: 600 }}>Money (as charged)</h4>
            <GapKeyValue labelWidth={150} rows={[
              ['Subtotal', <Price cents={d.money[0]} size="sm" />], ['Delivery fee', <Price cents={d.money[1]} size="sm" />],
              ['Service fee', <Price cents={d.money[2]} size="sm" />], ['Tip', <Price cents={d.money[3]} size="sm" />],
              ['Total', <Price cents={d.money[4]} size="md" />],
            ]} />
            <p style={{ margin: '8px 0 0', fontSize: 'var(--type-caption-size)', color: 'var(--text-tertiary)' }}>OrderMoney, frozen from the quote. Tax lines appear only when the quote carried them (O-01 open).</p>
          </Card>
          <Card radius="lg" variant="outlined" style={{ display: 'grid', gap: 8 }}>
            <h4 style={{ margin: 0, fontSize: 'var(--type-heading-sm-size)', fontWeight: 600 }}>Actions</h4>
            <Button variant="secondary" onPress={() => go('refunds')} disabled={d.state === 'REJECTED'}>Issue refund…</Button>
            <Button variant="ghost" destructive disabled={!d.cancel} onPress={() => setDlg('cancel')}>Cancel order…</Button>
            {d.state === 'REJECTED' && <GapBanner tone="neutral">Nothing to refund: the authorisation was voided when the restaurant rejected.</GapBanner>}
          </Card>
        </div>
        <Modal contained open={dlg === 'pii'} variant="confirm" onClose={() => setDlg(null)} title="Reveal contact details?"
          description="Every reveal is logged with your reason." confirmLabel="Reveal" onConfirm={() => { setPii(true); setDlg(null); }}>
          <Input label="Justification" value="Customer called about a missing item" onChange={() => {}} />
        </Modal>
        <Modal contained open={dlg === 'cancel'} variant="confirm" destructive onClose={() => setDlg(null)} title={'Cancel #' + d.code + '?'}
          description="The customer is told immediately. Choose how the payment is handled."
          cancelLabel="Keep order" confirmLabel="Cancel order" onConfirm={() => setDlg(null)}>
          <div style={{ display: 'grid', gap: 12 }}>
            <Select label="Reason" value="" placeholder="Choose a reason" onValueChange={() => {}} options={opts(['SUPPORT_CANCELLED', 'RESTAURANT_CLOSED', 'ITEM_UNAVAILABLE', 'PREP_OVERDUE', 'NO_RIDER_FOUND', 'FRAUD_SUSPECTED', 'PLATFORM_ERROR'])} />
            <Input label="What happened (10+ characters)" value="" onChange={() => {}} />
            <Input label="Support case" helperText="Required: every intervention links to a case." value="" placeholder="Case id" onChange={() => {}} />
            <Select label="If already captured, refund" value="FULL" onValueChange={() => {}} options={opts(['FULL', 'PARTIAL_ITEMS', 'FEES_ONLY', 'GOODWILL'])} helperText="Ignored before capture: the authorisation is voided." />
          </div>
        </Modal>
      </div>
    </Stateful>
  );
}

/* Refunds & disputes. The contract has no list-all-refunds operation: refunds are looked
   up per order (OrderAdminView.refunds) and issued with POST /v1/admin/refunds. */
function RefundsScreen({ state, variant = 'form' }) {
  const approval = variant === 'approval';
  const [confirm, setConfirm] = React.useState(false);
  return (
    <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 420px', gap: 'var(--space-5)', alignItems: 'start' }}>
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <Input label="Find the order" variant="search" placeholder="Order code, e.g. C3QQ" value="C3QQ" onChange={() => {}} style={{ maxWidth: 320 }} />
        <Stateful state={state} loading={<GapSkeleton rows={2} height={44} />}
          empty={<GapEmptyState icon="search" title="Look up an order to refund it" body="Refunds are issued against one order. There is no refund without an order." />}
          error={<GapErrorState title="Could not load that order" />}>
          <Card radius="lg" variant="outlined" style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><strong style={{ fontFamily: 'var(--font-mono)' }}>#C3QQ</strong><OrderStateBadge s="DISPUTED" /><span style={{ marginLeft: 'auto' }}><Price cents={1749} /></span></div>
            <DataTable caption="Refunds on order C3QQ" hideCaption density="compact" rowLabel={r => 'refund ' + r.id} rows={[{ id: ID.ref1, reason_code: 'HALAL_INTEGRITY', amount_cents: 1749, state: approval ? 'PENDING_APPROVAL' : 'REQUESTED' }]} columns={[
              { key: 'id', label: 'Refund', render: r => <ShortId id={r.id} /> },
              { key: 'reason_code', label: 'Reason', render: r => human(r.reason_code) },
              { key: 'state', label: 'Refund state', render: r => <RefundStateBadge s={r.state} /> },
              { key: 'amount_cents', label: 'Amount', align: 'end', render: r => <Price cents={r.amount_cents} size="sm" /> },
            ]} />
          </Card>
        </Stateful>
      </div>
      <Card radius="lg" variant="outlined" style={{ display: 'grid', gap: 12 }}>
        <h3 style={{ margin: 0, fontSize: 'var(--type-heading-md-size)', fontWeight: 600 }}>Issue a refund</h3>
        {approval && <GapBanner tone="warning" title="Needs a second approver">This amount is over your limit. It is sent for approval to a SUPER_ADMIN (required_role) and stays Needs approval until then.</GapBanner>}
        <Select label="Scope" value="FULL" onValueChange={() => {}} options={[{ value: 'FULL', label: 'Whole order' }, { value: 'PARTIAL_ITEMS', label: 'Selected items' }, { value: 'PARTIAL_AMOUNT', label: 'Part of the amount' }]} />
        <Select label="Reason" value="HALAL_INTEGRITY" onValueChange={() => {}} options={opts(['ITEM_MISSING', 'WRONG_ITEM', 'FOOD_QUALITY', 'FOOD_SAFETY', 'NEVER_DELIVERED', 'LATE_DELIVERY', 'DAMAGED_SPILLED', 'HALAL_CONCERN', 'HALAL_INTEGRITY', 'GOODWILL', 'DISPUTE_RESOLUTION', 'OTHER'])} />
        <Input label="Amount" variant="numeric" value="17.49" suffix={<span style={{ color: 'var(--text-tertiary)' }}>CAD</span>} helperText="The server checks it against what was captured and not yet refunded." onChange={() => {}} />
        <Input label="Support case" value="0192b3e0-7a1b-7c2d-9e3f-4a5b6c7d8e9f" onChange={() => {}} />
        <Input label="Note" value="Seal reported broken; photo on file." onChange={() => {}} />
        <Button size="lg" onPress={() => setConfirm(true)}>{approval ? 'Send for approval' : 'Issue refund'}</Button>
        <Modal contained open={confirm} variant="confirm" onClose={() => setConfirm(false)} title={approval ? 'Send this refund for approval?' : 'Issue this refund?'}
          description="Refund amounts are checked by the server against what was captured. The customer is told when it settles."
          confirmLabel={approval ? 'Send for approval' : 'Issue refund'} onConfirm={() => setConfirm(false)} />
      </Card>
    </div>
  );
}
Object.assign(window, { OrdersScreen, OrderDetailScreen, RefundsScreen });
