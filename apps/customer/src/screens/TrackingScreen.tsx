/**
 * Order tracking (C-26 / C-32), as the approved "Track & After" canvas draws it.
 *
 * One layout per family of `OrderState`:
 *
 * - **Waiting** (`CREATED`, `AUTHORIZED`, `RESTAURANT_PENDING`): "Waiting for {restaurant} to
 *   accept", what is held on the card, and, once there is a deadline, a neutral progress bar
 *   with "{restaurant} replies by 6:45 pm". No countdown, nothing red (redesign constitution).
 *   Free cancel (`CancelOrder`) while the server says `can_cancel`.
 * - **On its way** (`PREPARING`, `READY_FOR_PICKUP`, `PICKED_UP`, `ARRIVED`): the state and the
 *   ETA window as the heading, the live map once the rider has the food, the timeline, the
 *   restaurant with its halal badge, and the rider once one is assigned.
 * - **Delivered** (`DELIVERED`, `COMPLETED`): when it arrived, what was charged, and the receipt
 *   once the server has written it. No halal badge after delivery: the badge is the restaurant's
 *   state now, not at order time.
 * - **Outcome** (`CANCELLED`, `REJECTED`, `FAILED`): what happened in plain words and what
 *   happened to the money, then where to go next. Never auto-dismissed, never red.
 * - **Under review** (`DISPUTED`, `RESOLVED`).
 *
 * Realtime: one feed (`useLiveTracking`) holds the order's socket. Every `order.*` or
 * `payment.*` event, and every change of state in the REST tracking projection, re-reads the
 * order. While the socket is not open the feed polls the tracking endpoint and this screen also
 * re-reads the order every 15 s, so the screen is the same either way (websocket.md rule 8).
 */
import * as React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Schema } from '@hg/api-client';
import {
  AppBar,
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  HalalBadge,
  Icon,
  Price,
  Skeleton,
  StatusTimeline,
  formatAbsoluteTime,
  useTheme,
  useTypeStyle,
} from '@hg/ui-native';
import type { IconName } from '@hg/ui-native';

import { getOrder } from '../api/orders';
import { errorCodeOf } from '../api/async';
import { useNavigation } from '../navigation/stack';
import { CustomerTabBar } from '../navigation/TabBar';
import { CancelOrder } from '../components/CancelOrder';
import { OrderReceipt } from '../components/OrderReceipt';
import { TrackingMapView } from '../components/TrackingMap';
import { ItemRow, MoneyRow, Notice, SectionCard } from '../components/OrderBits';
import { ScreenBoundary } from '../components/ScreenBoundary';
import { useLiveTracking } from '../tracking/useLiveTracking';
import { clockTime, pricedLineOptions, requestText, safeCents } from '../ordering/lines';

type Order = Schema['OrderCustomerView'];
type Tracking = Schema['OrderTracking'];

const WAITING: ReadonlySet<string> = new Set(['CREATED', 'AUTHORIZED', 'RESTAURANT_PENDING']);
const ON_ITS_WAY: ReadonlySet<string> = new Set([
  'PREPARING',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'ARRIVED',
]);
const DELIVERED: ReadonlySet<string> = new Set(['DELIVERED', 'COMPLETED']);
const OUTCOME: ReadonlySet<string> = new Set(['CANCELLED', 'REJECTED', 'FAILED']);
const TERMINAL: ReadonlySet<string> = new Set([
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
  'FAILED',
  'RESOLVED',
]);
/** The rider has the food: only now does the map show anything moving. */
const RIDER_ON_MAP: ReadonlySet<string> = new Set(['PICKED_UP', 'ARRIVED']);
/** websocket.md rule 8: the REST fallback cadence. */
const ORDER_POLL_MS = 15_000;

// The outcome of the customer's own cancel, shown above the order it changed.
type CancelNotice = 'cancelled' | 'window-closed' | null;

