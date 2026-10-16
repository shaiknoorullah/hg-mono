/**
 * Order tracking: the one page for an order that is on its way (the waiting and live-tracking
 * screens of the customer redesign, tracked in issue #656).
 *
 * Two layouts share the route, chosen by the order's state:
 *
 * - **Waiting** (CREATED, AUTHORIZED, RESTAURANT_PENDING): "Waiting for {restaurant} to accept",
 *   one line that changes with the state, a neutral reply-by bar driven by the server's
 *   `deadline_at` (an absolute time, never a countdown number, never an urgent colour), the
 *   timeline, and the restaurant with its halal badge and the total.
 * - **Live** (PREPARING, READY_FOR_PICKUP, PICKED_UP, ARRIVED): the arrival window as the headline,
 *   the map, the timeline, the restaurant and halal row, the rider or the search for one, the
 *   delivery code at a met handover, and an open report.
 *
 * Every other state (delivered, finished, ended, disputed) belongs to the delivered and outcome
 * screens, which are not built yet: those states hand over to the legacy tracking screen through
 * the legacy bridge, so nothing regresses (design plan, route-by-route fallback).
 *
 * Rules this page holds:
 * - Money is a server field through Price; the page adds and subtracts nothing and sends nothing.
 * - Halal comes only from `restaurant.halal` through `presentHalal`. A missing or partial record
 *   draws no badge and no placeholder; a lapsed certificate is the cool-slate badge beside a
 *   neutral notice; a revoked one draws no badge and a neutral notice. Never red.
 * - The delivery code shows only while the order read carries it, and only for a met handover.
 * - Nothing here moves focus on a refresh: the page re-reads every 15 s without announcing.
 * - The timeline carries the one "checking for updates" message (connection `polling`); the page
 *   adds only the time it was last read.
 * - Offline (or a failed re-read) keeps the last copy on screen, says when it was current, and
 *   drops the halal badge once that copy is more than 15 minutes old.
 *
 * Not on this page yet (each is a separate surface, filed as a follow-up): the cancel sheet, the Get
 * help sheet, payment recovery, and live socket updates (the page polls, which the contract allows).
 */
import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Schema } from '@hg/api-client';

import {
  AppBar,
  Avatar,
  Badge,
  Banner,
  Card,
  EmptyState,
  ErrorState,
  HalalBadge,
  Icon,
  MapView,
  Price,
  ProgressBar,
  Skeleton,
  StatusTimeline,
  useTheme,
  useTypeStyle,
} from '../ds';
import { LegacyBridge } from '../navigation/LegacyBridge';
import { TrackingScreen as LegacyTrackingScreen } from '../../screens/TrackingScreen';
import { useConnectivity } from '../lib/connectivity';
import { orderShowsHalal, presentHalal } from '../lib/halal';
import { useNow, useServerNow } from '../lib/now';
import { formatTime } from '../lib/time';
import { useNav } from '../navigation/context';
import { cardName } from '../orders/format';
import type { TrackedOrder } from './trackingApi';
import {
  SLOW_AUTHORIZED_MS,
  RIDER_FIX_STALE_MS,
  deliveryCodeOf,
  dispatchNoticeOf,
  etaOf,
  headlineOf,
  instructionWords,
  isLiveLayout,
  isWaitingLayout,
  meetOf,
  openReportOf,
  riderCardOf,
  riderNameOf,
  spokenCode,
  vehicleWord,
  type Meet,
} from './trackingView';
import { useTrackedOrder } from './useTrackedOrder';

export const TRACKING_COPY = {
  loading: 'Loading your order',
  errorTitle: "We couldn't load this order",
  errorBody: "This is a problem loading the page. It doesn't change your order. We'll let you know if anything changes.",
  notFoundTitle: 'No order on the way',
  notFoundBody: 'This order has finished, or the link is out of date. Your past orders and receipts are in Orders.',
  seeOrders: 'See your orders',
  findRestaurant: 'Find a restaurant',
  backToOrders: 'Back to Orders',
  tryAgain: 'Try again',
  total: 'Total',
  mapLabel: 'Map of your delivery',
} as const;

