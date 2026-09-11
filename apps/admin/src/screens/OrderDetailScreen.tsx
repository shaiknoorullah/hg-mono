/**
 * `docs/design/admin-order-detail.md` — the full admin order-detail view.
 *
 * `GET /v1/admin/orders/{orderId}` (`operationId: getOrderAdmin`, A-38) is the single load:
 * header, parties, lines, the full money breakdown, payment + refund history, the
 * transition timeline and the dispatch history — the same read model the customer app
 * uses, so support and customer can never see contradictory states.
 *
 * Two columns on wide screens (left = live map + parties, right = timeline + money + items
 * + actions), per the design doc. Cancel and refund both go through the named admin actions
 * (`cancelOrderAdmin`, `issueRefund`) — **no direct writes to `order.state`** (P-14).
 *
 * The live-map box reads `restaurant_location` / `destination_location` / `rider_location`
 * directly off `OrderAdminView` (widened alongside `getOrderTracking`'s customer-scoped
 * shape — admin is not subject to the customer's PICKED_UP/ARRIVED rider-visibility gate).
 * A rider pin is absent, honestly, until a rider is assigned and has reported a position —
 * never a fabricated one.
 */
import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Schema } from '@hg/api-client';
import { HgApiError, cents, isApiError } from '@hg/api-client';
import {
  Banner,
  Button,
  Card,
  Chip,
  ConfirmDialog,
  ErrorState,
  Icon,
  Input,
  Select,
  Skeleton,
  StatusTimeline,
  Textarea,
  useToast,
} from '@hg/ui-web';

import { api } from '../lib/api.js';
import { toAsyncError, unwrap, useLoad } from '../lib/load.js';
import { formatCountdown, formatMoney, formatTimestamp, enumLabel } from '../lib/format.js';
import { LiveMapBox, type MapPin } from '../components/LiveMapBox.js';

type OrderAdminView = Schema['OrderAdminView'];

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="adm-kv">
      <dt className="text-label-sm text-fg-secondary">{label}</dt>
      <dd className="text-body-md text-fg-primary">{value}</dd>
    </div>
  );
}

const CANCEL_REASONS = [
  { value: 'CUSTOMER_CANCELLED', label: 'Customer cancelled' },
  { value: 'RESTAURANT_CLOSED', label: 'Restaurant closed' },
  { value: 'ITEM_UNAVAILABLE', label: 'Item unavailable' },
  { value: 'NO_RIDER_FOUND', label: 'No rider found' },
  { value: 'SUPPORT_CANCELLED', label: 'Support cancelled' },
  { value: 'FRAUD_SUSPECTED', label: 'Fraud suspected' },
  { value: 'PLATFORM_ERROR', label: 'Platform error' },
] as const;

const REFUND_REASONS = [
  { value: 'RESTAURANT_REJECTED', label: 'Restaurant rejected' },
  { value: 'MISSING_ITEMS', label: 'Missing items' },
  { value: 'WRONG_ITEMS', label: 'Wrong items' },
  { value: 'FOOD_QUALITY', label: 'Food quality' },
  { value: 'NEVER_DELIVERED', label: 'Never delivered' },
  { value: 'LATE_DELIVERY', label: 'Late delivery' },
  { value: 'HALAL_CONCERN', label: 'Halal concern' },
  { value: 'GOODWILL', label: 'Goodwill' },
  { value: 'DISPUTE_RESOLUTION', label: 'Dispute resolution' },
  { value: 'OTHER', label: 'Other' },
] as const;

const REFUND_SCOPES = [
  { value: 'FULL', label: 'Full refund' },
  { value: 'PARTIAL_ITEMS', label: 'Partial — items' },
  { value: 'PARTIAL_AMOUNT', label: 'Partial — amount (goodwill only)' },
] as const;

