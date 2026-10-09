/**
 * Orders (C-26), as the approved "Track & After" canvas draws it (Orders — default, empty,
 * loading, error, load more, load more failed).
 *
 * Two lists from `GET /v1/orders`: Active (`status_group=ACTIVE`) and Past (`PAST`), each
 * keyset-paged by `meta.next_cursor`. They load independently, so a failed history keeps the
 * active order and its Track button on screen (Orders — error); only when both fail is the
 * whole screen an error.
 *
 * Rows are not pressable; each has explicit buttons named with the order code and restaurant.
 * Past rows carry no halal badge (the badge is the restaurant's state now, not at order time).
 * `REJECTED` and `FAILED` say "Not charged"; `CANCELLED` and `RESOLVED` say "See details for your
 * money", because the summary cannot tell a voided cancel from a refunded one, and a bare total
 * would read as money taken. Reorder re-adds the lines to the cart and opens it to review; there
 * is no rating at launch.
 */
import * as React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AppBar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Price,
  Skeleton,
  StatusTimeline,
  Toast,
  formatAbsoluteTime,
  useTheme,
  useTypeStyle,
} from '@hg/ui-native';
import type { BadgeVariant } from '@hg/ui-native';

import { listOrders, reorder, type OrderStatusGroup, type OrderSummary } from '../api/orders';
import { errorCodeOf } from '../api/async';
import { useNavigation } from '../navigation/stack';
import { CustomerTabBar } from '../navigation/TabBar';
import { ScreenBoundary } from '../components/ScreenBoundary';
import { clockTime, safeCents } from '../ordering/lines';

type Section =
  | { kind: 'loading' }
  | { kind: 'error'; code: string | null }
  | {
      kind: 'ready';
      orders: OrderSummary[];
      cursor: string | null;
      more: 'idle' | 'loading' | 'failed';
    };

export function OrdersScreen(): React.ReactElement {
  const nav = useNavigation();
  return (
    <ScreenBoundary what="your orders" exit={{ label: 'Home', onPress: () => nav.reset({ name: 'discovery' }) }}>
      <OrdersView />
    </ScreenBoundary>
  );
}

function useSection(group: OrderStatusGroup) {
  const [section, setSection] = React.useState<Section>({ kind: 'loading' });
  const alive = React.useRef(true);
  React.useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const load = React.useCallback(() => {
    setSection({ kind: 'loading' });
    listOrders({ statusGroup: group })
      .then(({ orders, meta }) => {
        if (!alive.current) return;
        setSection({
          kind: 'ready',
          orders: Array.isArray(orders) ? orders : [],
          cursor: meta?.next_cursor ?? null,
          more: 'idle',
        });
      })
      .catch((e) => {
        if (alive.current) setSection({ kind: 'error', code: errorCodeOf(e) });
      });
  }, [group]);

  const current = React.useRef(section);
  current.current = section;

  const loadMore = React.useCallback(() => {
    const s = current.current;
    if (s.kind !== 'ready' || !s.cursor || s.more === 'loading') return;
    const cursor = s.cursor;
    setSection({ ...s, more: 'loading' });
    listOrders({ statusGroup: group, cursor })
      .then(({ orders, meta }) => {
        if (!alive.current) return;
        setSection((cur) =>
          cur.kind === 'ready'
            ? {
                kind: 'ready',
                orders: [...cur.orders, ...(Array.isArray(orders) ? orders : [])],
                cursor: meta?.next_cursor ?? null,
                more: 'idle',
              }
            : cur,
        );
      })
      .catch(() => {
        if (alive.current) setSection((cur) => (cur.kind === 'ready' ? { ...cur, more: 'failed' } : cur));
      });
  }, [group]);

  React.useEffect(() => load(), [load]);
  return { section, load, loadMore };
}