type State =
  | { kind: 'loading' }
  | { kind: 'error'; code: string | null }
  | { kind: 'empty' }
  | { kind: 'ready'; order: Order };

const clock = (iso: string | null | undefined): string => clockTime(iso, formatAbsoluteTime);

export function TrackingScreen({ orderId }: { orderId: string }): React.ReactElement {
  const nav = useNavigation();
  const leave = React.useCallback(
    () => (nav.canGoBack ? nav.back() : nav.reset({ name: 'orders' })),
    [nav],
  );
  return (
    <ScreenBoundary what="this order" exit={{ label: 'Back to Orders', onPress: leave }}>
      <TrackingView orderId={orderId} onLeave={leave} />
    </ScreenBoundary>
  );
}

function TrackingView({
  orderId,
  onLeave,
}: {
  orderId: string;
  onLeave: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation();
  const live = useLiveTracking(orderId);

  const [state, setState] = React.useState<State>({ kind: 'loading' });
  const [notice, setNotice] = React.useState<CancelNotice>(null);
  const alive = React.useRef(true);
  React.useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const load = React.useCallback(() => {
    setState({ kind: 'loading' });
    getOrder(orderId)
      .then((order) => {
        if (alive.current) setState(order ? { kind: 'ready', order } : { kind: 'empty' });
      })
      .catch((e) => {
        if (alive.current) setState({ kind: 'error', code: errorCodeOf(e) });
      });
  }, [orderId]);

  /** Re-read without replacing the screen with a spinner; a failure keeps the last good order. */
  const refresh = React.useCallback(() => {
    getOrder(orderId)
      .then((order) => {
        if (alive.current && order) setState({ kind: 'ready', order });
      })
      .catch(() => undefined);
  }, [orderId]);

  React.useEffect(() => load(), [load]);

  const current = state.kind === 'ready' ? state.order.state : null;
  const terminal = current !== null && TERMINAL.has(current);

  // Realtime: an order event, or the tracking projection moving to another state, re-reads it.
  const trackedState = live.tracking?.state ?? null;
  React.useEffect(() => {
    if (live.orderEvents > 0) refresh();
  }, [live.orderEvents, refresh]);
  React.useEffect(() => {
    if (trackedState && current && trackedState !== current) refresh();
  }, [trackedState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fallback: with the socket down, re-read the order every 15 s until it is finished.
  React.useEffect(() => {
    if (current === null || terminal || live.link === 'live') return;
    const timer = setInterval(refresh, ORDER_POLL_MS);
    return () => clearInterval(timer);
  }, [current, terminal, live.link, refresh]);

  const onWindowClosed = React.useCallback(() => {
    setNotice('window-closed');
    refresh();
  }, [refresh]);

  const title = state.kind === 'ready' ? `Order ${state.order.code}` : 'Your order';
  const subtitle =
    state.kind === 'ready'
      ? WAITING.has(state.order.state) && state.order.placed_at
        ? `${state.order.restaurant?.name ?? ''} · placed ${clock(state.order.placed_at)}`
        : state.order.restaurant?.name
      : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.base }}>
      <AppBar
        tone="cream"
        title={title}
        subtitle={subtitle}
        back={{ onPress: onLeave, previousTitle: 'Orders' }}
        loading={state.kind === 'loading'}
        isPageHeading={false}
      />

      {state.kind === 'loading' ? (
        <LoadingBody />
      ) : state.kind === 'error' ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: 16 }}>
          <ErrorState
            errorCode={state.code}
            title="We couldn't load this order"
            description="This is a problem loading the page. It doesn't change your order. We'll let you know if anything changes."
            onRetry={load}
          />
        </View>
      ) : state.kind === 'empty' ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: 16 }}>
          <EmptyState
            title="We can't find this order"
            description="Your orders are all in Orders."
            primaryAction={{ label: 'Go to Orders', onPress: () => nav.reset({ name: 'orders' }) }}
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: 24 + insets.bottom,
            gap: 16,
          }}
        >
          {notice === 'cancelled' && state.order.state === 'CANCELLED' ? (
            <Notice
              testID="CancelNotice"
              title="Order cancelled. You were not charged."
              body="The restaurant hadn't accepted it, so the hold on your card was released, not charged."
            />
          ) : notice === 'window-closed' ? (
            <Notice
              testID="CancelNotice"
              title="The restaurant has already started your order"
              body={`It can no longer be cancelled in the app. To ask about it, contact support with order code ${state.order.code}.`}
            />
          ) : null}

          <OrderBody
            order={state.order}
            tracking={live.tracking}
            live={live}
            onCancelled={(order) => {
              setNotice('cancelled');
              setState({ kind: 'ready', order });
            }}
            onWindowClosed={onWindowClosed}
            onBrowse={() => nav.reset({ name: 'discovery' })}
            onOrders={() => nav.reset({ name: 'orders' })}
          />
        </ScrollView>
      )}
      <CustomerTabBar active="orders" />
    </View>
  );
}

