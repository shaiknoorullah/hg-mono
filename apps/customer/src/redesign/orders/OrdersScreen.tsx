/**
 * T9 Orders (TA/Orders-*): active orders pinned first, then past orders.
 *
 * Ported from #639's `OrdersScreen`: Active (`status_group=ACTIVE`) and Past (`status_group=PAST`)
 * load separately, so a failed history keeps the active card, Track and Get help on screen
 * (Orders-Error); only when both fail is the whole page an error (Orders-Error-Both). Past orders
 * page by `meta.next_cursor` as the list nears its end (Orders-LoadMore, -LoadMoreFailed, -End).
 * The reorder action #639 had is gone: reorder is a later release.
 *
 * Rows are not pressable; each has explicit buttons named with the order code and restaurant.
 * Active rows: Track and Get help, plus the arrival window from `getOrderTracking`. An order under
 * review (DISPUTED) lists under Active with its answer-by time and Details, and does not block a new
 * order. Past rows: Details and a row menu ("Actions for order {code} from {restaurant}") holding
 * View receipt (completed or resolved orders) and Get help with this order; no Rate, no Order
 * again. Every Get help opens the order page with its Get help sheet (`sheet: 'getHelp'`).
 *
 * No halal badge on any row: the restaurant's state now is not its state at order time. Money:
 * only REJECTED and FAILED say "Not charged"; CANCELLED and RESOLVED say "See details for your
 * money"; every other row shows the server's total through Price.
 *
 * The design system has no Menu yet (ds-request), so the row menu is composed here from IconButton
 * and Sheet and not exported.
 */