export function OrderDetailScreen() {
  const { orderId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const fetcher = useCallback(
    async () =>
      (await unwrap(api.GET('/v1/admin/orders/{orderId}', { params: { path: { orderId } } }))).data as OrderAdminView,
    [orderId],
  );
  const { status, data, error, reload } = useLoad(fetcher);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [caseId, setCaseId] = useState('');
  const [refundScope, setRefundScope] = useState<string>('FULL');
  const [refundReason, setRefundReason] = useState<string>('RESTAURANT_REJECTED');
  const [refundNote, setRefundNote] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundBusy, setRefundBusy] = useState(false);

  const submitRefund = useCallback(async () => {
    if (!data) return;
    setRefundBusy(true);
    try {
      const body: Schema['AdminRefundInput'] = {
        order_id: data.id,
        scope: refundScope as Schema['AdminRefundInput']['scope'],
        reason_code: refundReason as Schema['AdminRefundInput']['reason_code'],
        reason_text: refundNote,
        ...(refundReason === 'GOODWILL' && refundScope === 'PARTIAL_AMOUNT' && refundAmount
          ? { amount_cents: cents(Math.round(Number(refundAmount) * 100)) }
          : {}),
      };
      const { data: resp, error: err, response } = await api.POST('/v1/admin/refunds', {
        params: { header: { 'Idempotency-Key': newIdempotencyKey() } },
        body,
      });
      if (err || !resp) throw new HgApiError(response.status, err as never);
      if (response.status === 202) {
        toast.show({
          variant: 'warning',
          title: 'Above your authority cap',
          description: 'An approval request was created and escalated. No refund exists yet.',
        });
      } else {
        toast.show({ variant: 'success', title: 'Refund authorised and submitted' });
      }
      setRefundOpen(false);
      reload();
    } catch (err) {
      toast.show({ variant: 'danger', title: 'Refund failed', description: toAsyncError(err).message });
      throw err;
    } finally {
      setRefundBusy(false);
    }
  }, [data, refundScope, refundReason, refundNote, refundAmount, toast, reload]);

  if (status === 'loading') {
    return (
      <div className="adm-stack" aria-busy="true" aria-label="Loading order">
        <Skeleton width="40%" height={32} />
        <Skeleton height={280} />
        <Skeleton height={200} />
      </div>
    );
  }

  if (status === 'error') {
    return <ErrorState variant="page" errorCode={error.code} description={error.message} onRetry={reload} />;
  }

  if (!data) return null;

  const pins: MapPin[] = [];
  if (data.delivery_address?.latitude != null && data.delivery_address?.longitude != null) {
    pins.push({
      kind: 'customer',
      label: 'Delivery address',
      latitude: data.delivery_address.latitude,
      longitude: data.delivery_address.longitude,
    });
  } else if (data.destination_location) {
    pins.push({
      kind: 'customer',
      label: 'Delivery address',
      latitude: data.destination_location.latitude,
      longitude: data.destination_location.longitude,
    });
  }
  if (data.restaurant_location) {
    pins.push({
      kind: 'restaurant',
      label: data.restaurant?.name ?? 'Restaurant',
      latitude: data.restaurant_location.latitude,
      longitude: data.restaurant_location.longitude,
    });
  }
  if (data.rider_location) {
    pins.push({
      kind: 'rider',
      label: 'Rider (live)',
      latitude: data.rider_location.latitude,
      longitude: data.rider_location.longitude,
    });
  }
  const missingLabel =
    data.restaurant_location || data.rider_location
      ? null
      : 'No live rider position yet — a rider has not been assigned or has not reported a location.';

  return (
    <section aria-labelledby="order-heading" className="adm-stack">
      <Button variant="tertiary" size="sm" iconStart={<Icon name="back" size={16} />} onPress={() => navigate('/orders')}>
        Back to orders
      </Button>

      <header className="adm-stack" style={{ gap: 'var(--hg-space-1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--hg-space-3)' }}>
          <h1 id="order-heading" className="text-title-md text-fg-primary">
            {data.code}
          </h1>
          <Chip label={data.state} tone="neutral" />
          {data.dispatch_state ? <Chip label={enumLabel(data.dispatch_state)} tone="neutral" /> : null}
        </div>
        <p className="text-body-md text-fg-secondary">
          Placed {formatTimestamp(data.placed_at)}
          {data.deadline_at ? ` · deadline ${formatCountdown(data.deadline_at)}` : ''}
        </p>
      </header>

      <div className="adm-order-layout">
        <div className="adm-stack">
          <LiveMapBox
            pins={pins}
            etaLabel={data.eta_at ? `ETA ${formatTimestamp(data.eta_at)}` : null}
            countdownLabel={data.deadline_at ? formatCountdown(data.deadline_at) : null}
            missingLabel={missingLabel}
          />

          <Card header={<h2 className="text-heading-sm text-fg-primary">Customer</h2>}>
            <div className="adm-party-card">
              <p className="text-body-md text-fg-primary">
                {data.delivery_address ? `${data.delivery_address.city}, ${data.delivery_address.province}` : 'No address on file'}
              </p>
              <p className="text-body-sm text-fg-secondary">
                {data.delivery_address
                  ? [data.delivery_address.line1, data.delivery_address.unit].filter(Boolean).join(', ')
                  : '—'}
              </p>
            </div>
          </Card>

          <Card header={<h2 className="text-heading-sm text-fg-primary">Restaurant</h2>}>
            <div className="adm-party-card">
              <p className="text-body-md text-fg-primary">{data.restaurant.name}</p>
              {data.restaurant.halal ? (
                <Chip label={enumLabel(data.restaurant.halal.display_state ?? 'UNKNOWN')} tone="neutral" />
              ) : (
                <p className="text-body-sm text-fg-secondary">No halal badge on this projection (silence is never consent).</p>
              )}
            </div>
          </Card>

          <Card header={<h2 className="text-heading-sm text-fg-primary">Rider</h2>}>
            {data.rider ? (
              <div className="adm-party-card">
                <p className="text-body-md text-fg-primary">
                  {data.rider.first_name} {data.rider.last_initial}.
                </p>
                <p className="text-body-sm text-fg-secondary">{enumLabel(data.rider.vehicle_type)}</p>
              </div>
            ) : (
              <p className="text-body-sm text-fg-secondary">No rider assigned yet.</p>
            )}
          </Card>
        </div>

        <div className="adm-stack">
          <Card header={<h2 className="text-heading-sm text-fg-primary">Timeline</h2>}>
            <StatusTimeline
              state={data.state}
              audience="admin"
              transitions={data.timeline?.map((t) => ({ state: t.to_state, at: t.at }))}
              deadlineAt={data.deadline_at}
            />
          </Card>

          <Card header={<h2 className="text-heading-sm text-fg-primary">Items</h2>}>
            <ul className="adm-stack" style={{ gap: 'var(--hg-space-2)', margin: 0, padding: 0, listStyle: 'none' }}>
              {data.lines.map((line) => (
                <li key={line.line_no} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="text-body-md text-fg-primary">
                    {line.quantity} × {line.name}
                  </span>
                  <span className="text-body-md text-fg-primary tabular-nums">{formatMoney(line.line_total_cents)}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card header={<h2 className="text-heading-sm text-fg-primary">Money</h2>}>
            <dl className="adm-kv-grid">
              <DetailRow label="Subtotal" value={formatMoney(data.money.subtotal_cents)} />
              <DetailRow label="Delivery" value={formatMoney(data.money.delivery_fee_cents)} />
              <DetailRow label="Service" value={formatMoney(data.money.service_fee_cents)} />
              <DetailRow label="Tax" value={formatMoney(data.money.tax_total_cents)} />
              <DetailRow label="Tip" value={formatMoney(data.money.tip_cents)} />
              <DetailRow label="Total" value={<strong>{formatMoney(data.money.total_cents)}</strong>} />
              <DetailRow label="Payment state" value={data.payment.state} />
              <DetailRow label="Captured" value={formatMoney(data.payment.amount_captured_cents)} />
              <DetailRow label="Refunded" value={formatMoney(data.payment.amount_refunded_cents)} />
              <DetailRow
                label="Ledger residual"
                value={
                  data.internal_money.ledger_residual_cents != null
                    ? formatMoney(data.internal_money.ledger_residual_cents)
                    : '—'
                }
              />
            </dl>
          </Card>

          {data.refunds.length > 0 ? (
            <Card header={<h2 className="text-heading-sm text-fg-primary">Refunds</h2>}>
              <ul className="adm-stack" style={{ gap: 'var(--hg-space-2)', margin: 0, padding: 0, listStyle: 'none' }}>
                {data.refunds.map((r) => (
                  <li key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="text-body-md text-fg-primary">
                      {enumLabel(r.reason_code)} · {formatMoney(r.amount_cents)}
                    </span>
                    <Chip label={r.state} tone={r.state === 'FAILED' || r.state === 'DECLINED' ? 'warning' : 'neutral'} />
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card header={<h2 className="text-heading-sm text-fg-primary">Actions</h2>}>
            <p className="text-body-sm text-fg-secondary mb-3">
              Every action here is audited. Cancellation after restaurant acceptance must go
              through a refund in the same transaction — support agents may cancel only before
              acceptance (A-38 / T11 / T13).
            </p>
            <div className="adm-form-actions">
              <Button variant="secondary" iconStart={<Icon name="close" size={18} />} onPress={() => setCancelOpen(true)}>
                Cancel order
              </Button>
              <Button variant="secondary" iconStart={<Icon name="clock" size={18} />} onPress={() => setRefundOpen(true)}>
                Issue refund
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel order"
        description="Cancelling before acceptance voids the authorisation; after acceptance, a refund is issued in the same transaction. This requires a linked support case ID."
        confirmLabel="Cancel order"
        destructive
        reasonCodes={CANCEL_REASONS}
        noteLabel="Reason detail (sent to no one outside support)"
        noteMinLength={10}
        noteRequired
        onConfirm={async ({ reasonCode, note }) => {
          if (!caseId.trim()) {
            throw new Error('A support case ID is required to link this cancellation.');
          }
          await unwrap(
            api.POST('/v1/admin/orders/{orderId}/cancel', {
              params: { path: { orderId }, header: { 'Idempotency-Key': newIdempotencyKey() } },
              body: {
                reason_code: (reasonCode ?? 'SUPPORT_CANCELLED') as Schema['AdminOrderCancellationInput']['reason_code'],
                reason_text: note ?? '',
                case_id: caseId.trim(),
              },
            }),
          );
          toast.show({ variant: 'success', title: 'Order cancelled' });
          reload();
        }}
      />

      {cancelOpen ? (
        <Card variant="outlined" header={<h3 className="text-heading-sm text-fg-primary">Linked case</h3>}>
          <Input
            label="Support case ID"
            helperText="Every intervention requires a linked case — there are no context-free order mutations."
            value={caseId}
            onChange={(v) => setCaseId(v)}
          />
        </Card>
      ) : null}

      {refundOpen ? (
        <Card variant="outlined" header={<h3 className="text-heading-sm text-fg-primary">Issue refund</h3>}>
          <div className="adm-form-grid">
            <Select label="Scope" options={REFUND_SCOPES} value={refundScope} onChange={setRefundScope} />
            <Select label="Reason" options={REFUND_REASONS} value={refundReason} onChange={setRefundReason} />
            {refundReason === 'GOODWILL' && refundScope === 'PARTIAL_AMOUNT' ? (
              <Input
                label="Amount (CAD)"
                helperText="The only monetary field a staff route accepts, and only here (G-3)."
                value={refundAmount}
                onChange={setRefundAmount}
              />
            ) : null}
          </div>
          <Textarea
            label="Reason detail"
            helperText="10–1000 characters."
            value={refundNote}
            onChange={(v) => setRefundNote(v)}
          />
          <div className="adm-form-actions mt-3">
            <Button variant="primary" onPress={() => void submitRefund()} disabled={refundBusy || refundNote.trim().length < 10}>
              {refundBusy ? 'Submitting…' : 'Submit refund'}
            </Button>
            <Button variant="tertiary" onPress={() => setRefundOpen(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {status === 'ready' && data.state === 'DISPUTED' ? (
        <Banner
          variant="warning"
          emphasis="prominent"
          title="Order is in dispute"
          description="DISPUTED is non-terminal. Resolve through a refund decision or escalate — there is no direct write to order.state from this screen."
        />
      ) : null}
    </section>
  );
}