function LoadingBody(): React.ReactElement {
  return (
    <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 8, gap: 12 }} aria-busy>
      <Skeleton variant="text" width={180} height={18} />
      <Skeleton variant="text" width={230} height={36} />
      <Skeleton variant="rect" height={200} />
      <StatusTimeline audience="customer" state="CREATED" orientation="compact" loading />
      <Skeleton variant="rect" height={88} />
    </View>
  );
}

function OrderBody({
  order,
  tracking,
  live,
  onCancelled,
  onWindowClosed,
  onBrowse,
  onOrders,
}: {
  order: Order;
  tracking: Tracking | null;
  live: ReturnType<typeof useLiveTracking>;
  onCancelled: (order: Order) => void;
  onWindowClosed: () => void;
  onBrowse: () => void;
  onOrders: () => void;
}): React.ReactElement {
  const s = order.state;
  // The REST tracking projection may be for an older state; only trust its timeline and ETA
  // while it agrees with the order.
  const t = tracking && tracking.state === s ? tracking : null;
  const timeline = (
    <StatusTimeline
      audience="customer"
      state={s}
      orientation="compact"
      transitions={t?.timeline ?? undefined}
      estimatedAt={ON_ITS_WAY.has(s) ? (t?.eta_at ?? order.eta_at ?? null) : null}
    />
  );

  if (OUTCOME.has(s)) return <Outcome order={order} onBrowse={onBrowse} onOrders={onOrders} />;

  if (s === 'DISPUTED' || s === 'RESOLVED') {
    return (
      <>
        <Heading
          label={s === 'DISPUTED' ? 'Under review' : 'Resolved'}
          big={s === 'DISPUTED' ? "We're looking into this order" : 'This order is resolved'}
        />
        <Body>
          {s === 'DISPUTED'
            ? "Our support team has your report. We'll message you when there's an outcome."
            : 'Support has closed your report. Any refund shows on your receipt.'}
        </Body>
        {timeline}
        <RestaurantCard order={order} showHalal={false} amountLabel="Order total" />
        <OrderReceipt key={s} orderId={order.id} />
      </>
    );
  }

  if (DELIVERED.has(s)) {
    const at = clock(order.delivered_at);
    return (
      <>
        {s === 'COMPLETED' ? (
          <Heading label={at ? `Delivered at ${at}` : 'Delivered'} big="Order complete" />
        ) : (
          <Heading label="Delivered" big={at ? `At ${at}` : 'Your food is here'} />
        )}
        {timeline}
        <RestaurantCard order={order} showHalal={false} amountLabel="Charged" />
        {s === 'COMPLETED' ? (
          // Keyed on state so the receipt reloads when a polled DELIVERED order completes.
          <OrderReceipt key={s} orderId={order.id} />
        ) : (
          <Body>We'll add your receipt here when the order is complete, and let you know.</Body>
        )}
      </>
    );
  }

  if (WAITING.has(s)) {
    const name = order.restaurant?.name ?? 'The restaurant';
    return (
      <>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <HeadingText>{`Waiting for ${name} to accept`}</HeadingText>
          </View>
          <LinkBadge link={live.link} updatedAtMs={live.updatedAtMs} />
        </View>
        <Body>
          {s === 'CREATED'
            ? `Placing a hold on your card. Nothing is charged until ${name} accepts.`
            : "Your card is authorised, not charged. If they don't accept in time, the hold is released."}
        </Body>
        {s === 'RESTAURANT_PENDING' && order.deadline_at ? (
          <ReplyBy name={name} since={order.state_since ?? null} deadline={order.deadline_at} />
        ) : null}
        {timeline}
        <RestaurantCard order={order} showHalal amountLabel="Total" />
        <ItemsCard order={order} />
        {order.can_cancel !== false ? (
          <View style={{ gap: 8 }}>
            <CancelOrder orderId={order.id} onCancelled={onCancelled} onWindowClosed={onWindowClosed} />
            <Body center>Free to cancel until the restaurant accepts.</Body>
          </View>
        ) : null}
      </>
    );
  }

  // PREPARING, READY_FOR_PICKUP, PICKED_UP, ARRIVED (and any state this build does not know,
  // which StatusTimeline reports and draws neutrally).
  const word =
    s === 'PREPARING'
      ? 'Being prepared'
      : s === 'READY_FOR_PICKUP'
        ? 'Ready'
        : s === 'ARRIVED'
          ? 'Your rider is here'
          : 'On the way';
  const eta = etaWindow(t?.eta_at ?? order.eta_at ?? null, t?.eta_window_minutes ?? null);
  const rider = t?.rider ?? order.rider ?? null;
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Heading label={eta ? `${word} · Arriving` : word} big={eta ?? word} inline />
        </View>
        <LinkBadge link={live.link} updatedAtMs={live.updatedAtMs} />
      </View>
      {RIDER_ON_MAP.has(s) ? <TrackingMapView live={live} showEta={false} /> : null}
      {timeline}
      <RestaurantCard order={order} showHalal amountLabel={null} />
      {rider ? (
        <RiderCard rider={rider} state={s} restaurantName={order.restaurant?.name ?? null} />
      ) : s === 'READY_FOR_PICKUP' ? (
        <Card variant="outlined" padding={16}>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Icon name="search" size={24} />
            <View style={{ flex: 1, gap: 4 }}>
              <LabelText>Your food is ready. Finding a rider</LabelText>
              <Body>
                {`We're offering your order to riders near ${order.restaurant?.name ?? 'the restaurant'}. You'll see who is bringing it here.`}
              </Body>
            </View>
          </View>
        </Card>
      ) : null}
      {s === 'PREPARING' ? <ChargedCard order={order} /> : null}
      <ItemsCard order={order} />
    </>
  );
}

