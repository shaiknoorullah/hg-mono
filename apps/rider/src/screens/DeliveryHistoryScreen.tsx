/**
 * Delivery history.
 *
 * The contract has no rider-facing "list my past orders" endpoint — `listOrders` is
 * `x-roles: [CUSTOMER]` only, deliberately: the rider never sees prices or item detail, and a
 * browsable order pool would break the single-winner dispatch guarantee (D-18). Every completed
 * delivery does leave exactly one `DELIVERY` row in the rider's own earnings ledger
 * (`listRiderEarningEntries`), each carrying its `assignment_id`, `order_code` and `earned_at` —
 * so that ledger, filtered to `type=DELIVERY`, **is** the rider's delivery history and is the
 * server-authoritative source for it, not a client-side derivation.
 *
 * Cursor-paginated (keyset, never an offset — `meta.next_cursor`).
 */
import * as React from 'react';
import { Text, View } from 'react-native';
import { Badge, Button, Card, Price, useTheme, useTypeStyle } from '@hg/ui-native';
import { cents, isApiError, unwrap } from '@hg/api-client';

import { api } from '../api';
import type { EarningEntry } from '../apiTypes';
import { Screen, LoadingView, ErrorView, EmptyView } from './Screen';

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string; code?: string }
  | { status: 'empty' }
  | { status: 'ready'; entries: EarningEntry[]; nextCursor: string | null };

export function DeliveryHistoryScreen(): React.ReactElement {
  const theme = useTheme();
  const caption = useTypeStyle('caption');
  const [state, setState] = React.useState<Load>({ status: 'loading' });
  const [loadingMore, setLoadingMore] = React.useState(false);

  const load = React.useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const data = await unwrap(
        api.GET('/v1/riders/me/earnings/entries', {
          params: { query: { limit: 20, type: ['DELIVERY'] } },
        }),
      );
      if (data.data.length === 0) {
        setState({ status: 'empty' });
        return;
      }
      setState({ status: 'ready', entries: data.data, nextCursor: data.meta.next_cursor });
    } catch (e) {
      setState({
        status: 'error',
        message: e instanceof Error ? e.message : 'Could not load your delivery history.',
        code: isApiError(e) ? String(e.code) : undefined,
      });
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const loadMore = React.useCallback(async () => {
    if (state.status !== 'ready' || !state.nextCursor) return;
    setLoadingMore(true);
    try {
      const data = await unwrap(
        api.GET('/v1/riders/me/earnings/entries', {
          params: { query: { limit: 20, cursor: state.nextCursor, type: ['DELIVERY'] } },
        }),
      );
      setState({
        status: 'ready',
        entries: [...state.entries, ...data.data],
        nextCursor: data.meta.next_cursor,
      });
    } finally {
      setLoadingMore(false);
    }
  }, [state]);

  return (
    <Screen title="Delivery history" subtitle="Every completed trip, from your earnings ledger">
      {state.status === 'loading' ? <LoadingView label="Loading your deliveries…" /> : null}
      {state.status === 'error' ? (
        <ErrorView message={state.message} errorCode={state.code} onRetry={load} />
      ) : null}
      {state.status === 'empty' ? (
        <EmptyView
          title="No deliveries yet"
          description="Completed trips show up here as soon as you finish your first delivery."
        />
      ) : null}
      {state.status === 'ready' ? (
        <View style={{ gap: theme.density.gutter }}>
          {state.entries.map((entry) => (
            <Card key={entry.id}>
              <View style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: theme.color.text.primary, fontWeight: '600' }}>
                    {entry.order_code ? `Order #${entry.order_code}` : 'Delivery'}
                  </Text>
                  <Price cents={cents(Number(entry.gross_cents))} size="md" />
                </View>
                <Badge
                  label={entry.status === 'PAID' ? 'Paid out' : entry.status === 'AVAILABLE' ? 'Available' : entry.status}
                  variant={entry.status === 'PAID' ? 'brand' : entry.status === 'REVERSED' ? 'warning' : 'info'}
                  size="sm"
                />
                <Text style={{ ...caption, color: theme.color.text.tertiary }}>
                  {new Date(entry.earned_at).toLocaleString()}
                </Text>
              </View>
            </Card>
          ))}
          {state.nextCursor ? (
            <Button variant="secondary" size="md" fullWidth loading={loadingMore} onPress={() => void loadMore()}>
              Load more
            </Button>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
