/**
 * The order page's sections, each a pure view of `OrderAdminView`: whatever the server sent, as
 * sent. Money is drawn through `Price` (integer cents) and never recomputed here; the ledger's
 * balance is the server's `ledger_residual_cents`, never a sum made on this page.
 */
import type { Schema } from '@hg/api-client';

import { formatFullDateTime, formatLongDate, formatShortDateTime, formatTime } from '../../data/format';
import { Badge, Button, DataGrid, InlineAlert, KeyValueList, Price, StatCard, StatusTimeline, type DataGridColumn } from '../../ds';
import { DeadlineCell, HalalCell, StateBadge } from '../cells';
import {
  ACTOR,
  CHARGEBACK_STATUS,
  DISPATCH_STATE,
  LEDGER_ACCOUNT,
  LEDGER_BATCH_KIND,
  LEDGER_COMPONENT,
  MONEY_EVENT,
  NO_DISPATCH,
  ORDER_STATE,
  PAYMENT_STATE,
  REFUND_STATE,
} from '../labels';
import { deadlineNote, isHeldByFailedRefund, leaveItNote } from './notes';
import { offersLiveMap, riderOf } from './liveMapModel';

type Order = Schema['OrderAdminView'];
type Refund = Schema['Refund'];
type Chargeback = Schema['Chargeback'];
type LedgerEntry = Schema['LedgerEntry'];

const H3 = 'text-heading-sm text-fg-primary';

export function OrderHeader({ order }: { order: Order }) {
  return (
    <header className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="order-heading" tabIndex={-1} className="text-heading-md font-mono text-fg-primary">
          {order.code}
        </h2>
        <StateBadge state={order.state} size="lg" />
      </div>
      <p className="text-body-md text-fg-primary">{order.restaurant.name}</p>
      <p className="flex flex-wrap items-center gap-2 text-body-sm text-fg-secondary">
        <span>Restaurant halal status now</span>
        <HalalCell halal={order.restaurant.halal} where="detail" />
        <span>The restaurant's status today. It does not describe this order.</span>
      </p>
      <p className="text-body-sm text-fg-secondary">
        Placed {formatLongDate(order.placed_at)} at {formatTime(order.placed_at)} · id {order.id.slice(0, 8)}…{order.id.slice(-4)}
      </p>
    </header>
  );
}

export function DeadlineBlock({ order }: { order: Order }) {
  const note = deadlineNote(order);
  const leave = leaveItNote(order.state);
  return (
    <section aria-labelledby="deadline-heading" className="flex flex-col gap-2 rounded-md border border-line-decorative p-4">
      <h3 id="deadline-heading" className={H3}>
        Deadline
      </h3>
      <div className="flex flex-wrap items-center gap-3">
        <StateBadge state={order.state} size="sm" />
        {order.deadline_at ? <DeadlineCell state={order.state} deadlineAt={order.deadline_at} since={order.state_since} note="" /> : null}
      </div>
      {note ? <p className="text-body-md text-fg-secondary">{note}</p> : null}
      {leave ? <p className="text-body-md text-fg-secondary">{leave}</p> : null}
      {order.eta_at ? <p className="text-body-sm text-fg-secondary">Delivery estimate {formatTime(order.eta_at)}.</p> : null}
    </section>
  );
}

export function DisputeNote({ order }: { order: Order }) {
  if (order.state !== 'DISPUTED') return null;
  return (
    <InlineAlert tone="warning" title="This order is disputed">
      Refunding doesn't close the dispute. It still escalates at its deadline and, after the third, resolves automatically in the customer's favour. Check the refunds already on this order first.
    </InlineAlert>
  );
}

/** Raised whenever the server reports a ledger that does not sum to zero. */
export function ResidualAlert({ order }: { order: Order }) {
  const residual = order.internal_money.ledger_residual_cents;
  if (!residual) return null;
  return (
    <InlineAlert tone="danger" blocking title="Incident: this order's ledger doesn't balance">
      It is off by <Price cents={residual} size="sm" />. Every finished order must add up to zero. Check with finance before refunding. The ledger is under More detail.
    </InlineAlert>
  );
}