// ─── Pieces ────────────────────────────────────────────────────────────────────────────────

function HeadingText({ children }: { children: string }): React.ReactElement {
  const theme = useTheme();
  const style = useTypeStyle('heading.xl');
  return (
    <Text accessibilityRole="header" style={[style, { color: theme.color.text.primary }]}>
      {children}
    </Text>
  );
}

function LabelText({ children }: { children: string }): React.ReactElement {
  const theme = useTheme();
  const style = useTypeStyle('label.lg');
  return <Text style={[style, { color: theme.color.text.primary }]}>{children}</Text>;
}

function Body({ children, center = false }: { children: string; center?: boolean }): React.ReactElement {
  const theme = useTheme();
  const style = useTypeStyle('body.md');
  return (
    <Text style={[style, { color: theme.color.text.secondary }, center ? { textAlign: 'center' } : null]}>
      {children}
    </Text>
  );
}

/** "Being prepared · Arriving" over "7:14–7:24 pm", read as one heading. */
function Heading({
  label,
  big,
  inline = false,
}: {
  label: string;
  big: string;
  inline?: boolean;
}): React.ReactElement {
  const theme = useTheme();
  const small = useTypeStyle('label.lg');
  const display = useTypeStyle('display.md');
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${label}, ${big}`}
      style={{ gap: inline ? 2 : 4 }}
    >
      <Text style={[small, { color: theme.color.text.secondary }]}>{label}</Text>
      <Text style={[display, { color: theme.color.text.primary, fontVariant: ['tabular-nums'] }]}>
        {big}
      </Text>
    </View>
  );
}

function LinkBadge({
  link,
  updatedAtMs,
}: {
  link: 'live' | 'polling';
  updatedAtMs: number | null;
}): React.ReactElement | null {
  if (link === 'live') return <Badge label="Live" variant="info" style="dot" size="md" />;
  if (updatedAtMs === null) return null;
  const at = clock(new Date(updatedAtMs).toISOString());
  return at ? <Badge label={`Updated ${at}`} variant="neutral" style="dot" size="md" /> : null;
}

/**
 * The one timer while the restaurant decides: a neutral bar from when the order reached the
 * restaurant to `deadline_at`, and the absolute time. No m:ss, no warning or danger colour.
 */
function ReplyBy({
  name,
  since,
  deadline,
}: {
  name: string;
  since: string | null;
  deadline: string;
}): React.ReactElement {
  const theme = useTheme();
  const label = useTypeStyle('label.lg');
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);
  const end = Date.parse(deadline);
  const start = since ? Date.parse(since) : NaN;
  const span = end - start;
  const fraction =
    Number.isFinite(span) && span > 0 ? Math.min(1, Math.max(0, (now - start) / span)) : null;
  const at = clock(deadline);
  return (
    <View style={{ gap: 8 }} testID="ReplyBy">
      {fraction !== null ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            height: 8,
            borderRadius: 4,
            overflow: 'hidden',
            backgroundColor: theme.color.surface.sunken,
          }}
        >
          <View
            style={{
              width: `${Math.round(fraction * 100)}%`,
              height: 8,
              borderRadius: 4,
              backgroundColor: theme.color.border.strong,
            }}
          />
        </View>
      ) : null}
      {at ? <Text style={[label, { color: theme.color.text.primary }]}>{`${name} replies by ${at}`}</Text> : null}
    </View>
  );
}

function RestaurantCard({
  order,
  showHalal,
  amountLabel,
}: {
  order: Order;
  showHalal: boolean;
  amountLabel: string | null;
}): React.ReactElement {
  const theme = useTheme();
  const small = useTypeStyle('body.sm');
  return (
    <Card variant="outlined" padding={16}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1, gap: 6 }}>
          <LabelText>{order.restaurant?.name ?? 'Restaurant'}</LabelText>
          {showHalal ? (
            <HalalBadge
              state={order.restaurant?.halal?.display_state}
              size="sm"
              surface="card"
              restaurantId={order.restaurant?.id}
            />
          ) : null}
        </View>
        {amountLabel ? (
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <Text style={[small, { color: theme.color.text.secondary }]}>{amountLabel}</Text>
            <MoneyAmount value={order.money?.total_cents} />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

function MoneyAmount({ value }: { value: unknown }): React.ReactElement | null {
  // A missing amount prints nothing, never a throw.
  const amount = safeCents(value);
  return amount === null ? null : <Price cents={amount} size="md" />;
}

function ChargedCard({ order }: { order: Order }): React.ReactElement {
  const accepted = clock(order.accepted_at);
  const name = order.restaurant?.name ?? 'The restaurant';
  return (
    <SectionCard>
      <MoneyRow
        label={accepted ? `${name} accepted at ${accepted}. Your card was charged` : 'Your card was charged'}
        value={order.money?.total_cents}
      />
      <Body>You can't cancel now the kitchen has started. Contact support if something is wrong.</Body>
    </SectionCard>
  );
}

function ItemsCard({ order }: { order: Order }): React.ReactElement | null {
  const lines = order.lines ?? [];
  if (lines.length === 0) return null;
  const m = order.money;
  return (
    <SectionCard title="Your order" testID="Tracking-items">
      {lines.map((line, i) => (
        <ItemRow
          key={`${line.line_no}-${i}`}
          quantity={line.quantity}
          name={line.name}
          options={pricedLineOptions(line)}
          request={requestText(line.special_request)}
          amount={line.line_total_cents}
        />
      ))}
      {m ? (
        <View style={{ gap: 4, marginTop: 8 }}>
          <MoneyRow label="Items subtotal" value={m.subtotal_cents} />
          {m.discount_cents ? <MoneyRow label="Discount" value={-Math.abs(m.discount_cents)} /> : null}
          <MoneyRow label="Delivery fee" value={m.delivery_fee_cents} />
          <MoneyRow label="Service fee" value={m.service_fee_cents} />
          {(m.tax_lines ?? []).map((tax, i) => (
            <MoneyRow key={`${tax.statutory_label}-${i}`} label={tax.statutory_label} value={tax.amount_cents} />
          ))}
          {m.tip_cents ? <MoneyRow label="Tip for your rider" value={m.tip_cents} /> : null}
          <MoneyRow label="Total" value={m.total_cents} total />
        </View>
      ) : null}
    </SectionCard>
  );
}

const VEHICLE: Record<string, string> = {
  CAR: 'Car',
  SCOOTER: 'Scooter',
  MOTORCYCLE: 'Motorcycle',
  BICYCLE: 'Bicycle',
  ON_FOOT: 'On foot',
};

function RiderCard({
  rider,
  state,
  restaurantName,
}: {
  rider: Schema['RiderPublicProfile'];
  state: string;
  restaurantName: string | null;
}): React.ReactElement {
  const theme = useTheme();
  const small = useTypeStyle('body.sm');
  const name = `${rider.first_name}${rider.last_initial ? ` ${rider.last_initial}.` : ''}`;
  const line =
    state === 'PICKED_UP' || state === 'ARRIVED'
      ? `${name} is bringing your order`
      : state === 'PREPARING'
        ? `${name} will collect your order`
        : `${name} will bring your order`;
  const hint =
    state === 'PREPARING'
      ? `Heading to ${restaurantName ?? 'the restaurant'} while your food is cooked.`
      : state === 'READY_FOR_PICKUP'
        ? `Heading to the restaurant. You'll see ${rider.first_name} on the map once your food is picked up.`
        : state === 'ARRIVED'
          ? `${rider.first_name} has arrived with your order.`
          : null;
  return (
    <Card variant="outlined" padding={16} testID="Tracking-rider">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar name={name} src={rider.photo_url ?? undefined} size="lg" alt="" />
        <View style={{ flex: 1, gap: 2 }}>
          <LabelText>{line}</LabelText>
          <Text style={[small, { color: theme.color.text.secondary }]}>
            {VEHICLE[rider.vehicle_type] ?? rider.vehicle_type}
          </Text>
          {hint ? <Text style={[small, { color: theme.color.text.secondary }]}>{hint}</Text> : null}
        </View>
      </View>
    </Card>
  );
}

