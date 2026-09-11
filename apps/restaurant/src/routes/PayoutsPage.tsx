import { useState } from 'react';
import { unwrap, type Schema } from '@hg/api-client';
import { Button, Card, EmptyState, ErrorState, Icon } from '@hg/ui-web';
import { api } from '../lib/apiHelpers';
import { useAsync } from '../lib/useAsync';
import { useAuth } from '../lib/auth';
import { PageLoading } from '../components/PageLoading';
import { StatusChip, type StatusChipTone } from '../components/StatusChip';
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

function stateTone(state: Schema['PayoutState']): StatusChipTone {
  if (state === 'PAID' || state === 'TRANSFERRED') return 'accent';
  if (state === 'HELD') return 'warning';
  if (state === 'FAILED') return 'danger';
  return 'neutral';
}

export function PayoutsPage() {
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const cursor = cursorStack[cursorStack.length - 1] ?? null;

  const { principal } = useAuth();
  const isOwner = principal?.roles.some((r) => r.role === 'RESTAURANT_OWNER') ?? false;

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
    // P-19: payout.read is granted to RESTAURANT_OWNER only, by contract design — a
    // manager account gets a 403 here every time. That's a permission boundary, not a
    // failure, so it gets a neutral explanation rather than the red "something broke" card.
    if (!isOwner) {
      return (
        <div className="p-4 sm:p-6 lg:p-8">
          <EmptyState
            illustration={<Icon name="close" size={32} />}
            title="Payouts are visible to the account owner"
            description="Your role (manager) can run the kitchen, but weekly payout history is restricted to the restaurant's owner account for financial-privacy reasons. Ask the owner to check this page, or sign in with the owner account."
          />
        </div>
      );
    }
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
          <h1 className="flex items-center gap-2 text-heading-md font-extrabold text-fg-primary">
            <IconWallet size={20} /> Payouts
          </h1>
          <p className="text-body-sm text-fg-secondary">Weekly, every Monday, automatic — no minimum balance required.</p>
        </div>
        <Button variant="secondary" onPress={reload}>
          Refresh
        </Button>
      </header>

      {payouts.length === 0 ? (
        <EmptyState
          illustration={<IconWallet size={32} />}
          title="No payouts yet"
          description="Your first weekly payout appears here once you've completed orders in a settlement window."
        />
      ) : (
        <Card className="overflow-hidden" padding="0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-start">
              <thead>
                <tr className="border-b border-line-decorative text-label-sm font-bold uppercase tracking-wide text-fg-tertiary">
                  <th className="px-5 py-3">Period</th>
                  <th className="px-5 py-3">Orders</th>
                  <th className="px-5 py-3">Amount</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Paid</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} className="border-b border-line-decorative last:border-0">
                    <td className="px-5 py-3.5 text-body-sm font-semibold text-fg-primary">
                      {formatDate(p.period_start)} – {formatDate(p.period_end)}
                    </td>
                    <td className="px-5 py-3.5 text-body-sm text-fg-secondary">{p.entry_count ?? '—'}</td>
                    <td data-hg-numeric="tabular" className="px-5 py-3.5 text-body-sm font-extrabold text-fg-primary">
                      {money(p.amount_cents)}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-col items-start gap-1">
                        <StatusChip tone={stateTone(p.state)}>{STATE_LABEL[p.state]}</StatusChip>
                        {p.state === 'HELD' && p.hold_reason && <span className="text-caption text-feedback-warning-text">{p.hold_reason}</span>}
                        {p.state === 'FAILED' && p.failure_message && <span className="text-caption text-feedback-danger-text">{p.failure_message}</span>}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-caption text-fg-secondary">{p.paid_at ? formatDate(p.paid_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {(cursorStack.length > 1 || nextCursor) && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <Button variant="secondary" disabled={cursorStack.length <= 1} onPress={() => setCursorStack((s) => s.slice(0, -1))}>
            Newer
          </Button>
          <Button variant="secondary" disabled={!nextCursor} onPress={() => setCursorStack((s) => [...s, nextCursor])}>
            Older
          </Button>
        </div>
      )}
    </div>
  );
}
