import { useState } from 'react';
import type { Schema } from '@hg/api-client';
import { api, unwrapOrThrow } from '../lib/apiHelpers';
import { useAsync } from '../lib/useAsync';
import { Button, Card, Chip, EmptyState, ErrorState, PageLoading } from '../components/primitives';
import { DeadlineTimer } from '../components/DeadlineTimer';
import { IconQueue, IconCheck, IconClose } from '../lib/icons';
import { RejectDialog, type RejectableOrder } from '../components/RejectDialog';
import { idempotencyKey, isApiError } from '@hg/api-client';

const STATE_LABEL: Partial<Record<Schema['OrderState'], string>> = {
  RESTAURANT_PENDING: 'Awaiting response',
  PREPARING: 'Preparing',
  READY_FOR_PICKUP: 'Ready for pickup',
  PICKED_UP: 'Picked up',
};

/**
 * Formats a `Cents` amount for display. Deliberately takes `number` rather than the
 * branded `Cents` type: values read back through `unwrapOrThrow`/openapi-fetch lose the
 * brand's `number` intersection member (a `Readable<>`-style prettifying mapped type
 * flattens `number & {brand}` into a bare object shape) even though they are, at runtime,
 * still plain numbers. `Number()` is a no-op here and sidesteps that entirely.
 */
function money(value: unknown) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(Number(value) / 100);
}

export function OrdersPage() {
  const { status, data, error, reload } = useAsync(
    () =>
      unwrapOrThrow(
        api.GET('/v1/restaurant/orders', {
          params: { query: { state: ['RESTAURANT_PENDING', 'PREPARING', 'READY_FOR_PICKUP'] } },
        }),
      ),
    [],
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<RejectableOrder | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (status === 'loading') return <PageLoading label="Loading the order queue…" />;
  if (status === 'error') {
    return (
      <div className="p-6">
        <ErrorState description={error ?? undefined} onRetry={reload} />
      </div>
    );
  }

  const orders = data ?? [];
  const pending = orders.filter((o) => o.state === 'RESTAURANT_PENDING').sort((a, b) => (a.deadline_at ?? '').localeCompare(b.deadline_at ?? ''));
  const inKitchen = orders.filter((o) => o.state !== 'RESTAURANT_PENDING');

  async function accept(order: { id: string }) {
    setBusyId(order.id);
    setActionError(null);
    try {
      await unwrapOrThrow(
        api.POST('/v1/restaurant/orders/{orderId}/accept', {
          params: { path: { orderId: order.id }, header: { 'Idempotency-Key': idempotencyKey() } },
          body: {},
        }),
      );
      reload();
    } catch (e) {
      setActionError(isApiError(e) ? e.message : 'Could not accept this order.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-extrabold text-[var(--ink)]">Live orders</h1>
          <p className="text-[13px] text-[var(--ink2)]">Sorted by the most urgent deadline first.</p>
        </div>
        <Button variant="secondary" onClick={reload}>
          Refresh
        </Button>
      </header>

      {actionError && (
        <div className="mb-4 rounded-[var(--r-sm)] border border-[var(--danger-50)] bg-[var(--danger-50)] px-4 py-3 text-[13px] font-semibold text-[var(--danger-700)]">
          {actionError}
        </div>
      )}

      {orders.length === 0 ? (
        <EmptyState
          icon={<IconQueue size={32} />}
          title="No live orders"
          description="New orders will appear here the moment a customer checks out — you'll have 180 seconds to accept or reject each one."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {pending.map((order) => (
            <Card key={order.id} className="hg-fade-up border-[var(--primary)]/20 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[13px] font-extrabold text-[var(--ink)]">#{order.code}</span>
                <DeadlineTimer deadlineAt={order.deadline_at} />
              </div>
              <p className="text-[13.5px] font-semibold text-[var(--ink)]">{order.customer.display_name}</p>
              <p className="mb-2 text-[12px] text-[var(--ink2)]">{order.delivery_area}</p>
              {order.special_instructions && (
                <p className="mb-2 rounded-[var(--r-sm)] bg-[var(--warning-50)] px-2.5 py-1.5 text-[12px] font-semibold text-[var(--warning-700)]">
                  {order.special_instructions}
                </p>
              )}
              <ul className="mb-3 space-y-1">
                {order.lines.map((line) => (
                  <li key={line.line_no} className="flex justify-between text-[12.5px] text-[var(--ink2)]">
                    <span>
                      {line.quantity}× {line.name}
                      {line.variant_name ? ` (${line.variant_name})` : ''}
                    </span>
                    <span className="tabular-nums">{money(line.line_total_cents)}</span>
                  </li>
                ))}
              </ul>
              <div className="mb-4 flex items-center justify-between border-t border-[var(--hair)] pt-2 text-[13px] font-extrabold text-[var(--ink)]">
                <span>You earn</span>
                <span className="tabular-nums">{money(order.money.restaurant_net_cents)}</span>
              </div>
              <div className="flex gap-2">
                <Button variant="danger" className="flex-1" onClick={() => setRejectTarget(order)}>
                  <IconClose size={15} /> Reject
                </Button>
                <Button className="flex-1" loading={busyId === order.id} onClick={() => accept(order)}>
                  <IconCheck size={15} /> Accept
                </Button>
              </div>
            </Card>
          ))}

          {inKitchen.map((order) => (
            <Card key={order.id} className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[13px] font-extrabold text-[var(--ink)]">#{order.code}</span>
                <Chip tone="accent">{STATE_LABEL[order.state] ?? order.state}</Chip>
              </div>
              <p className="text-[13.5px] font-semibold text-[var(--ink)]">{order.customer.display_name}</p>
              {order.promised_ready_at && (
                <p className="mt-1 text-[12px] text-[var(--ink2)]">
                  Ready by {new Date(order.promised_ready_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
              <ul className="mt-3 space-y-1">
                {order.lines.map((line) => (
                  <li key={line.line_no} className="text-[12.5px] text-[var(--ink2)]">
                    {line.quantity}× {line.name}
                  </li>
                ))}
              </ul>
              {order.state === 'PREPARING' && (
                <Button
                  variant="accent"
                  className="mt-4 w-full"
                  loading={busyId === order.id}
                  onClick={async () => {
                    setBusyId(order.id);
                    try {
                      await unwrapOrThrow(
                        api.POST('/v1/restaurant/orders/{orderId}/ready', {
                          params: { path: { orderId: order.id }, header: { 'Idempotency-Key': idempotencyKey() } },
                        }),
                      );
                      reload();
                    } catch (e) {
                      setActionError(isApiError(e) ? e.message : 'Could not mark this order ready.');
                    } finally {
                      setBusyId(null);
                    }
                  }}
                >
                  Mark ready for pickup
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}

      {rejectTarget && (
        <RejectDialog
          order={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onRejected={() => {
            setRejectTarget(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