/** Terminal outcomes: what happened, what happened to the money, where next. */
function Outcome({
  order,
  onBrowse,
  onOrders,
}: {
  order: Order;
  onBrowse: () => void;
  onOrders: () => void;
}): React.ReactElement {
  const name = order.restaurant?.name ?? 'The restaurant';
  const accepted = Boolean(order.accepted_at);
  const copy = outcomeCopy(order, name);
  return (
    <>
      <View style={{ gap: 12, paddingTop: 16 }}>
        <Icon name={copy.icon} size={48} />
        <HeadingText>{copy.title}</HeadingText>
        <Body>{copy.body}</Body>
      </View>
      <SectionCard title="Your money" testID="Tracking-money">
        {accepted ? (
          <>
            <MoneyRow label="Charged to your card" value={order.money?.total_cents} />
            <Body>Your refund shows on your receipt and reaches your card in a few days.</Body>
          </>
        ) : (
          <>
            <MoneyRow label="Hold on your card, released" value={order.money?.total_cents} />
            <MoneyRow label="Charged" value={0} total />
            <Body>Your bank may take a few days to remove the hold from your statement.</Body>
          </>
        )}
      </SectionCard>
      <View style={{ gap: 8 }}>
        <Button variant="primary" size="lg" fullWidth onPress={onBrowse}>
          {copy.next}
        </Button>
        <Button variant="ghost" size="md" fullWidth onPress={onOrders}>
          Back to Orders
        </Button>
      </View>
    </>
  );
}