function OrdersView(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation();
  const active = useSection('ACTIVE');
  const past = useSection('PAST');
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const smallStyle = useTypeStyle('body.sm');

  const onReorder = React.useCallback(
    async (order: OrderSummary) => {
      setBusyId(order.id);
      try {
        const { failedLines } = await reorder(order.id);
        setToast(
          failedLines.length > 0
            ? `Added what's still available. ${failedLines.length} item(s) could not be added.`
            : `${order.restaurant?.name ?? 'Your order'} added to your cart.`,
        );
        nav.push({ name: 'cart' });
      } catch {
        setToast("Couldn't reorder. Please try again.");
      } finally {
        setBusyId(null);
      }
    },
    [nav],
  );

  const a = active.section;
  const p = past.section;
  const loading = a.kind === 'loading' && p.kind === 'loading';
  const bothFailed = a.kind === 'error' && p.kind === 'error';
  const empty =
    a.kind === 'ready' && p.kind === 'ready' && a.orders.length === 0 && p.orders.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.base }}>
      <AppBar tone="cream" variant="large" title="Orders" loading={a.kind === 'loading' || p.kind === 'loading'} />
      {loading ? (
        <View style={{ flex: 1, paddingHorizontal: 16, gap: 12 }} aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} variant="outlined" padding={16}>
              <View style={{ gap: 10 }}>
                <Skeleton variant="text" width="60%" height={16} />
                <Skeleton variant="text" width="80%" height={12} />
                <Skeleton variant="text" width="45%" height={12} />
              </View>
            </Card>
          ))}
        </View>
      ) : bothFailed ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: 16 }}>
          <ErrorState
            errorCode={a.kind === 'error' ? a.code : null}
            title="We couldn't load your orders"
            description="This doesn't change any order. Check your connection and try again."
            onRetry={() => {
              active.load();
              past.load();
            }}
          />
        </View>
      ) : empty ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: 16 }}>
          <EmptyState
            title="No orders yet"
            description="When you order, you can follow it here, then find your receipt."
            primaryAction={{ label: 'Find a restaurant', onPress: () => nav.reset({ name: 'discovery' }) }}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 + insets.bottom, gap: 12 }}>
          {a.kind === 'ready' && a.orders.length > 0 ? (
            <>
              <SectionHeading>Active orders</SectionHeading>
              {a.orders.map((o) => (
                <OrderRow
                  key={o.id}
                  order={o}
                  active
                  onOpen={() => nav.push({ name: 'tracking', orderId: o.id })}
                />
              ))}
            </>
          ) : a.kind === 'error' ? (
            <InlineError
              title="We couldn't load your active order"
              body="Your history below is up to date."
              onRetry={active.load}
            />
          ) : null}

          <SectionHeading>Past orders</SectionHeading>
          {p.kind === 'loading' ? (
            <Skeleton variant="rect" height={112} />
          ) : p.kind === 'error' ? (
            <InlineError
              title="We couldn't load your past orders"
              body={a.kind === 'ready' && a.orders.length > 0 ? 'Your active order above is up to date.' : 'Check your connection and try again.'}
              onRetry={past.load}
            />
          ) : p.orders.length === 0 ? (
            <Text style={[smallStyle, { color: theme.color.text.secondary }]}>
              Orders you've finished will show here.
            </Text>
          ) : (
            <>
              {p.orders.map((o) => (
                <OrderRow
                  key={o.id}
                  order={o}
                  active={false}
                  onOpen={() => nav.push({ name: 'tracking', orderId: o.id })}
                  onReorder={() => void onReorder(o)}
                  reordering={busyId === o.id}
                />
              ))}
              {p.more === 'failed' ? (
                <InlineError
                  title="Couldn't load more orders"
                  body="Check your connection. The orders above are up to date."
                  onRetry={past.loadMore}
                />
              ) : p.cursor ? (
                <Button variant="tertiary" size="md" fullWidth loading={p.more === 'loading'} onPress={past.loadMore}>
                  Show more orders
                </Button>
              ) : null}
            </>
          )}
        </ScrollView>
      )}
      {toast ? <Toast variant="neutral" title={toast} onDismiss={() => setToast(null)} /> : null}
      <CustomerTabBar active="orders" />
    </View>
  );
}

function SectionHeading({ children }: { children: string }): React.ReactElement {
  const theme = useTheme();
  const style = useTypeStyle('heading.md');
  return (
    <Text accessibilityRole="header" style={[style, { color: theme.color.text.primary, marginTop: 8 }]}>
      {children}
    </Text>
  );
}