export function ChargebackBlock({ order }: { order: Order }) {
  if (order.chargebacks.length === 0) return null;
  return (
    <section aria-labelledby="chargeback-heading" className="flex flex-col gap-3">
      <h3 id="chargeback-heading" className={H3}>
        Card chargeback on this order
      </h3>
      <p className="text-body-sm text-fg-secondary">
        This is the card network’s dispute, not a customer dispute on the platform. The server holds the restaurant’s and rider’s next payouts up to the disputed amount and gathers the evidence. The order itself keeps its state.
      </p>
      {order.chargebacks.map((cb: Chargeback) => (
        <KeyValueList
          key={cb.id}
          items={[
            { label: 'Status', value: <Badge variant="warning" size="sm">{CHARGEBACK_STATUS[cb.status]}</Badge> },
            { label: 'Disputed amount', value: <Price cents={cb.amount_cents} size="sm" /> },
            { label: 'Reason', value: cb.reason },
            { label: 'Evidence due by', value: cb.evidence_due_at ? formatFullDateTime(cb.evidence_due_at) : null },
            { label: 'Evidence sent', value: cb.evidence_submitted_at ? formatFullDateTime(cb.evidence_submitted_at) : 'Not yet' },
            { label: 'Outcome', value: cb.outcome ? CHARGEBACK_STATUS[cb.outcome] : 'Open' },
            { label: 'Provider dispute id', value: cb.stripe_dispute_id, mono: true },
          ]}
        />
      ))}
    </section>
  );
}