function outcomeCopy(
  order: Order,
  name: string,
): { icon: IconName; title: string; body: string; next: string } {
  if (order.state === 'REJECTED') {
    const why: Record<string, string> = {
      ITEM_UNAVAILABLE: 'Something you ordered has run out.',
      KITCHEN_AT_CAPACITY: 'Their kitchen is too busy right now.',
      CLOSING_SOON: "They're closing soon.",
      EQUIPMENT_FAILURE: 'Their kitchen has an equipment problem.',
      ADDRESS_OUT_OF_RANGE: 'Your address is too far for them.',
    };
    return {
      icon: 'close',
      title: `${name} couldn't take your order`,
      body: `${why[order.reject_reason ?? ''] ?? ''} You weren't charged.`.trim(),
      next: 'Find another restaurant',
    };
  }
  if (order.state === 'FAILED') {
    return {
      icon: 'close',
      title: order.cancel_reason === 'NO_RIDER_FOUND' ? "We couldn't find a rider" : "We couldn't complete this order",
      body: "We're sorry. We cancelled the order, and anything charged is refunded.",
      next: 'Find something to eat',
    };
  }
  switch (order.cancel_reason) {
    case 'RESTAURANT_TIMEOUT':
      return {
        icon: 'clock',
        title: `${name} didn't respond in time`,
        body: "They didn't accept in time, so we cancelled your order.",
        next: 'Find another restaurant',
      };
    case 'NO_RIDER_FOUND':
      return {
        icon: 'close',
        title: "We couldn't find a rider",
        body: 'Your food was ready, but no rider could collect it. We cancelled the order. We’re sorry.',
        next: 'Find something to eat',
      };
    case 'PAYMENT_EXPIRED':
      return {
        icon: 'clock',
        title: 'Your order was closed',
        body: 'The payment wasn’t completed in time, so we closed the order. Nothing was charged.',
        next: 'Find something to eat',
      };
    case 'CUSTOMER_CANCELLED':
      return {
        icon: 'close',
        title: 'You cancelled this order',
        body: 'The restaurant hadn’t accepted it, so nothing was charged.',
        next: 'Find something to eat',
      };
    default:
      return {
        icon: 'close',
        title: 'This order was cancelled',
        body: 'Anything charged is refunded to your card.',
        next: 'Find something to eat',
      };
  }
}

/** "7:14–7:24 pm" from the server's ETA and window; null without an ETA. */
function etaWindow(etaAt: string | null, windowMinutes: number | null): string | null {
  if (!etaAt) return null;
  const from = clock(etaAt);
  if (!from) return null;
  if (!windowMinutes) return from;
  const toMs = Date.parse(etaAt) + windowMinutes * 60_000;
  const to = clock(new Date(toMs).toISOString());
  if (!to) return from;
  // "7:14 pm–7:24 pm" reads better as "7:14–7:24 pm" when both share the half of the day.
  const fromMeridiem = from.slice(-2);
  return fromMeridiem === to.slice(-2) ? `${from.slice(0, -3)}–${to}` : `${from}–${to}`;
}