function InlineError({
  title,
  body,
  onRetry,
}: {
  title: string;
  body: string;
  onRetry: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const heading = useTypeStyle('heading.sm');
  const text = useTypeStyle('body.md');
  return (
    <Card variant="outlined" padding={16}>
      <View accessibilityRole="alert" style={{ gap: 12, alignItems: 'flex-start' }}>
        <Text style={[heading, { color: theme.color.text.primary }]}>{title}</Text>
        <Text style={[text, { color: theme.color.text.secondary }]}>{body}</Text>
        <Button variant="secondary" size="md" onPress={onRetry}>
          Try again
        </Button>
      </View>
    </Card>
  );
}

const STATE_WORD: Record<string, { label: string; variant: BadgeVariant }> = {
  CREATED: { label: 'Placing', variant: 'info' },
  AUTHORIZED: { label: 'Sending', variant: 'info' },
  RESTAURANT_PENDING: { label: 'Waiting to accept', variant: 'info' },
  PREPARING: { label: 'Being prepared', variant: 'info' },
  READY_FOR_PICKUP: { label: 'Ready', variant: 'info' },
  PICKED_UP: { label: 'On the way', variant: 'info' },
  ARRIVED: { label: 'At your door', variant: 'info' },
  DELIVERED: { label: 'Delivered', variant: 'outline' },
  COMPLETED: { label: 'Completed', variant: 'outline' },
  CANCELLED: { label: 'Cancelled', variant: 'outline' },
  REJECTED: { label: 'Not accepted', variant: 'outline' },
  FAILED: { label: 'Not completed', variant: 'outline' },
  DISPUTED: { label: 'Under review', variant: 'outline' },
  RESOLVED: { label: 'Resolved', variant: 'outline' },
};

function placedText(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const d = new Date(ms);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return `Today, ${clockTime(iso, formatAbsoluteTime)}`;
  }
  try {
    return new Intl.DateTimeFormat('en-CA', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  } catch {
    return d.toDateString();
  }
}

function OrderRow({
  order,
  active,
  onOpen,
  onReorder,
  reordering = false,
}: {
  order: OrderSummary;
  active: boolean;
  onOpen: () => void;
  onReorder?: () => void;
  reordering?: boolean;
}): React.ReactElement {
  const theme = useTheme();
  const name = useTypeStyle('heading.sm');
  const small = useTypeStyle('body.sm');
  const word = STATE_WORD[order.state] ?? { label: order.state, variant: 'outline' as const };
  const restaurant = order.restaurant?.name ?? 'Restaurant';
  const total = safeCents(order.total_cents);
  const items =
    typeof order.item_count === 'number'
      ? `${order.item_count} ${order.item_count === 1 ? 'item' : 'items'}${
          order.first_item_names?.length ? ` · ${order.first_item_names.join(', ')}` : ''
        }`
      : (order.first_item_names ?? []).join(', ');
  const money =
    order.state === 'REJECTED' || order.state === 'FAILED' ? (
      <Text style={[small, { color: theme.color.text.secondary }]}>Not charged</Text>
    ) : order.state === 'CANCELLED' || order.state === 'RESOLVED' ? (
      <Text style={[small, { color: theme.color.text.secondary }]}>See details for your money</Text>
    ) : total !== null ? (
      <Price cents={total} size="sm" />
    ) : null;

  return (
    <Card variant="outlined" padding={16} testID={`OrderRow-${order.id}`}>
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Text style={[name, { flex: 1, color: theme.color.text.primary }]}>{restaurant}</Text>
          <Badge label={word.label} variant={word.variant} size="sm" />
        </View>
        {active ? (
          <StatusTimeline audience="customer" state={order.state} orientation="compact" deadlineAt={null} />
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <Text style={[small, { flex: 1, color: theme.color.text.secondary }]}>
            {`${order.code} · ${placedText(order.placed_at)}`}
          </Text>
          {money}
        </View>
        {items ? <Text style={[small, { color: theme.color.text.secondary }]}>{items}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {active ? (
            <Button
              variant="primary"
              size="sm"
              onPress={onOpen}
              accessibilityLabel={`Track order ${order.code} from ${restaurant}`}
            >
              Track
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                size="sm"
                onPress={onOpen}
                accessibilityLabel={`Details for order ${order.code} from ${restaurant}`}
              >
                Details
              </Button>
              {onReorder ? (
                <Button
                  variant="tertiary"
                  size="sm"
                  onPress={onReorder}
                  loading={reordering}
                  accessibilityLabel={`Order again from ${restaurant}`}
                >
                  Order again
                </Button>
              ) : null}
            </>
          )}
        </View>
      </View>
    </Card>
  );
}
