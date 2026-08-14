/**
 * Order detail + lifecycle actions — the heart of the fulfilment flow.
 *
 * Reads one order in the restaurant projection (`getRestaurantOrder`,
 * `GET /v1/restaurant/orders/{orderId}`, contract §R-23) and renders its lines, customer,
 * delivery and money decomposition. The action bar offers exactly the transitions the server
 * would honour for the current state (`availableActions`) — accept / reject / mark ready —
 * each posting to its transition endpoint with a client-generated `Idempotency-Key`.
 *
 * Every state is implemented: a `Skeleton` grid while loading, an `ErrorState` keyed off the
 * envelope's stable `error.code` (with retry) on failure, and — because a single order can
 * legitimately be gone — a 404 renders the "not found" empty affordance rather than an error.
 *
 * Money is rendered only through `Price`; cents are never formatted by hand.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { idempotencyKey, type operations } from '@hg/api-client';
import {
  Banner,
  Button,
  Card,
  ConfirmDialog,
  Divider,
  EmptyState,
  ErrorState,
  Price,
  Skeleton,
  StatusTimeline,
  ORDER_STATE_LABELS,
  formatAbsoluteDateTime,
  useToast,
  type ErrorStateCode,
} from '@hg/ui-web';

import { api } from '../lib/api';
import {
  availableActions,
  REJECT_OTHER_NOTE_MIN,
  REJECT_REASON_OPTIONS,
  type RejectReasonCode,
} from '../lib/orderActions';

type OrderResponse =
  operations['getRestaurantOrder']['responses']['200']['content']['application/json'];
type Order = OrderResponse['data'];

interface DetailError {
  code: ErrorStateCode | undefined;
  message: string | null;
  requestId: string | null;
  notFound: boolean;
}

interface DetailState {
  status: 'loading' | 'ready' | 'error';
  order: Order | null;
  error: DetailError | null;
}

const INITIAL: DetailState = { status: 'loading', order: null, error: null };

export function OrderDetailScreen() {
  const { orderId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [state, setState] = useState<DetailState>(INITIAL);
  const [acting, setActing] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, status: 'loading', error: null }));
    try {
      const { data, error, response } = await api.GET('/v1/restaurant/orders/{orderId}', {
        params: { path: { orderId } },
      });
      if (error || !data) {
        setState({
          status: 'error',
          order: null,
          error: {
            code: error?.error?.code as ErrorStateCode | undefined,
            message: error?.error?.message ?? `HTTP ${response.status}`,
            requestId: error?.error?.request_id ?? null,
            notFound: response.status === 404,
          },
        });
        return;
      }
      setState({ status: 'ready', order: data.data as Order, error: null });
    } catch (cause) {
      setState({
        status: 'error',
        order: null,
        error: {
          code: 'NETWORK_OFFLINE',
          message: cause instanceof Error ? cause.message : 'Network request failed',
          requestId: null,
          notFound: false,
        },
      });
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = useCallback(async () => {
    setActing(true);
    try {
      const { data, error, response } = await api.POST('/v1/restaurant/orders/{orderId}/accept', {
        params: {
          path: { orderId },
          header: { 'Idempotency-Key': idempotencyKey() },
        },
        body: {},
      });
      if (error || !data) {
        toast.show({
          variant: 'danger',
          title: 'Could not accept order',
          description: error?.error?.message ?? `HTTP ${response.status}`,
        });
        return;
      }
      setState((prev) => ({ ...prev, order: data.data as Order }));
      toast.show({ variant: 'info', title: 'Order accepted — now preparing' });
    } finally {
      setActing(false);
    }
  }, [orderId, toast]);

  const markReady = useCallback(async () => {
    setActing(true);
    try {
      const { data, error, response } = await api.POST('/v1/restaurant/orders/{orderId}/ready', {
        params: {
          path: { orderId },
          header: { 'Idempotency-Key': idempotencyKey() },
        },
      });
      if (error || !data) {
        toast.show({
          variant: 'danger',
          title: 'Could not mark ready',
          description: error?.error?.message ?? `HTTP ${response.status}`,
        });
        return;
      }
      setState((prev) => ({ ...prev, order: data.data as Order }));
      toast.show({ variant: 'info', title: 'Order ready for pickup' });
    } finally {
      setActing(false);
    }
  }, [orderId, toast]);

  const reject = useCallback(
    async (reasonCode: string | undefined, note: string | undefined) => {
      const { data, error, response } = await api.POST('/v1/restaurant/orders/{orderId}/reject', {
        params: {
          path: { orderId },
          header: { 'Idempotency-Key': idempotencyKey() },
        },
        body: {
          reason_code: reasonCode as RejectReasonCode,
          ...(note ? { note } : {}),
        },
      });
      if (error || !data) {
        // Thrown → ConfirmDialog keeps itself open with the inline error.
        throw new Error(error?.error?.message ?? `HTTP ${response.status}`);
      }
      setState((prev) => ({ ...prev, order: data.data as Order }));
      toast.show({ variant: 'info', title: 'Order rejected — authorisation voided' });
    },
    [orderId, toast],
  );

  const back = { label: 'Back to order queue', onPress: () => navigate('/') };

  if (state.status === 'loading') {
    return (
      <section className="rx-detail" aria-busy="true">
        <Skeleton height="1.75rem" width="14rem" />
        <div style={{ height: '1rem' }} />
        <Skeleton height="8rem" />
        <div style={{ height: '1rem' }} />
        <Skeleton height="12rem" />
      </section>
    );
  }

  if (state.status === 'error') {
    if (state.error?.notFound) {
      return (
        <section className="rx-detail">
          <EmptyState
            variant="page"
            title="Order not found"
            description="This order is no longer in your queue. It may have been completed, cancelled, or it belongs to another location."
            primaryAction={{ label: 'Back to order queue', onPress: () => navigate('/') }}
          />
        </section>
      );
    }
    return (
      <section className="rx-detail">
        <ErrorState
          variant="page"
          errorCode={state.error?.code}
          onRetry={() => void load()}
          technicalDetail={{
            requestId: state.error?.requestId,
            code: state.error?.code ?? null,
            message: state.error?.message,
          }}
        />
      </section>
    );
  }

  const order = state.order!;
  const actions = availableActions(order.state);
  const canAccept = actions.includes('accept');
  const canReject = actions.includes('reject');
  const canReady = actions.includes('ready');
  const itemCount = order.lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <section className="rx-detail">
      <header className="rx-detail-head">
        <button type="button" className="rx-back" onClick={back.onPress}>
          ← {back.label}
        </button>
        <h1 className="text-title-md text-fg-primary">{order.code}</h1>
        <p className="text-body-sm text-fg-secondary">
          {ORDER_STATE_LABELS[order.state] ?? order.state}
          {' · '}
          {itemCount} item{itemCount === 1 ? '' : 's'}
          {' · placed '}
          {formatAbsoluteDateTime(order.placed_at) ?? '—'}
        </p>
      </header>

      {order.is_late ? (
        <Banner
          variant="warning"
          title="Running late"
          description="This order has passed its promised ready time."
        />
      ) : null}

      {order.special_instructions ? (
        <Banner
          variant="info"
          title="Special instructions"
          description={order.special_instructions}
        />
      ) : null}

      <div className="rx-detail-grid">
        <Card variant="outlined" className="rx-card">
          <h2 className="text-heading-sm text-fg-primary">Items</h2>
          <Divider />
          <ul className="rx-lines">
            {order.lines.map((line) => (
              <li key={line.line_no} className="rx-line">
                <div className="rx-line-main">
                  <span className="rx-line-qty">{line.quantity}×</span>
                  <div>
                    <span className="text-body-md text-fg-primary">{line.name}</span>
                    {line.variant_name ? (
                      <span className="text-body-sm text-fg-secondary"> · {line.variant_name}</span>
                    ) : null}
                    {line.addons && line.addons.length > 0 ? (
                      <ul className="rx-addons">
                        {line.addons.map((addon) => (
                          <li key={addon.addon_id} className="text-body-sm text-fg-secondary">
                            + {addon.addon_quantity}× {addon.addon_name}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {line.special_request ? (
                      <p className="rx-line-note text-body-sm">“{line.special_request}”</p>
                    ) : null}
                  </div>
                </div>
                <Price cents={line.line_total_cents} size="sm" />
              </li>
            ))}
          </ul>
        </Card>

        <Card variant="outlined" className="rx-card">
          <h2 className="text-heading-sm text-fg-primary">Customer</h2>
          <Divider />
          <dl className="rx-kv">
            <dt>Name</dt>
            <dd>{order.customer.display_name}</dd>
            <dt>Phone</dt>
            <dd>{order.customer.phone_masked}</dd>
            <dt>Deliver to</dt>
            <dd>
              {order.delivery_address
                ? [
                    order.delivery_address.line1,
                    order.delivery_address.unit,
                    order.delivery_address.city,
                  ]
                    .filter(Boolean)
                    .join(', ')
                : `${order.delivery_area ?? '—'} (revealed after acceptance)`}
            </dd>
          </dl>

          <h2 className="text-heading-sm text-fg-primary rx-mt">Payout</h2>
          <Divider />
          <dl className="rx-money">
            <div>
              <dt>Subtotal</dt>
              <dd>
                <Price cents={order.money.subtotal_cents} size="sm" />
              </dd>
            </div>
            <div>
              <dt>Commission</dt>
              <dd>
                <Price cents={order.money.commission_cents} size="sm" />
              </dd>
            </div>
            <div className="rx-money-total">
              <dt>Your net payout</dt>
              <dd>
                <Price cents={order.money.restaurant_net_cents} size="md" />
              </dd>
            </div>
            <div className="rx-money-total">
              <dt>Order total</dt>
              <dd>
                <Price cents={order.money.total_cents} size="md" />
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card variant="filled" className="rx-card">
        <h2 className="text-heading-sm text-fg-primary">Progress</h2>
        <StatusTimeline
          orientation="horizontal"
          audience="restaurant"
          state={order.state}
          deadlineAt={order.promised_ready_at ?? order.deadline_at}
          label={`Order ${order.code} progress`}
        />
      </Card>

      {actions.length > 0 ? (
        <div className="rx-actions" role="group" aria-label="Order lifecycle actions">
          {canReject ? (
            <Button variant="danger" onPress={() => setRejectOpen(true)} disabled={acting}>
              Reject order
            </Button>
          ) : null}
          {canAccept ? (
            <Button variant="primary" onPress={() => void accept()} loading={acting}>
              Accept order
            </Button>
          ) : null}
          {canReady ? (
            <Button variant="primary" onPress={() => void markReady()} loading={acting}>
              Mark ready for pickup
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="rx-no-actions text-body-sm text-fg-secondary">
          No actions available in the {ORDER_STATE_LABELS[order.state] ?? order.state} state.
        </p>
      )}

      <ConfirmDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="Reject order"
        description="Rejecting voids the payment authorisation — nothing is captured and there is no refund. The customer is told immediately."
        confirmLabel="Reject order"
        destructive
        reasonCodes={REJECT_REASON_OPTIONS}
        reasonLabel="Reason for rejection"
        noteLabel="Note to the customer"
        noteMinLength={REJECT_OTHER_NOTE_MIN}
        onConfirm={(result) => reject(result.reasonCode, result.note)}
      />
    </section>
  );
}
