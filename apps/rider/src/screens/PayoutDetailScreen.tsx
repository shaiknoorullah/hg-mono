/**
 * One payout and the ledger entries that fund it.
 *
 * D-28: a ledger entry belongs to at most one payout (a partial unique index enforces it
 * server-side), so this detail view is exactly `sum(entries) == amount_cents` — never a client
 * recomputation.
 */
import * as React from 'react';
import { Text, View } from 'react-native';
import { Badge, Card, Divider, Price, useTheme, useTypeStyle } from '@hg/ui-native';
import type { BadgeVariant } from '@hg/ui-native';
import { cents, isApiError, unwrap } from '@hg/api-client';

import { api } from '../api';
import type { PayoutDetail } from '../apiTypes';
import { Screen, LoadingView, ErrorView } from './Screen';

const PAYOUT_STATE_META: Record<string, { label: string; variant: BadgeVariant }> = {
  DRAFT: { label: 'Draft', variant: 'neutral' },
  READY: { label: 'Ready', variant: 'info' },
  TRANSFERRING: { label: 'Transferring', variant: 'info' },
  TRANSFERRED: { label: 'Transferred', variant: 'brand' },
  PAID: { label: 'Paid', variant: 'brand' },
  FAILED: { label: 'Failed', variant: 'warning' },
  HELD: { label: 'Held', variant: 'warning' },
};

const ENTRY_TYPE_LABEL: Record<string, string> = {
  DELIVERY: 'Delivery',
  TIP: 'Tip',
  CANCELLATION_COMPENSATION: 'Cancellation pay',
  BONUS: 'Bonus',
  ADJUSTMENT: 'Adjustment',
  CLAWBACK: 'Clawback',
};

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string; code?: string }
  | { status: 'ready'; payout: PayoutDetail };

export function PayoutDetailScreen({ payoutId }: { payoutId: string }): React.ReactElement {
  const theme = useTheme();
  const caption = useTypeStyle('caption');
  const [state, setState] = React.useState<Load>({ status: 'loading' });

  const load = React.useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const data = await unwrap(
        api.GET('/v1/riders/me/payouts/{payoutId}', { params: { path: { payoutId } } }),
      );
      setState({ status: 'ready', payout: data.data });
    } catch (e) {
      setState({
        status: 'error',
        message: e instanceof Error ? e.message : 'Could not load this payout.',
        code: isApiError(e) ? String(e.code) : undefined,
      });
    }
  }, [payoutId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen title="Payout" subtitle="Contributing entries">
      {state.status === 'loading' ? <LoadingView label="Loading payout…" /> : null}
      {state.status === 'error' ? (
        <ErrorView message={state.message} errorCode={state.code} onRetry={load} />
      ) : null}
      {state.status === 'ready' ? (
        <View style={{ gap: theme.density.gutter }}>
          <Card>
            <View style={{ gap: theme.target.spacing }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: theme.color.text.secondary }}>
                  {new Date(state.payout.period_start).toLocaleDateString()} –{' '}
                  {new Date(state.payout.period_end).toLocaleDateString()}
                </Text>
                <Badge
                  label={PAYOUT_STATE_META[state.payout.state]?.label ?? state.payout.state}
                  variant={PAYOUT_STATE_META[state.payout.state]?.variant ?? 'neutral'}
                  size="md"
                />
              </View>
              <Price cents={cents(Number(state.payout.amount_cents))} size="xl" />
              {state.payout.paid_at ? (
                <Text style={{ ...caption, color: theme.color.text.tertiary }}>
                  Paid {new Date(state.payout.paid_at).toLocaleString()}
                </Text>
              ) : null}
              {state.payout.hold_reason ? (
                <Text style={{ ...caption, color: theme.color.text.secondary }}>{state.payout.hold_reason}</Text>
              ) : null}
              {state.payout.failure_message ? (
                <Text style={{ ...caption, color: theme.color.text.secondary }}>
                  {state.payout.failure_message}
                </Text>
              ) : null}
            </View>
          </Card>

          <Card>
            <View style={{ gap: theme.target.spacing }}>
              <Text style={{ ...caption, color: theme.color.text.secondary }}>ENTRIES</Text>
              {state.payout.entries.map((entry, i) => (
                <View key={entry.id} style={{ gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ color: theme.color.text.primary }}>
                      {ENTRY_TYPE_LABEL[entry.type] ?? entry.type}
                      {entry.order_code ? ` · #${entry.order_code}` : ''}
                    </Text>
                    <Price cents={cents(Number(entry.gross_cents))} size="sm" sign="always" />
                  </View>
                  {i < state.payout.entries.length - 1 ? <Divider /> : null}
                </View>
              ))}
            </View>
          </Card>
        </View>
      ) : null}
    </Screen>
  );
}