export function RefundRows({ order }: { order: Order }) {
  const held = isHeldByFailedRefund(order);
  return (
    <section aria-labelledby="refunds-heading" className="flex flex-col gap-3">
      <h3 id="refunds-heading" className={H3}>
        Refunds
      </h3>
      {order.refunds.some((r) => r.state === 'FAILED') ? (
        <InlineAlert tone="danger" blocking title="A refund failed. No money moved.">
          The customer still sees “Refund in progress”.{held ? ' Settlement is held until a new refund succeeds.' : ''}
        </InlineAlert>
      ) : null}
      {order.refunds.length === 0 ? (
        <p className="text-body-md text-fg-secondary">No refunds issued.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {order.refunds.map((r: Refund) => {
            const s = REFUND_STATE[r.state];
            return (
              <li key={r.id} className="flex flex-col gap-1 rounded-md border border-line-decorative p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Price cents={r.amount_cents} size="md" />
                  <Badge variant={s.tone} icon={s.icon} size="sm">
                    {s.label}
                  </Badge>
                </div>
                <p className="text-body-sm text-fg-secondary">
                  Requested {formatShortDateTime(r.requested_at)}
                  {r.settled_at ? ` · settled ${formatShortDateTime(r.settled_at)}` : ''}
                  {r.failure_message ? ` · “${r.failure_message}”` : ''}
                </p>
                {r.note ? <p className="text-body-sm text-fg-secondary">{r.note}</p> : null}
                {r.liability_split ? (
                  <p className="text-body-sm text-fg-secondary">
                    Who bears it: restaurant <Price cents={r.liability_split.restaurant_cents} size="sm" />, platform{' '}
                    <Price cents={r.liability_split.platform_cents} size="sm" />, rider <Price cents={r.liability_split.rider_cents} size="sm" />
                  </p>
                ) : (
                  <p className="text-body-sm text-fg-secondary">Who bears it is set when the refund is authorised.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function PaymentBlock({ order }: { order: Order }) {
  const p = order.payment;
  const s = PAYMENT_STATE[p.state];
  return (
    <section aria-labelledby="payment-heading" className="flex flex-col gap-3">
      <h3 id="payment-heading" className={H3}>
        Payment
      </h3>
      <Badge variant={s.tone} icon={s.icon} size="md">
        {s.label}
      </Badge>
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Authorised" value={<Price cents={p.amount_authorized_cents} size="md" />} />
        <StatCard label="Captured" value={<Price cents={p.amount_captured_cents} size="md" />} />
        <StatCard label="Refunded" value={<Price cents={p.amount_refunded_cents} size="md" />} />
      </div>
      <KeyValueList
        dense
        items={[
          { label: 'Card', value: p.card_brand ? `${p.card_brand}${p.card_last4 ? ` ending ${p.card_last4}` : ''}${p.wallet ? ` (${p.wallet})` : ''}` : null },
          { label: 'Authorised', value: p.authorized_at ? formatShortDateTime(p.authorized_at) : null },
          { label: 'Captured', value: p.captured_at ? formatShortDateTime(p.captured_at) : null },
          { label: 'Failure', value: p.failure_code },
          { label: 'Decline reason', value: p.decline_code },
        ].filter((i) => i.value !== null && i.value !== undefined)}
      />
    </section>
  );
}

export function ItemsAndMoney({ order }: { order: Order }) {
  const m = order.money;
  return (
    <section aria-labelledby="money-heading" className="flex flex-col gap-3">
      <h3 id="money-heading" className={H3}>
        Items and money
      </h3>
      <ul className="flex flex-col gap-1">
        {order.lines.map((l) => (
          <li key={l.line_no} className="flex items-start justify-between gap-3 text-body-md">
            <span>
              {l.quantity} × {l.name}
              {l.variants.length > 0 ? <span className="text-fg-secondary"> · {l.variants.map((v) => v.variant_name).join(', ')}</span> : null}
              {l.special_request ? <span className="block text-body-sm text-fg-secondary">“{l.special_request}”</span> : null}
            </span>
            <Price cents={l.line_total_cents} size="sm" />
          </li>
        ))}
      </ul>
      <KeyValueList
        dense
        items={[
          { label: 'Subtotal', value: <Price cents={m.subtotal_cents} size="sm" /> },
          ...(m.discount_cents ? [{ label: 'Discount', value: <Price cents={-m.discount_cents} size="sm" /> }] : []),
          { label: 'Delivery fee', value: <Price cents={m.delivery_fee_cents} size="sm" /> },
          { label: 'Service fee', value: <Price cents={m.service_fee_cents} size="sm" /> },
          ...(m.tax_lines ?? []).map((t) => ({ label: t.statutory_label, value: <Price cents={t.amount_cents} size="sm" /> })),
          { label: 'Tip', value: <Price cents={m.tip_cents} size="sm" /> },
          { label: 'Order total', value: <Price cents={m.total_cents} size="md" /> },
        ]}
      />
      <p className="text-body-sm text-fg-secondary">As quoted when the order was placed.</p>
    </section>
  );
}

export function PeopleAndPlace({
  order,
  onReveal,
}: {
  order: Order;
  onReveal: (() => void) | null;
}) {
  const a = order.delivery_address;
  const revealed = order.pii_revealed === true;
  const dispatch = order.dispatch_state ? DISPATCH_STATE[order.dispatch_state] : NO_DISPATCH;
  const rider = order.rider ? `${order.rider.first_name} ${order.rider.last_initial}.` : null;
  return (
    <section aria-labelledby="place-heading" className="flex flex-col gap-3">
      <h3 id="place-heading" className={H3}>
        People and place
      </h3>
      <KeyValueList
        dense
        items={[
          { label: 'Restaurant', value: order.restaurant.name },
          { label: 'Dispatch', value: dispatch },
          { label: 'Rider', value: rider, },
          {
            // While the address is masked NO destination is drawn at all, not even a partial one.
            label: 'Delivery address',
            value: revealed && a ? (
              <span className="flex flex-col">
                <span>
                  {[a.unit ? `Unit ${a.unit}` : null, a.line1, a.line2].filter(Boolean).join(', ')}
                </span>
                <span>
                  {a.city}, {a.province} {a.postal_code}
                </span>
                {a.buzzer ? <span className="text-body-sm text-fg-secondary">Buzzer {a.buzzer}</span> : null}
              </span>
            ) : (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-fg-secondary">Masked. Revealing needs a reason and is logged.</span>
                {onReveal ? (
                  <Button variant="secondary" size="sm" onPress={onReveal}>
                    Reveal address…
                  </Button>
                ) : null}
              </span>
            ),
          },
          ...(revealed && a?.delivery_notes ? [{ label: 'Drop-off', value: a.delivery_notes }] : []),
          ...(order.special_instructions ? [{ label: 'Special request', value: order.special_instructions }] : []),
        ]}
      />
      {revealed ? <p className="text-body-sm text-fg-secondary">Delivery address revealed for this view. Your reason is logged.</p> : null}
    </section>
  );
}

/**
 * "Where things are": the live map's door and its words (`ORD/OrderDetail`). The words are the
 * same facts the map pane draws, so the order is locatable here without opening a map. The
 * 180 px mini map the board draws in this section is not built; see the live map pane's comment.
 */
export function WhereThingsAre({ order, onOpenMap }: { order: Order; onOpenMap: () => void }) {
  const seen = riderOf(order, Date.now(), null);
  const destination = order.pii_revealed ? 'the address is revealed on this order' : 'hidden until you reveal the address';
  return (
    <section aria-labelledby="where-heading" className="flex flex-col gap-2 border-t border-line-decorative pt-3">
      <div className="flex items-center gap-2">
        <h3 id="where-heading" className="m-0 flex-1 text-label-lg font-semibold text-fg-primary">
          Where things are
        </h3>
        {offersLiveMap(order) ? (
          <Button variant="ghost" iconStart="map" onPress={onOpenMap}>
            Live map
          </Button>
        ) : null}
      </div>
      <p className="text-body-sm text-fg-primary">
        Restaurant: {order.restaurant.name}. Destination: {destination}. Rider: {order.rider ? seen.sentence : 'no rider yet'}
      </p>
    </section>
  );
}

/* ── More detail ────────────────────────────────────────────────────────────────────────── */

export function TimelineBlock({ order }: { order: Order }) {
  return (
    <section aria-labelledby="timeline-heading" className="flex flex-col gap-2">
      <h3 id="timeline-heading" className={H3}>
        Timeline
      </h3>
      <StatusTimeline
        audience="admin"
        state={order.state}
        transitions={order.timeline.map((t) => ({ to_state: t.to_state, from_state: t.from_state ?? null, at: t.at }))}
        orientation="vertical"
        showTimes
        deadlineAt={order.deadline_at ?? null}
      />
      <ul className="flex flex-col gap-1 text-body-sm text-fg-secondary">
        {order.timeline.map((t, i) => (
          <li key={`${t.at}-${i}`}>
            {formatShortDateTime(t.at)} · {ORDER_STATE[t.to_state].label} · {ACTOR[t.actor_kind]}
            {t.reason ? ` · ${t.reason}` : ''}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function EventLog({ order }: { order: Order }) {
  if (order.money_timeline.length === 0) return null;
  return (
    <section aria-labelledby="events-heading" className="flex flex-col gap-2">
      <h3 id="events-heading" className={H3}>
        Money events
      </h3>
      <ul className="flex flex-col gap-1 text-body-sm">
        {order.money_timeline.map((e, i) => (
          <li key={`${e.at}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-fg-secondary">{formatShortDateTime(e.at)}</span>
            <span className="text-fg-primary">{MONEY_EVENT[e.kind]}</span>
            {e.amount_cents != null ? <Price cents={e.amount_cents} size="sm" /> : null}
            <span className="text-fg-secondary">{ACTOR[e.actor_kind === 'ACCOUNT' ? 'ADMIN' : 'SYSTEM']}</span>
            {e.reason ? <span className="text-fg-secondary">· {e.reason}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LedgerBlock({ order }: { order: Order }) {
  const m = order.internal_money;
  const entries = m.ledger_entries ?? [];
  const columns: DataGridColumn<LedgerEntry>[] = [
    { key: 'batch', header: 'Batch', width: 120, render: (e) => (e.batch_kind ? LEDGER_BATCH_KIND[e.batch_kind] : '') },
    { key: 'account', header: 'Account', width: 200, render: (e) => LEDGER_ACCOUNT[e.account] },
    { key: 'component', header: 'Component', width: 180, render: (e) => LEDGER_COMPONENT[e.component] },
    { key: 'amount', header: 'Amount', width: 96, align: 'end', render: (e) => <Price cents={e.amount_cents} size="sm" sign="always" /> },
    { key: 'posted', header: 'Posted', render: (e) => formatShortDateTime(e.posted_at) },
  ];
  return (
    <section aria-labelledby="ledger-heading" className="flex flex-col gap-3">
      <h3 id="ledger-heading" className={H3}>
        Internal split and ledger
      </h3>
      <Badge variant="outline" size="sm">
        Staff only
      </Badge>
      <KeyValueList
        dense
        items={[
          { label: 'Commission', value: <Price cents={m.commission_cents} size="sm" /> },
          { label: 'Restaurant net', value: <Price cents={m.restaurant_net_cents} size="sm" /> },
          { label: 'Rider earnings', value: <Price cents={m.rider_earnings_cents} size="sm" /> },
          { label: 'Platform gross', value: <Price cents={m.platform_gross_cents} size="sm" /> },
          {
            label: 'Ledger balances',
            value:
              m.ledger_residual_cents === undefined || m.ledger_residual_cents === null ? (
                'Balance not returned'
              ) : m.ledger_residual_cents === 0 ? (
                'Yes. Checked by the server.'
              ) : (
                <span>
                  Ledger off by <Price cents={m.ledger_residual_cents} size="sm" />
                </span>
              ),
          },
        ]}
      />
      {entries.length === 0 ? (
        <p className="text-body-sm text-fg-secondary">Set when the restaurant accepts. There is no split yet, so no balance is claimed.</p>
      ) : (
        <div className="max-h-[320px] overflow-hidden rounded-md border border-line-decorative">
          <DataGrid<LedgerEntry>
            label="Ledger entries"
            columns={columns}
            rows={entries}
            getRowId={(e) => `${e.batch_id ?? 'b'}-${e.account}-${e.component}-${e.posted_at}-${e.amount_cents}`}
            rowLabel={(e) => `${LEDGER_ACCOUNT[e.account]}, ${LEDGER_COMPONENT[e.component]}`}
            footerSlot={<span />}
          />
        </div>
      )}
    </section>
  );
}