const SHOWS_BOTTOM_CARDS: ReadonlySet<string> = new Set(['PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'ARRIVED']);

export function TrackingScreen({ orderId, pollMs }: { orderId: string; pollMs?: number }): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const { state, reload } = useTrackedOrder(orderId, pollMs);
  const { online } = useConnectivity();

  const ready = state.kind === 'ready' ? state : null;
  const order = ready?.data.order ?? null;

  // A state this page does not draw: hand over to the legacy screen, whole (it brings its own bar).
  if (order && !isWaitingLayout(order.state) && !isLiveLayout(order.state)) {
    return (
      <LegacyBridge nav={nav} route={{ name: 'tracking', orderId }}>
        <LegacyTrackingScreen orderId={orderId} />
      </LegacyBridge>
    );
  }

  const back = { onPress: nav.back, previousTitle: 'Orders' };
  let body: React.ReactElement;
  let title = 'Order';
  let subtitle: string | undefined;

  if (state.kind === 'loading') {
    body = <TrackingSkeleton />;
  } else if (state.kind === 'error') {
    body =
      state.status === 404 ? (
        <View style={styles.center}>
          <EmptyState
            variant="page"
            headingLevel={1}
            autoFocus
            title={TRACKING_COPY.notFoundTitle}
            description={TRACKING_COPY.notFoundBody}
            primaryAction={{ label: TRACKING_COPY.seeOrders, onPress: () => nav.selectTab('orders') }}
            secondaryAction={{ label: TRACKING_COPY.findRestaurant, onPress: () => nav.selectTab('home') }}
            testID="Tracking-notFound"
          />
        </View>
      ) : (
        <View style={styles.center}>
          <ErrorState
            variant="page"
            errorCode={state.code}
            title={TRACKING_COPY.errorTitle}
            description={TRACKING_COPY.errorBody}
            onRetry={reload}
            autoFocus
            testID="Tracking-error"
          />
        </View>
      );
  } else {
    title = `Order ${ready!.data.order.code}`;
    subtitle = ready!.data.order.restaurant.name;
    body = <TrackingBody data={ready!.data} asOf={ready!.asOf} failed={ready!.failed || !online} online={online} onRetry={reload} />;
  }

  return (
    <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="TrackingScreen">
      <AppBar title={title} subtitle={subtitle} back={back} backLabel={TRACKING_COPY.backToOrders} tone="cream" isPageHeading={false} />
      {body}
    </View>
  );
}

function TrackingSkeleton(): React.ReactElement {
  return (
    <View style={styles.page} testID="Tracking-loading" accessibilityLabel={TRACKING_COPY.loading} aria-busy>
      <Skeleton variant="text" lines={2} />
      <StatusTimeline audience="customer" state="" orientation="compact" loading />
      <Card variant="outlined">
        <Skeleton variant="text" lines={2} />
      </Card>
    </View>
  );
}

/* ----------------------------------------------------------------------------------- body */

interface BodyProps {
  data: TrackedOrder;
  asOf: number;
  /** The last re-read did not get through, or the phone is offline. */
  failed: boolean;
  online: boolean;
  onRetry: () => void;
}

function TrackingBody({ data, asOf, failed, online, onRetry }: BodyProps): React.ReactElement {
  const theme = useTheme();
  // `now` is the phone's clock, for what the phone itself timed (the halal cache). Everything compared
  // with a time the server sent (the reply-by deadline, how long ago a fix was) uses `serverNow`.
  const now = useNow(5_000);
  const serverNow = useServerNow(5_000);
  const { order, tracking, payment } = data;
  const waiting = isWaitingLayout(order.state);
  const restaurant = order.restaurant;

  const riderProfile = tracking?.rider ?? order.rider ?? null;
  const rider = riderNameOf(riderProfile);
  const dispatchState = tracking?.dispatch_state ?? order.dispatch_state ?? null;
  const meet = meetOf(order.delivery_instructions);
  const eta = etaOf(tracking?.eta_at ?? order.eta_at, tracking?.eta_window_minutes);
  const stale = failed;

  const headline = headlineOf({
    state: order.state,
    dispatchState,
    eta,
    deadlineAt: order.deadline_at,
    stale,
    riderName: rider?.first ?? null,
    meet,
  });
  const card = cardName(payment ?? {});
  const authorised = payment?.amount_authorized_cents ?? order.money.total_cents;

  const offlineBanner = failed ? (
    <Banner
      variant="neutral"
      icon={<Icon name="info" size={22} color={theme.color.text.secondary} />}
      title={
        online
          ? `We couldn't update this just now. This is what we knew at ${formatTime(asOf)}.`
          : `You're offline. This is what we knew at ${formatTime(asOf)}.`
      }
      action={{ label: TRACKING_COPY.tryAgain, onPress: onRetry, testID: 'Tracking-retry' }}
      testID="Tracking-offline"
    />
  ) : null;

  return (
    <ScrollView contentContainerStyle={styles.page} testID="Tracking-body">
      {offlineBanner}
      {waiting ? (
        <WaitingTop data={data} authorised={authorised} cardLabel={card} now={serverNow} />
      ) : (
        <LiveTop
          headline={headline}
          failed={failed}
          asOf={asOf}
          data={data}
          meet={meet}
          riderFirst={rider?.first ?? null}
          now={serverNow}
        />
      )}

      <StatusTimeline
        audience="customer"
        state={order.state}
        transitions={tracking?.timeline}
        estimatedAt={waiting ? null : (tracking?.eta_at ?? order.eta_at ?? null)}
        deadlineAt={order.state === 'PREPARING' ? order.deadline_at : null}
        connection="polling"
        now={serverNow}
        testID="Tracking-timeline"
      />

      <RestaurantCard data={data} asOf={asOf} online={online && !failed} now={now} waiting={waiting} />

      {SHOWS_BOTTOM_CARDS.has(order.state) ? (
        <LiveBottom data={data} rider={rider} vehicle={vehicleWord(riderProfile?.vehicle_type)} cardLabel={card} />
      ) : null}

    </ScrollView>
  );
}

/* ------------------------------------------------------------------------------- waiting */

function WaitingTop({
  data,
  authorised,
  cardLabel,
  now,
}: {
  data: TrackedOrder;
  authorised: Schema['Cents'];
  cardLabel: string | null;
  now: number;
}): React.ReactElement {
  const theme = useTheme();
  const display = useTypeStyle('display.md');
  const body = useTypeStyle('body.md');
  const label = useTypeStyle('label.lg');
  const { order, responseWindowSeconds } = data;
  const name = order.restaurant.name;
  const secondary = { color: theme.color.text.secondary };

  const sinceMs = order.state_since ? now - Date.parse(order.state_since) : 0;
  const slow = order.state === 'AUTHORIZED' && sinceMs > SLOW_AUTHORIZED_MS;
  const deadline = order.deadline_at ? Date.parse(order.deadline_at) : null;
  const deadlinePassed = deadline !== null && now >= deadline;

  let line: React.ReactNode;
  if (order.state === 'CREATED') {
    line = `Placing a hold on your ${cardLabel ?? 'card'}. Nothing is charged until ${name} accepts.`;
  } else if (order.state === 'AUTHORIZED') {
    line = slow ? (
      <>Still sending your order to {name}. Your card has a hold for <Price cents={authorised} size="sm" />, nothing is charged.</>
    ) : (
      <>Hold placed on your {cardLabel ?? 'card'} for <Price cents={authorised} size="sm" />. Sending your order to {name}.</>
    );
  } else if (deadlinePassed) {
    line = `Checking with ${name}. If they haven't accepted, the hold is released and you pay nothing.`;
  } else {
    line = "Your card is authorised, not charged. If they don't accept in time, the hold is released.";
  }

  // The bar is the only timer: its fill is how much of the window has passed, from the server's
  // deadline; the absolute time is the only number said or shown.
  let bar: React.ReactElement | null = null;
  if (order.state === 'RESTAURANT_PENDING' && deadline !== null) {
    const windowS = responseWindowSeconds && responseWindowSeconds > 0 ? responseWindowSeconds : null;
    const elapsed = windowS && !deadlinePassed ? Math.min(windowS, Math.max(0, Math.floor(windowS - (deadline - now) / 1000))) : null;
    const by = formatTime(order.deadline_at!);
    bar = (
      <View style={styles.gap8} testID="Tracking-waitBar">
        {deadlinePassed ? null : <Text style={[label, { color: theme.color.text.primary }]}>{`${name} replies by ${by}`}</Text>}
        <ProgressBar
          value={elapsed}
          max={windowS ?? undefined}
          indeterminate={elapsed === null}
          label={`Waiting for ${name} to reply`}
          valueText={deadlinePassed ? undefined : `${name} replies by ${by}`}
        />
      </View>
    );
  }

  return (
    <View style={styles.gap12}>
      <View style={styles.gap8}>
        <Text accessibilityRole="header" aria-level={1} style={[display, { color: theme.color.text.primary }]} testID="Tracking-h1">
          {`Waiting for ${name} to accept`}
        </Text>
        <Text style={[body, secondary]} testID="Tracking-waitLine">
          {line}
        </Text>
      </View>
      {bar}
    </View>
  );
}

/* ---------------------------------------------------------------------------------- live */

function LiveTop({
  headline,
  failed,
  asOf,
  data,
  meet,
  riderFirst,
  now,
}: {
  headline: ReturnType<typeof headlineOf>;
  failed: boolean;
  asOf: number;
  data: TrackedOrder;
  meet: Meet;
  riderFirst: string | null;
  now: number;
}): React.ReactElement {
  const theme = useTheme();
  const display = useTypeStyle('display.md');
  const labelLg = useTypeStyle('label.lg');
  const bodySm = useTypeStyle('body.sm');
  const { order, tracking } = data;
  const arrived = order.state === 'ARRIVED';
  const secondary = { color: theme.color.text.secondary };

  const code = deliveryCodeOf(tracking?.delivery_code ?? order.delivery_code);
  const met = meet !== 'leave';
  const who = riderFirst ?? 'your rider';

  return (
    <View style={styles.gap12}>
      <View style={styles.rowTop}>
        <View style={[styles.flex1, styles.gap2]} accessible accessibilityRole="header" aria-level={1} accessibilityLabel={headline.spoken} testID="Tracking-h1">
          {headline.overline ? (
            <Text aria-hidden style={[labelLg, secondary]}>{headline.overline}</Text>
          ) : null}
          <Text aria-hidden style={[display, { color: theme.color.text.primary }]}>{headline.display}</Text>
          {headline.secondary ? <Text style={[bodySm, secondary]}>{headline.secondary}</Text> : null}
        </View>
        {failed ? null : <Badge label={`Updated ${formatTime(asOf)}`} variant="neutral" size="md" testID="Tracking-updated" />}
      </View>

      {arrived ? (
        <View style={styles.gap12}>
          {met ? (
            <>
              <Text style={[bodySm, secondary]}>
                {meet === 'lobby'
                  ? `You asked to meet in the lobby. Go down to meet ${riderFirst ?? 'your rider'} and read out this code.`
                  : `You asked to meet at the door.`}
              </Text>
              {code ? (
                <DeliveryCode code={code} caption={`Read this code to ${who}${meet === 'lobby' ? ' in the lobby' : ''}`} />
              ) : (
                <Text style={[labelLg, { color: theme.color.text.primary }]} testID="Tracking-codeLocked">
                  HalalGoes support will confirm the handover with you.
                </Text>
              )}
            </>
          ) : (
            <Text style={[bodySm, secondary]} testID="Tracking-leaveAtDoor">
              {order.delivery_instructions?.includes('DO_NOT_RING_BELL')
                ? 'You asked for it to be left at the door, without ringing the bell. No code is needed.'
                : 'You asked for it to be left at the door. No code is needed.'}
            </Text>
          )}
        </View>
      ) : null}

      <TrackingMap data={data} now={now} />
    </View>
  );
}

function DeliveryCode({ code, caption }: { code: string; caption: string }): React.ReactElement {
  const theme = useTheme();
  const label = useTypeStyle('label.lg');
  const digits = useTypeStyle('display.lg');
  return (
    <Card variant="outlined" testID="Tracking-code">
      {/* The digits are hidden from a screen reader; the label reads them one by one. */}
      <View accessible accessibilityLabel={`${caption}. ${spokenCode(code)}`} style={styles.gap6}>
        <Text aria-hidden style={[label, { color: theme.color.text.secondary }]}>{caption}</Text>
        <Text aria-hidden style={[digits, styles.digits, { color: theme.color.text.primary }]} testID="Tracking-codeDigits">
          {code}
        </Text>
      </View>
    </Card>
  );
}

function TrackingMap({ data, now }: { data: TrackedOrder; now: number }): React.ReactElement {
  const { order, tracking } = data;
  const rider = tracking?.rider_location ?? null;
  // The rider's position before pickup is never shown to the customer; the server sends none, and
  // the page would not draw one if it did.
  const showRider = !!rider && (order.state === 'PICKED_UP' || order.state === 'ARRIVED');
  const fixAge = showRider && rider.recorded_at ? now - Date.parse(rider.recorded_at) : 0;
  const fixStale = showRider && fixAge > RIDER_FIX_STALE_MS;
  const to = order.delivery_address;
  const toText = to ? [to.line1, to.line2].filter((s) => s && s.trim()).join(', ') : null;
  const eta = etaOf(tracking?.eta_at ?? order.eta_at, tracking?.eta_window_minutes);

  const summary = [
    `From ${order.restaurant.name}.`,
    toText ? `To ${toText}.` : null,
    eta ? `Arriving ${eta.text}.` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <View style={styles.gap8}>
      <MapView
        summary={summary}
        restaurant={tracking?.restaurant_location ?? null}
        customer={tracking?.destination_location ?? null}
        rider={showRider ? { latitude: rider.latitude, longitude: rider.longitude, headingDeg: rider.heading_deg ?? null } : null}
        follow="fit-all"
        state={fixStale ? 'stale' : 'ready'}
        height={order.state === 'PICKED_UP' || order.state === 'ARRIVED' ? 280 : 200}
        testID="Tracking-map"
      />
      {fixStale && rider?.recorded_at ? (
        <Badge
          label={`Rider's location last updated ${formatTime(rider.recorded_at)}`}
          variant="neutral"
          size="md"
          icon={<Icon name="clock" size={14} />}
          testID="Tracking-fixStale"
        />
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------------------ restaurant */

function RestaurantCard({
  data,
  asOf,
  online,
  now,
  waiting,
}: {
  data: TrackedOrder;
  asOf: number;
  online: boolean;
  now: number;
  waiting: boolean;
}): React.ReactElement {
  const theme = useTheme();
  const label = useTypeStyle('label.lg');
  const bodySm = useTypeStyle('body.sm');
  const { order } = data;
  const restaurant = order.restaurant;
  const accepted = !waiting;

  // Before delivery the card carries the badge; the rule that bars it from delivery on lives in
  // `orderShowsHalal`, so this page asks it instead of listing states.
  const halal = orderShowsHalal(order.state) ? presentHalal(restaurant.halal, { online, asOf, now }) : { kind: 'none' as const };
  const revoked = restaurant.halal?.display_state === 'UNVERIFIED';

  return (
    <View style={styles.gap12}>
      {accepted && halal.kind === 'expired' ? (
        <Banner
          variant="neutral"
          icon={<Icon name="info" size={22} color={theme.color.text.secondary} />}
          title={`${restaurant.name}'s halal certificate has lapsed`}
          description="Your order was accepted while their certificate was valid, so it goes ahead as normal. You won't be able to order from them again until it's renewed."
          testID="Tracking-certLapsed"
        />
      ) : null}
      {accepted && revoked && halal.kind === 'none' ? (
        <Banner
          variant="neutral"
          icon={<Icon name="info" size={22} color={theme.color.text.secondary} />}
          title={`${restaurant.name}'s halal certificate is no longer verified by HalalGoes`}
          description="Your order was accepted while it was valid, so it goes ahead."
          testID="Tracking-certRevoked"
        />
      ) : null}

      <Card variant="outlined" radius={16} testID="Tracking-restaurant">
        <View style={styles.rowBetween}>
          <View style={[styles.flex1, styles.gap6]}>
            <Text style={[label, { color: theme.color.text.primary }]}>{restaurant.name}</Text>
            {halal.kind === 'stale' ? (
              <Text style={[bodySm, { color: theme.color.text.secondary }]} testID="Tracking-halalLine">
                Halal status shows again when you&apos;re back online.
              </Text>
            ) : null}
          </View>
          {halal.kind === 'badge' ? (
            <HalalBadge
              state={halal.state}
              surface="card"
              size="sm"
              restaurantId={restaurant.id}
              certifyingBodyName={halal.certifyingBody}
              expiresOn={halal.expiresOn}
              testID="Tracking-halalBadge"
            />
          ) : halal.kind === 'expired' ? (
            <HalalBadge state="EXPIRED" surface="card" size="sm" restaurantId={restaurant.id} testID="Tracking-halalBadge" />
          ) : null}
          {waiting ? (
            <View style={styles.rowBaseline}>
              <Text style={[bodySm, { color: theme.color.text.secondary }]}>{TRACKING_COPY.total}</Text>
              <Price cents={order.money.total_cents} size="sm" testID="Tracking-total" />
            </View>
          ) : null}
        </View>
      </Card>
    </View>
  );
}

/* ------------------------------------------------------------------------- live, lower half */

function LiveBottom({
  data,
  rider,
  vehicle,
  cardLabel,
}: {
  data: TrackedOrder;
  rider: ReturnType<typeof riderNameOf>;
  vehicle: string | null;
  cardLabel: string | null;
}): React.ReactElement {
  const theme = useTheme();
  const label = useTypeStyle('label.lg');
  const bodyMd = useTypeStyle('body.md');
  const bodySm = useTypeStyle('body.sm');
  const { order, tracking, payment, refunds } = data;
  const dispatchState = tracking?.dispatch_state ?? order.dispatch_state ?? null;
  const secondary = { color: theme.color.text.secondary };
  const primary = { color: theme.color.text.primary };

  const notice = dispatchNoticeOf(order.state, dispatchState, order.deadline_at);
  const riderCard = riderCardOf({ state: order.state, dispatchState, restaurantName: order.restaurant.name, rider });
  const report = openReportOf(refunds);
  const captured = payment?.amount_captured_cents ?? null;
  const showCharged =
    order.state === 'PREPARING' && !riderCard && !!order.accepted_at && captured !== null && captured > 0;
  const instructions = order.state === 'ARRIVED' ? instructionWords(order.delivery_instructions) : '';

  return (
    <View style={styles.gap12}>
      {notice ? (
        <Banner
          variant="neutral"
          icon={<Icon name={notice.icon} size={22} color={theme.color.text.secondary} />}
          title={notice.title}
          description={notice.description}
          testID={`Tracking-${notice.id}`}
        />
      ) : null}

      {riderCard ? (
        <Card variant="outlined" radius={16} testID={riderCard.kind === 'finding' ? 'Tracking-findingRider' : 'Tracking-rider'}>
          <View style={styles.row}>
            {riderCard.kind === 'finding' ? (
              <Icon name="search" size={24} color={theme.color.text.secondary} />
            ) : rider ? (
              <Avatar name={rider.full} size="md" alt="" />
            ) : null}
            <View style={[styles.flex1, styles.gap2]}>
              <Text style={[label, primary]}>{riderCard.title}</Text>
              {riderCard.kind === 'rider' && vehicle ? <Text style={[bodySm, secondary]}>{vehicle}</Text> : null}
              {riderCard.body ? <Text style={[bodySm, secondary]}>{riderCard.body}</Text> : null}
            </View>
          </View>
        </Card>
      ) : null}

      {showCharged ? (
        <Card variant="outlined" radius={16} testID="Tracking-charged">
          <View style={styles.gap8}>
            <View style={styles.rowBetweenBaseline}>
              <Text style={[bodyMd, primary, styles.flex1]}>
                {`${order.restaurant.name} accepted at ${formatTime(order.accepted_at!)}. Your ${cardLabel ?? 'card'} was charged`}
              </Text>
              <Price cents={captured!} size="md" />
            </View>
            <Text style={[bodySm, secondary]}>You can&apos;t cancel now the kitchen has started.</Text>
          </View>
        </Card>
      ) : null}

      {instructions ? (
        <Card variant="outlined" radius={16} testID="Tracking-instructions">
          <View style={styles.gap6}>
            <Text style={[bodySm, secondary]}>Delivery instructions</Text>
            <Text style={[label, primary]}>{instructions}</Text>
            {order.special_instructions ? <Text style={[bodyMd, secondary]}>{`"${order.special_instructions}"`}</Text> : null}
          </View>
        </Card>
      ) : null}

      {report ? (
        <Card variant="filled" radius={16} testID="Tracking-report">
          <View style={styles.gap6}>
            <View style={styles.rowBetween}>
              <Text style={[label, primary]}>Your report</Text>
              <Badge label="Under review" variant="neutral" size="sm" />
            </View>
            <Text style={[bodyMd, primary]}>{`${report.reason} · Sent ${report.sentAt}`}</Text>
            <Text style={[bodySm, secondary]}>A person is looking at it. Until they decide, your order carries on as normal.</Text>
          </View>
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', padding: 16 },
  page: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24, gap: 12 },
  flex1: { flex: 1 },
  gap2: { gap: 2 },
  gap6: { gap: 6 },
  gap8: { gap: 8 },
  gap12: { gap: 12 },
  digits: { letterSpacing: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowBetweenBaseline: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  rowBaseline: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
});
