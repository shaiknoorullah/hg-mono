import { useCallback, useEffect, useRef, useState } from 'react';
import type { Schema } from '@hg/api-client';
import { Button, Card, EmptyState, ErrorState, Icon } from '@hg/ui-web';
import { api, unwrapOrThrow } from '../lib/apiHelpers';
import { DeadlineTimer } from '../components/DeadlineTimer';
import { PageLoading } from '../components/PageLoading';
import { StatusChip } from '../components/StatusChip';
import { RejectDialog, type RejectableOrder } from '../components/RejectDialog';
import { SealBindRow } from '../components/SealBindRow';
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

const POLL_MS = 7_000;

/** Short two-tone chime; best-effort (browsers block audio until the page has had a gesture). */
function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.17);
    });
    window.setTimeout(() => void ctx.close(), 800);
  } catch {
    /* no audio available */
  }
}

type OrderList = Awaited<ReturnType<typeof fetchOrders>>;
function fetchOrders() {
  return unwrapOrThrow(
    api.GET('/v1/restaurant/orders', {
      params: { query: { state: ['RESTAURANT_PENDING', 'PREPARING', 'READY_FOR_PICKUP'] } },
    }),
  );
}

export function OrdersPage() {
  const [data, setData] = useState<OrderList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef<Set<string> | null>(null);

  // Polling (not the WebSocket): every POLL_MS while the tab is visible; paused when hidden
  // and refreshed immediately on focus. New RESTAURANT_PENDING ids ring and highlight.
  const reload = useCallback(async () => {
    try {
      const list = await fetchOrders();
      setData(list);
      setError(null);
      setStatus('ready');
      const pendingIds = list.filter((o) => o.state === 'RESTAURANT_PENDING').map((o) => o.id);
      if (seen.current) {
        const added = pendingIds.filter((id) => !seen.current!.has(id));
        if (added.length) {
          chime();
          setFresh((f) => new Set([...f, ...added]));
        }
      }
      seen.current = new Set([...(seen.current ?? []), ...pendingIds]);
    } catch (e) {
      // Keep showing the last good list on a transient poll failure.
      if (!seen.current) {
        setError(isApiError(e) ? e.message : 'Could not reach the server. Check your connection and try again.');
        setStatus('error');
      }
    }
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      void reload();
      timer = window.setInterval(() => void reload(), POLL_MS);
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
    };
  }, [reload]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<RejectableOrder | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (status === 'loading') return <PageLoading label="Loading the order queue…" />;
  if (status === 'error') {
    return (
      <div className="p-6">
        <ErrorState description={error ?? undefined} onRetry={() => void reload()} />
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
          <h1 className="text-heading-md font-extrabold text-fg-primary">Live orders</h1>
          <p className="text-body-sm text-fg-secondary">Sorted by the most urgent deadline first.</p>
        </div>
        <Button variant="secondary" onPress={() => void reload()}>
          Refresh
        </Button>
      </header>

      {actionError && (
        <div role="alert" className="mb-4 rounded-sm border border-feedback-danger-border bg-feedback-danger-tint px-4 py-3 text-body-sm font-semibold text-feedback-danger-text">
          {actionError}
        </div>
      )}

      {orders.length === 0 ? (
        <EmptyState
          illustration={<Icon name="orders" size={32} />}
          title="No live orders"
          description="New orders will appear here the moment a customer checks out — you'll have 180 seconds to accept or reject each one."
          tone="positive"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {pending.map((order) => (
            <div
              key={order.id}
              data-new-order={fresh.has(order.id) ? 'true' : undefined}
              className={fresh.has(order.id) ? 'rounded-lg ring-4 ring-action-primary-bg' : undefined}
            >
            <Card className="hg-fade-up border-line-brand">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-label-md font-extrabold text-fg-primary">#{order.code}</span>
                <DeadlineTimer deadlineAt={order.deadline_at} />
              </div>
              <p className="text-body-sm font-semibold text-fg-primary">{order.customer.display_name}</p>
              <p className="mb-2 text-caption text-fg-secondary">{order.delivery_area}</p>
              {order.special_instructions && (
                <p className="mb-2 rounded-sm bg-feedback-warning-tint px-2.5 py-1.5 text-caption font-semibold text-feedback-warning-text">
                  {order.special_instructions}
                </p>
              )}
              <ul className="mb-3 space-y-1">
                {order.lines.map((line) => (
                  <li key={line.line_no} className="flex justify-between text-body-sm text-fg-secondary">
                    <span>
                      {line.quantity}× {line.name}
                      {line.variant_name ? ` (${line.variant_name})` : ''}
                    </span>
                    <span data-hg-numeric="tabular">{money(line.line_total_cents)}</span>
                  </li>
                ))}
              </ul>
              <div className="mb-4 flex items-center justify-between border-t border-line-decorative pt-2 text-label-md font-extrabold text-fg-primary">
                <span>You earn</span>
                <span data-hg-numeric="tabular">{money(order.money.restaurant_net_cents)}</span>
              </div>
              <div className="flex gap-2">
                <Button variant="danger" destructive fullWidth iconStart={<Icon name="close" size={15} />} onPress={() => setRejectTarget(order)}>
                  Reject
                </Button>
                <Button fullWidth iconStart={<Icon name="check" size={15} />} loading={busyId === order.id} onPress={() => accept(order)}>
                  Accept
                </Button>
              </div>
            </Card>
            </div>
          ))}

          {inKitchen.map((order) => (
            <Card key={order.id}>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-label-md font-extrabold text-fg-primary">#{order.code}</span>
                <StatusChip tone="accent">{STATE_LABEL[order.state] ?? order.state}</StatusChip>
              </div>
              <p className="text-body-sm font-semibold text-fg-primary">{order.customer.display_name}</p>
              {order.promised_ready_at && (
                <p className="mt-1 text-caption text-fg-secondary">
                  Ready by {new Date(order.promised_ready_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
              <ul className="mt-3 space-y-1">
                {order.lines.map((line) => (
                  <li key={line.line_no} className="text-body-sm text-fg-secondary">
                    {line.quantity}× {line.name}
                  </li>
                ))}
              </ul>
              {order.state === 'PREPARING' && (
                <Button
                  variant="secondary"
                  fullWidth
                  className="mt-4"
                  loading={busyId === order.id}
                  onPress={async () => {
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
              {(order.state === 'PREPARING' || order.state === 'READY_FOR_PICKUP') && (
                <SealBindRow orderId={order.id} />
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
