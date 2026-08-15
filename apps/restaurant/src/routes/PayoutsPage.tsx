import { useState } from 'react';
import { unwrap, type Schema } from '@hg/api-client';
import { api } from '../lib/apiHelpers';
import { useAsync } from '../lib/useAsync';
import { Button, Card, Chip, EmptyState, ErrorState, PageLoading } from '../components/primitives';
import { IconWallet } from '../lib/icons';

/** See the note in OrdersPage.tsx re: the `Cents` brand not surviving openapi-fetch. */
function money(value: unknown) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(Number(value) / 100);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}

// P-19/S-04: weekly, Monday, automatic, no minimum. State chips deliberately stay off the
// halal palette entirely (RULE H-3/L-4) — payout state is money-operational, not a
// certification claim, so it reads through the ordinary warning/accent/neutral ramp only.
const STATE_LABEL: Record<Schema['PayoutState'], string> = {
  DRAFT: 'Draft',
  READY: 'Ready',
  TRANSFERRING: 'Transferring',
  TRANSFERRED: 'Transferred',
  PAID: 'Paid',
  FAILED: 'Failed',
  HELD: 'Held',
};

function stateTone(state: Schema['PayoutState']): 'accent' | 'warning' | 'danger' | 'neutral' {
  if (state === 'PAID' || state === 'TRANSFERRED') return 'accent';
  if (state === 'HELD') return 'warning';
  if (state === 'FAILED') return 'danger';
  return 'neutral';
}

export function PayoutsPage() {
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const cursor = cursorStack[cursorStack.length - 1] ?? null;

  const { status, data, error, reload } = useAsync(
    () =>
      unwrap(api.GET('/v1/restaurant/payouts', { params: { query: { cursor: cursor ?? undefined, limit: 20 } } })).then((envelope) => ({
        // Defensive: most `listRestaurantPayouts` mock fixtures (payout_paid, payout_held,
        // …) are tagged `schema: "Payout"` — a single object — rather than `array<Payout>`
        // like `payout_list_empty` correctly is (a fixture-registry inconsistency, not a
        // contract one; `listRestaurantPayouts` always returns `data: Payout[]` per the
        // contract). Normalise here so this screen renders correctly either way.
        payouts: Array.isArray(envelope.data) ? envelope.data : envelope.data ? [envelope.data] : [],
        meta: envelope.meta,
      })),
    [cursor],
  );

  if (status === 'loading') return <PageLoading label="Loading your payout history…" />;
  if (status === 'error') {
    return (
      <div className="p-6">
        <ErrorState description={error ?? undefined} onRetry={reload} />
      </div>
    );
  }

  const payouts = data?.payouts ?? [];
  const nextCursor = data?.meta.next_cursor ?? null;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-[20px] font-extrabold text-[var(--ink)]">
            <IconWallet size={20} /> Payouts
          </h1>
          <p className="text-[13px] text-[var(--ink2)]">Weekly, every Monday, automatic — no minimum balance required.</p>
        </div>
        <Button variant="secondary" onClick={reload}>
          Refresh
        </Button>
      </header>

      {payouts.length === 0 ? (
        <EmptyState
          icon={<IconWallet size={32} />}
          title="No payouts yet"
          description="Your first weekly payout appears here once you've completed orders in a settlement window."
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--hair)] text-[11.5px] font-bold uppercase tracking-wide text-[var(--ink3)]">
                  <th className="px-5 py-3">Period</th>
                  <th className="px-5 py-3">Orders</th>
                  <th className="px-5 py-3">Amount</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Paid</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} className="border-b border-[var(--hair)] last:border-0">
                    <td className="px-5 py-3.5 text-[13px] font-semibold text-[var(--ink)]">
                      {formatDate(p.period_start)} – {formatDate(p.period_end)}
                    </td>
                    <td className="px-5 py-3.5 text-[13px] text-[var(--ink2)]">{p.entry_count ?? '—'}</td>
                    <td className="px-5 py-3.5 text-[13px] font-extrabold tabular-nums text-[var(--ink)]">{money(p.amount_cents)}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-col gap-1">
                        <Chip tone={stateTone(p.state)}>{STATE_LABEL[p.state]}</Chip>
                        {p.state === 'HELD' && p.hold_reason && <span className="text-[11px] text-[var(--warning-700)]">{p.hold_reason}</span>}
                        {p.state === 'FAILED' && p.failure_message && <span className="text-[11px] text-[var(--danger-700)]">{p.failure_message}</span>}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-[12.5px] text-[var(--ink2)]">{p.paid_at ? formatDate(p.paid_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {(cursorStack.length > 1 || nextCursor) && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <Button variant="secondary" disabled={cursorStack.length <= 1} onClick={() => setCursorStack((s) => s.slice(0, -1))}>
            Newer
          </Button>
          <Button variant="secondary" disabled={!nextCursor} onClick={() => setCursorStack((s) => [...s, nextCursor])}>
            Older
          </Button>
        </div>
      )}
    </div>
  );
}