import * as React from 'react';
import { ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import {
  AppBar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  Price,
  Sheet,
  Skeleton,
  StatusTimeline,
  useTheme,
  useTypeStyle,
} from '../ds';
import { useNow } from '../lib/now';
import { errorCodeOf, useQuery } from '../lib/query';
import { formatTimeWindow, formatTime, timeAfter } from '../lib/time';
import { useNav } from '../navigation/context';
import {
  dayAndTime,
  hasReceipt,
  itemsLine,
  placedLine,
  rowBadge,
  rowMoney,
} from './format';
import { getOrderTracking, listOrdersPage, type OrderStatusGroup, type OrderSummary } from './ordersApi';

export const ORDERS_COPY = {
  title: 'Orders',
  active: 'Active orders',
  past: 'Past orders',
  emptyTitle: 'No orders yet',
  emptyBody: 'When you order, you can follow it here, then find your receipt.',
  emptyAction: 'Find a restaurant',
  pastFailed: "We couldn't load your past orders",
  pastFailedWithActive: 'Your active order above is up to date.',
  bothFailed: "We couldn't load your orders",
  bothFailedBody: "This is a problem loading the page. It doesn't change your orders. We'll let you know if anything changes.",
  moreFailed: "Couldn't load more orders",
  moreFailedBody: 'Check your connection. The orders above are up to date.',
  end: "That's all your orders",
  arriving: 'Arriving',
  reviewBy: "We'll get back to you by",
} as const;

/** How close to the end of the list (in points) the next page starts loading. */
const LOAD_MORE_THRESHOLD = 240;

type Section =
  | { kind: 'loading' }
  | { kind: 'error'; code: string | null; attempts: number }
  | { kind: 'ready'; orders: OrderSummary[]; cursor: string | null; more: 'idle' | 'loading' | 'failed'; moreAttempts: number };

/** One independently loaded, cursor-paged list of orders. */
export function useOrderSection(group: OrderStatusGroup) {
  const [section, setSection] = React.useState<Section>({ kind: 'loading' });
  const alive = React.useRef(true);
  const attempts = React.useRef(0);
  const current = React.useRef(section);
  current.current = section;

  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = React.useCallback(() => {
    const attempt = attempts.current++;
    setSection({ kind: 'loading' });
    listOrdersPage(group)
      .then(({ orders, nextCursor }) => {
        if (alive.current) setSection({ kind: 'ready', orders, cursor: nextCursor, more: 'idle', moreAttempts: 0 });
      })
      .catch((e: unknown) => {
        if (alive.current) setSection({ kind: 'error', code: errorCodeOf(e), attempts: attempt });
      });
  }, [group]);

  /**
   * Loads the next page. Scrolling and a short first page call it automatically; after a failure
   * only the error's Try again (`manual`) loads again, so a failed page never retries in a loop.
   */
  const loadMore = React.useCallback((opts?: { manual?: boolean }) => {
    const s = current.current;
    if (s.kind !== 'ready' || !s.cursor || s.more === 'loading') return;
    if (s.more === 'failed' && !opts?.manual) return;
    const cursor = s.cursor;
    const next: Section = { ...s, more: 'loading' };
    current.current = next;
    setSection(next);
    listOrdersPage(group, cursor)
      .then(({ orders, nextCursor }) => {
        if (!alive.current) return;
        setSection((cur) =>
          cur.kind === 'ready'
            ? {
                ...cur,
                // A row the first page already showed (an order that moved) is not listed twice.
                orders: [...cur.orders, ...orders.filter((o) => !cur.orders.some((c) => c.id === o.id))],
                cursor: nextCursor,
                more: 'idle',
              }
            : cur,
        );
      })
      .catch(() => {
        if (alive.current) {
          setSection((cur) => (cur.kind === 'ready' ? { ...cur, more: 'failed', moreAttempts: cur.moreAttempts + 1 } : cur));
        }
      });
  }, [group]);

  React.useEffect(() => load(), [load]);
  return { section, load, loadMore };
}

export function OrdersScreen(): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const now = useNow(60_000);
  const active = useOrderSection('ACTIVE');
  const past = useOrderSection('PAST');
  const [menuFor, setMenuFor] = React.useState<OrderSummary | null>(null);
  const endStyle = useTypeStyle('body.sm');
  const layout = React.useRef({ height: 0, content: 0 });

  const a = active.section;
  const p = past.section;
  const loading = a.kind === 'loading' && p.kind === 'loading';
  const bothFailed = a.kind === 'error' && p.kind === 'error';
  const empty = a.kind === 'ready' && p.kind === 'ready' && a.orders.length === 0 && p.orders.length === 0;
  const hasActive = a.kind === 'ready' && a.orders.length > 0;
  // The page's only h1 is the state's heading when the whole page is one state.
  const wholePageState = bothFailed || empty;

  const loadMoreIfNearEnd = React.useCallback(
    (offsetY: number) => {
      const { height, content } = layout.current;
      if (content <= 0) return;
      if (offsetY + height >= content - LOAD_MORE_THRESHOLD) past.loadMore();
    },
    [past],
  );

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    layout.current = { height: layoutMeasurement.height, content: contentSize.height };
    loadMoreIfNearEnd(contentOffset.y);
  };

  const retryBoth = () => {
    active.load();
    past.load();
  };

  const open = (order: OrderSummary) => nav.push({ name: 'tracking', orderId: order.id });
  const help = (order: OrderSummary) => nav.push({ name: 'tracking', orderId: order.id, sheet: 'getHelp' });

  let body: React.ReactElement;
  if (loading) {
    body = (
      <View style={styles.pad} testID="Orders-loading" accessibilityLabel="Loading your orders" aria-busy>
        {[0, 1, 2].map((i) => (
          <Card key={i} variant="outlined">
            <View style={styles.gap10}>
              <Skeleton variant="text" width="60%" height={16} />
              <Skeleton variant="text" width="80%" height={12} />
              <Skeleton variant="text" width="45%" height={12} />
            </View>
          </Card>
        ))}
      </View>
    );
  } else if (bothFailed) {
    body = (
      <View style={styles.center}>
        <ErrorState
          variant="page"
          title={ORDERS_COPY.bothFailed}
          description={ORDERS_COPY.bothFailedBody}
          onRetry={retryBoth}
          testID="Orders-error"
        />
      </View>
    );
  } else if (empty) {
    body = (
      <View style={styles.center}>
        <EmptyState
          variant="page"
          headingLevel={1}
          autoFocus
          title={ORDERS_COPY.emptyTitle}
          description={ORDERS_COPY.emptyBody}
          primaryAction={{ label: ORDERS_COPY.emptyAction, onPress: () => nav.selectTab('home') }}
          testID="Orders-empty"
        />
      </View>
    );
  } else {
    body = (
      <ScrollView
        testID="Orders-list"
        contentContainerStyle={styles.list}
        onScroll={onScroll}
        scrollEventThrottle={64}
        onLayout={(e) => {
          layout.current.height = e.nativeEvent.layout.height;
        }}
        onContentSizeChange={(_w, h) => {
          layout.current.content = h;
          // A first page too short to scroll still pages on.
          if (layout.current.height > 0 && h <= layout.current.height + LOAD_MORE_THRESHOLD) past.loadMore();
        }}
      >
        {/* Active */}
        {a.kind === 'loading' ? (
          <Skeleton variant="rect" height={140} testID="Orders-active-loading" />
        ) : a.kind === 'error' ? (
          <ErrorState variant="inline" autoFocus={a.attempts > 0} onRetry={active.load} testID="Orders-active-error" />
        ) : hasActive ? (
          <>
            <SectionHeading>{ORDERS_COPY.active}</SectionHeading>
            {a.orders.map((o) => (
              <OrderRow
                key={o.id}
                order={o}
                section="active"
                now={now}
                onOpen={() => open(o)}
                onHelp={() => help(o)}
                onMenu={() => setMenuFor(o)}
              />
            ))}
          </>
        ) : null}

        {/* Past */}
        {p.kind === 'loading' ? (
          <>
            <SectionHeading>{ORDERS_COPY.past}</SectionHeading>
            <Skeleton variant="rect" height={112} testID="Orders-past-loading" />
          </>
        ) : p.kind === 'error' ? (
          <>
            <SectionHeading>{ORDERS_COPY.past}</SectionHeading>
            <ErrorState
              variant="inline"
              // On arrival focus stays on the page heading; after a failed Try again it moves here.
              autoFocus={p.attempts > 0}
              title={ORDERS_COPY.pastFailed}
              description={hasActive ? ORDERS_COPY.pastFailedWithActive : undefined}
              onRetry={past.load}
              testID="Orders-past-error"
            />
          </>
        ) : p.orders.length > 0 ? (
          <>
            <SectionHeading>{ORDERS_COPY.past}</SectionHeading>
            {p.orders.map((o) => (
              <OrderRow
                key={o.id}
                order={o}
                section="past"
                now={now}
                onOpen={() => open(o)}
                onHelp={() => help(o)}
                onMenu={() => setMenuFor(o)}
              />
            ))}
            {p.more === 'loading' ? (
              <View testID="Orders-more-loading" accessibilityLabel="Loading more orders" aria-busy>
                <Skeleton variant="rect" height={112} />
              </View>
            ) : p.more === 'failed' ? (
              <ErrorState
                variant="inline"
                autoFocus={p.moreAttempts > 1}
                title={ORDERS_COPY.moreFailed}
                description={ORDERS_COPY.moreFailedBody}
                onRetry={() => past.loadMore({ manual: true })}
                testID="Orders-more-error"
              />
            ) : !p.cursor ? (
              <Text
                testID="Orders-end"
                style={[endStyle, { color: theme.color.text.secondary, textAlign: 'center', paddingVertical: 8 }]}
              >
                {ORDERS_COPY.end}
              </Text>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="OrdersScreen">
      <AppBar variant="large" title={ORDERS_COPY.title} isPageHeading={!wholePageState} />
      {body}
      <RowMenu order={menuFor} onClose={() => setMenuFor(null)} />
    </View>
  );
}

function SectionHeading({ children }: { children: string }): React.ReactElement {
  const theme = useTheme();
  const style = useTypeStyle('heading.md');
  return (
    <Text accessibilityRole="header" aria-level={2} style={[style, { color: theme.color.text.primary, marginTop: 8 }]}>
      {children}
    </Text>
  );
}

function OrderRow({
  order,
  section,
  now,
  onOpen,
  onHelp,
  onMenu,
}: {
  order: OrderSummary;
  section: 'active' | 'past';
  now: number;
  onOpen: () => void;
  onHelp: () => void;
  onMenu: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const nameStyle = useTypeStyle('heading.sm');
  const small = useTypeStyle('body.sm');
  const labelLg = useTypeStyle('label.lg');
  const restaurant = order.restaurant?.name ?? '';
  const badge = rowBadge(order.state);
  const money = rowMoney(order.state);
  const items = itemsLine(order);
  const disputed = order.state === 'DISPUTED';
  const live = section === 'active' && !disputed;

  return (
    <Card variant="outlined" testID={`OrderRow-${order.id}`}>
      <View style={styles.gap10}>
        <View style={styles.rowBetween}>
          <Text style={[nameStyle, styles.flex1, { color: theme.color.text.primary }]}>{restaurant}</Text>
          {badge ? <Badge label={badge.label} variant={badge.variant} size="sm" testID={`OrderRow-${order.id}-badge`} /> : null}
        </View>

        {live ? <LiveProgress order={order} now={now} /> : null}
        {disputed && order.deadline_at ? (
          <View>
            <Text style={[small, { color: theme.color.text.secondary }]}>{ORDERS_COPY.reviewBy}</Text>
            <Text style={[labelLg, { color: theme.color.text.primary }]}>{dayAndTime(order.deadline_at)}</Text>
          </View>
        ) : null}

        <View style={styles.rowBetweenBaseline}>
          <Text style={[small, styles.flex1, { color: theme.color.text.secondary }]}>
            {`${order.code} · ${placedLine(order.placed_at, now)}`}
          </Text>
          {money.kind === 'text' ? (
            <Text style={[small, { color: theme.color.text.secondary }]} testID={`OrderRow-${order.id}-money`}>
              {money.text}
            </Text>
          ) : (
            <Price cents={order.total_cents} size="sm" testID={`OrderRow-${order.id}-total`} />
          )}
        </View>

        {items ? <Text style={[small, { color: theme.color.text.secondary }]}>{items}</Text> : null}

        <View style={styles.actions}>
          {live ? (
            <>
              <Button variant="primary" size="sm" onPress={onOpen} accessibilityLabel={`Track order ${order.code} from ${restaurant}`}>
                Track
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onPress={onHelp}
                accessibilityLabel={`Get help with order ${order.code} from ${restaurant}`}
              >
                Get help
              </Button>
            </>
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
              {section === 'past' ? (
                <IconButton
                  icon={<Icon name="menu" weight="linear" />}
                  accessibilityLabel={`Actions for order ${order.code} from ${restaurant}`}
                  onPress={onMenu}
                  testID={`OrderRow-${order.id}-menu`}
                />
              ) : null}
            </>
          )}
        </View>
      </View>
    </Card>
  );
}

/**
 * "Arriving 7:40–7:50 pm": `eta_window_minutes` is the window's total width, centred on `eta_at`
 * (spec C-32 rule 3, a ±5 min window). Static, never ticking.
 */
export function arrivalText(etaAt: string, windowMinutes: number | null | undefined): string {
  if (!windowMinutes || windowMinutes <= 0) return formatTime(etaAt);
  const half = windowMinutes * 30;
  return formatTimeWindow(timeAfter(etaAt, -half), timeAfter(etaAt, half));
}

/**
 * A live row's arrival line and compact timeline, from one `getOrderTracking` read. The timeline
 * takes the tracking transitions and the row's deadline. Step times stay off: the DS timeline
 * formats them itself ("p.m."), and times here go through lib/time only (ds-request in §4).
 */
function LiveProgress({ order, now }: { order: OrderSummary; now: number }): React.ReactElement {
  const theme = useTheme();
  const small = useTypeStyle('body.sm');
  const strong = useTypeStyle('label.lg');
  const { query } = useQuery(() => getOrderTracking(order.id), [order.id]);
  const tracking = query.kind === 'ready' ? query.data : null;
  return (
    <>
      {tracking?.eta_at ? (
        <View style={styles.rowBaseline} testID={`OrderRow-${order.id}-eta`}>
          <Text style={[small, { color: theme.color.text.secondary }]}>{ORDERS_COPY.arriving}</Text>
          <Text style={[strong, { color: theme.color.text.primary }]}>
            {arrivalText(tracking.eta_at, tracking.eta_window_minutes)}
          </Text>
        </View>
      ) : null}
      <StatusTimeline
        audience="customer"
        state={order.state}
        orientation="compact"
        transitions={tracking?.timeline}
        deadlineAt={order.deadline_at ?? null}
        showTimes={false}
        now={now}
        testID={`OrderRow-${order.id}-timeline`}
      />
    </>
  );
}

/** The row menu: View receipt (completed or resolved orders) and Get help. Nothing is shown disabled. */
function RowMenu({ order, onClose }: { order: OrderSummary | null; onClose: () => void }): React.ReactElement | null {
  const nav = useNav();
  if (!order) return null;
  const restaurant = order.restaurant?.name ?? '';
  const go = (route: Parameters<typeof nav.push>[0]) => {
    onClose();
    nav.push(route);
  };
  return (
    <Sheet open onClose={onClose} title={`Actions for order ${order.code} from ${restaurant}`} testID="Orders-rowMenu">
      <View style={styles.menu}>
        {hasReceipt(order.state) ? (
          <Button variant="tertiary" size="md" fullWidth onPress={() => go({ name: 'receipt', orderId: order.id })}>
            View receipt
          </Button>
        ) : null}
        <Button
          variant="tertiary"
          size="md"
          fullWidth
          onPress={() => go({ name: 'tracking', orderId: order.id, sheet: 'getHelp' })}
        >
          Get help with this order
        </Button>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { flex: 1, paddingHorizontal: 16, gap: 12 },
  center: { flex: 1, justifyContent: 'center', padding: 16 },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 12 },
  gap10: { gap: 10 },
  flex1: { flex: 1 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowBetweenBaseline: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  rowBaseline: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  menu: { gap: 8 },
});
