/**
 * R17 Offer: the dispatch offer as a full-screen layer over everything (SH canvas, section 2
 * "Offer — 30 seconds, full screen, not dismissable").
 *
 * - Arrives from the dashboard poll (`useRiderDashboard().data.current_offer`) and from
 *   `getCurrentOffer`, polled while the rider is waiting (ONLINE_IDLE) and while an offer is on
 *   screen (so a withdrawn or taken offer ends on its own). Same `offer_id` twice: ignored.
 * - The DS `Sheet variant="full" dismissible={false}`: no close, no swipe, Android Back
 *   swallowed while the offer is live. Results (expired, taken, withdrawn…) stay until "Back to
 *   waiting" or the next offer (no auto-close, WCAG 2.2.1).
 * - Accept sends one `Idempotency-Key` per offer, reused on every retry; a 200 opens the trip
 *   flow (`nav.openFlow('trip', { assignmentId })`; WP4, falling back to the legacy screen until
 *   it merges). Decline is one tap on a reason (`rejectOffer`, `reason_code`), no confirm.
 * - Money only from `earnings.*_cents` through `Price`; rows that are absent or 0 are hidden.
 * - Before accepting, the drop-off is the area only (#312), never a street or a pin on a house.
 */
import * as React from 'react';
import { AccessibilityInfo, BackHandler, Text, View } from 'react-native';
import { cents, idempotencyKey } from '@hg/api-client';

import { useLiveFix } from '../../location';
import { Banner, Button, Icon, MapView, Price, Sheet, icon, space, typeStyle, useTheme, type TypeName } from '../ds';
import { useOnline } from '../data/connectivity';
import type { RiderError } from '../data/errors';
import { useApiQuery } from '../data/query';
import { useRiderDashboard } from '../home';
import { useNav } from '../nav/Navigator';
import {
  ACCEPTED_TITLE,
  ALERT,
  BUTTON,
  DECLINE_TITLE,
  FREQUENT_REASONS,
  LABEL,
  MORE_REASONS,
  OFFER_TITLE,
  RESULT,
  acceptedBody,
  clockLabel,
  itemsLabel,
  kmLabel,
  minutesLabel,
  type RejectReason,
  type ResultKind,
} from './copy';
import {
  INITIAL,
  acceptOffer,
  breakdownRows,
  fetchCurrentOffer,
  fullAddress,
  mapSummary,
  offerReducer,
  rejectOffer,
  urgencyOf,
  type DispatchOffer,
  type OfferState,
  type Urgency,
} from './model';
import { offerSignal, stopOfferSignals } from './signals';

/** Faster than the dashboard's 5 s: a 30 s offer must not lose a sixth of its time to the poll. */
export const OFFER_POLL_MS = 3_000;
const TICK_MS = 250;
/** The countdown speaks at these fractions of the time left (SH note). */
const ANNOUNCE_AT = [0.5, 0.25, 0.1] as const;

type Live = Extract<OfferState, { kind: 'live' }>;

export function OfferLayer(): React.ReactElement | null {
  const nav = useNav();
  const dash = useRiderDashboard();
  const online = useOnline();
  const [state, dispatch] = React.useReducer(offerReducer, INITIAL);
  const showing = state.kind === 'live';
  const waiting = dash.mode === 'ONLINE_IDLE' && !dash.onDelivery;

  const polled = useApiQuery('current-offer', fetchCurrentOffer, { enabled: waiting || showing, pollMs: OFFER_POLL_MS });

  // On a delivery the rider is not dispatchable: only follow an offer already on screen.
  const acceptNew = !dash.onDelivery;
  React.useEffect(() => {
    if (polled.updatedAt > 0) dispatch({ type: 'receive', offer: polled.data, now: Date.now(), receivedAt: polled.updatedAt, acceptNew });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polled.updatedAt]);
  React.useEffect(() => {
    // `receivedAt`: the dashboard store is shared, so its answer may be older than this layer.
    if (dash.updatedAt > 0) {
      dispatch({ type: 'receive', offer: dash.data?.current_offer as DispatchOffer | null, now: Date.now(), receivedAt: dash.updatedAt, acceptNew });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dash.updatedAt]);

  // The clock: re-render a few times a second while an offer is live.
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!showing) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      dispatch({ type: 'tick', now: t });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [showing]);

  // One key per offer for accept, one per offer and reason for reject: a retry is the same request.
  const keys = React.useRef(new Map<string, string>());
  const keyFor = (k: string) => {
    let v = keys.current.get(k);
    if (!v) {
      v = idempotencyKey();
      keys.current.set(k, v);
    }
    return v;
  };

  // One request at a time: a second tap that lands before the re-render (a double tap) sends
  // nothing, rather than racing the first into a 409 IDEMPOTENCY_IN_PROGRESS.
  const sending = React.useRef(false);

  const accept = React.useCallback(() => {
    if (state.kind !== 'live' || sending.current || state.step === 'accepting' || state.step === 'declining') return;
    const id = state.offer.offer_id;
    sending.current = true;
    dispatch({ type: 'accept-start' });
    acceptOffer(id, keyFor(`accept:${id}`))
      .then(
        (assignment) => {
          dispatch({ type: 'accept-ok', assignment });
          nav.openFlow('trip', { assignmentId: assignment.id });
        },
        (error) => dispatch({ type: 'accept-fail', error }),
      )
      .finally(() => {
        sending.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, nav]);

  const decline = React.useCallback(
    (reason: RejectReason) => {
      if (state.kind !== 'live' || sending.current || state.step === 'accepting' || state.step === 'declining') return;
      const id = state.offer.offer_id;
      sending.current = true;
      dispatch({ type: 'decline-start', reason });
      rejectOffer(id, reason, keyFor(`reject:${id}:${reason}`))
        .then(
          () => dispatch({ type: 'decline-ok' }),
          (error) => dispatch({ type: 'decline-fail', error }),
        )
        .finally(() => {
          sending.current = false;
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state],
  );

  // SH/OfferConnectionLost: an accept that failed for want of a connection goes again the moment
  // the connection comes back (offline → online), while the time lasts. Only on that change:
  // retrying whenever "online" is true would loop on a failure that did not flip connectivity.
  const retryOnReconnect = state.kind === 'live' && state.step === 'accept-failed' && state.error?.kind === 'offline';
  const wasOnline = React.useRef(online);
  React.useEffect(() => {
    const cameBack = online && !wasOnline.current;
    wasOnline.current = online;
    if (cameBack && retryOnReconnect && state.kind === 'live' && Date.now() < state.deadline) accept();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  /** `toHome`: a result's "Back to waiting" / "Back to Home": re-read the shift and show Home. */
  const close = React.useCallback(
    (toHome: boolean) => {
      dispatch({ type: 'dismiss' });
      if (toHome) {
        void dash.refetch();
        if (nav.tab !== 'home') nav.switchTab('home');
      }
    },
    [dash, nav],
  );

  useOfferSignals(state, now);
  useBackWhileShowing(state, close);

  if (state.kind === 'none') return null;
  if (state.kind === 'result') return <ResultSheet result={state.result} onDone={close} />;
  if (state.kind === 'accepted') {
    return (
      <AcceptedSheet
        offer={state.offer}
        address={fullAddress(state.assignment)}
        restaurantAddress={state.assignment.pickup.address}
        onGo={() => close(false)}
      />
    );
  }
  return (
    <LiveOffer
      state={state}
      now={now}
      online={online}
      onAccept={accept}
      onDecline={() => dispatch({ type: 'decline-open' })}
      onKeep={() => dispatch({ type: 'decline-keep' })}
      onMore={() => dispatch({ type: 'decline-more' })}
      onReason={decline}
    />
  );
}

/* ------------------------------------------------------------------ behaviour */

/** Haptics, sound and spoken countdown at the board's moments (SH note "sound, haptics, focus"). */
function useOfferSignals(state: OfferState, now: number): void {
  const liveId = state.kind === 'live' ? state.offer.offer_id : null;
  const step = state.kind === 'live' ? state.step : null;
  const remaining = state.kind === 'live' ? Math.max(0, state.deadline - now) : 0;
  const total = state.kind === 'live' ? state.total : 0;
  const urgency: Urgency | null = state.kind === 'live' ? urgencyOf(remaining, total) : null;

  React.useEffect(() => {
    if (!liveId) return;
    offerSignal('arrive');
    return () => stopOfferSignals();
  }, [liveId]);

  // Any answer stops the repeating arrival alert.
  React.useEffect(() => {
    if (step && step !== 'idle') stopOfferSignals();
  }, [step]);

  React.useEffect(() => {
    if (urgency === 'urgent' || urgency === 'critical') offerSignal(urgency);
  }, [urgency]);

  const spoken = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (!liveId || total <= 0) return;
    for (const f of ANNOUNCE_AT) {
      const k = `${liveId}:${f}`;
      if (remaining / total <= f && !spoken.current.has(k)) {
        spoken.current.add(k);
        AccessibilityInfo.announceForAccessibility(`${Math.ceil(remaining / 1000)} seconds left to answer`);
      }
    }
  }, [liveId, remaining, total]);

  const kind = state.kind;
  const result = state.kind === 'result' ? state.result : null;
  React.useEffect(() => {
    if (kind === 'accepted') offerSignal('accepted');
    // Taken / withdrawn / expired: neutral tone + double pulse.
    if (result) offerSignal('ended');
  }, [kind, result]);
}

/**
 * Android Back: ignored while the offer is live (the Sheet swallows it too); on a result or the
 * accepted screen it does what the one button does ("Back to waiting", "Go to the restaurant").
 */
function useBackWhileShowing(state: OfferState, close: (toHome: boolean) => void): void {
  const ref = React.useRef({ state, close });
  ref.current = { state, close };
  // Re-registered whenever the sheet changes, so it stays newer than that Sheet's own handler.
  const kind = state.kind;
  React.useEffect(() => {
    if (kind === 'none') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const s = ref.current.state;
      if (s.kind === 'result') ref.current.close(true);
      else if (s.kind === 'accepted') ref.current.close(false);
      return true;
    });
    return () => sub.remove();
  }, [kind]);
}

/* ------------------------------------------------------------------ the sheets */

const KEEP_OPEN = () => undefined;

function OfferSheet({ footer, children }: { footer?: React.ReactNode; children: React.ReactNode }): React.ReactElement {
  // ds-request(native): Sheet tone=field / surface-offer — SH/OfferLive (until approved: the library Sheet's own surface).
  return (
    <Sheet open onClose={KEEP_OPEN} variant="full" dismissible={false} elevate="offer" title={OFFER_TITLE} footer={footer} testID="offer-sheet">
      {children}
    </Sheet>
  );
}

function Words({ type = 'body.lg', header = false, children }: { type?: TypeName; header?: boolean; children: React.ReactNode }): React.ReactElement {
  const theme = useTheme();
  return (
    <Text accessibilityRole={header ? 'header' : undefined} style={[typeStyle(theme, type), { color: theme.color.text.primary }]}>
      {children}
    </Text>
  );
}

/** A labelled value, label above (Pickup / Drop-off area, distance, time, items). */
function Fact({ label, value, note, testID }: { label?: string; value: string; note?: string; testID?: string }): React.ReactElement {
  return (
    <View style={{ gap: space['1'] }} testID={testID}>
      {label ? <Words type="label.lg">{label}</Words> : null}
      <Words type="heading.md">{value}</Words>
      {note ? <Words>{note}</Words> : null}
    </View>
  );
}

function Countdown({ seconds, urgency, suffix, testID }: { seconds: number; urgency: Urgency; suffix: string; testID: string }): React.ReactElement {
  const theme = useTheme();
  // Under 25%: warning; under 10%: danger. A countdown, not a halal state.
  const tone =
    urgency === 'critical' ? theme.color.feedback.danger.text : urgency === 'urgent' ? theme.color.feedback.warning.text : theme.color.text.primary;
  return (
    // ds-request(native): Countdown (ring, follows dynamic type) — SH/OfferLive, OfferUrgent, OfferCritical, OfferDecline
    <View accessible accessibilityLabel={`${seconds} seconds ${suffix}`} testID={testID} style={{ gap: space['1'] }}>
      <Text style={[typeStyle(theme, 'display.md'), { color: tone }]}>{clockLabel(seconds)}</Text>
      <Text style={[typeStyle(theme, 'label.lg'), { color: theme.color.text.primary }]}>{suffix}</Text>
    </View>
  );
}

interface LiveProps {
  state: Live;
  now: number;
  online: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onKeep: () => void;
  onMore: () => void;
  onReason: (r: RejectReason) => void;
}

function LiveOffer({ state, now, online, onAccept, onDecline, onKeep, onMore, onReason }: LiveProps): React.ReactElement {
  const { offer, step } = state;
  const remaining = Math.max(0, state.deadline - now);
  const seconds = Math.ceil(remaining / 1000);
  const urgency = urgencyOf(remaining, state.total);
  const inFlight = step === 'accepting' || step === 'declining';
  const fix = useLiveFix(true);
  const acceptLabel = step === 'accepting' ? BUTTON.accepting : step === 'accept-failed' ? BUTTON.acceptAgain : BUTTON.accept;

  const footer = (
    // ds-request(native): Button critical with the large bold label — SH/OfferLive Accept (heading-lg 700)
    <Button variant="primary" size="xl" critical fullWidth loading={step === 'accepting'} disabled={step === 'declining'} onPress={onAccept} testID="offer-accept">
      {acceptLabel}
    </Button>
  );

  return (
    <>
      <OfferSheet footer={footer}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space['4'] }}>
          <Countdown seconds={seconds} urgency={urgency} suffix={LABEL.toAnswer} testID="offer-countdown" />
          <Button variant="tertiary" size="xl" critical disabled={inFlight} onPress={onDecline} testID="offer-decline">
            {BUTTON.decline}
          </Button>
        </View>

        {step === 'accept-failed' ? (
          // ds-request(native): InlineAlert (slate, persistent) — SH/OfferAcceptRetry
          <Banner variant="neutral" title={acceptAlert(state.error).title} description={acceptAlert(state.error).body} testID="offer-alert-accept-failed" />
        ) : !online ? (
          // ds-request(native): InlineAlert (slate, persistent) — SH/OfferConnectionLost
          <Banner variant="neutral" title={ALERT.connectionLost.title} description={ALERT.connectionLost.body} testID="offer-alert-offline" />
        ) : null}

        <View style={{ gap: space['1'] }}>
          <Words type="label.lg">{LABEL.earnings}</Words>
          {/* ds-request(native): Price size display-lg — SH/OfferLive (drawn at xl until it exists) */}
          <Price cents={cents(Number(offer.earnings.estimated_total_cents))} size="xl" testID="offer-total" />
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space['6'], rowGap: space['3'] }}>
          {offer.distance_m != null ? <Fact value={kmLabel(offer.distance_m)} note={LABEL.tripLeg} testID="offer-distance" /> : null}
          {offer.est_duration_s != null ? <Fact value={minutesLabel(offer.est_duration_s)} note={LABEL.tripLeg} testID="offer-duration" /> : null}
          <Fact value={itemsLabel(offer.items_count)} note={LABEL.carry} testID="offer-items" />
        </View>

        <Fact label={LABEL.pickup} value={offer.pickup.restaurant_name} note={offer.pickup.address_short} testID="offer-pickup" />
        <Fact label={LABEL.dropoffArea} value={offer.dropoff.area} note={LABEL.fullAddressLater} testID="offer-dropoff-area" />

        {/* ds-request(native): KeyValueList — SH/OfferLive breakdown (a row whose value is missing or 0 is hidden) */}
        <View style={{ gap: space['2'] }} testID="offer-breakdown">
          {breakdownRows(offer.earnings).map((row) => (
            <View key={row.key} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space['3'] }} testID={`offer-row-${row.key}`}>
              <Words>{LABEL[row.key]}</Words>
              <Price cents={cents(row.cents)} size="lg" />
            </View>
          ))}
        </View>

        {/* ds-request(native): MapView approximate-area overlay (circle of radius_m, no pin; none when radius_m is null) — SH/OfferLive */}
        <MapView
          summary={mapSummary(offer)}
          restaurant={{ latitude: offer.pickup.latitude, longitude: offer.pickup.longitude }}
          rider={fix.status === 'ok' ? { latitude: fix.fix.latitude, longitude: fix.fix.longitude } : null}
          interactive={false}
          height={180}
          testID="offer-map"
        />
      </OfferSheet>

      {step === 'decline' || step === 'declining' || step === 'decline-failed' ? (
        <DeclineSheet state={state} seconds={seconds} urgency={urgency} onKeep={onKeep} onMore={onMore} onReason={onReason} />
      ) : null}
    </>
  );
}

/** SH/OfferAcceptRetry for a lost connection or our failure; anything else says what it was. */
function acceptAlert(error: RiderError | null): { title: string; body: string } {
  if (!error || error.kind === 'offline' || error.status == null || error.status >= 500) return ALERT.acceptFailed;
  return { title: error.title, body: error.message };
}

function DeclineSheet({
  state,
  seconds,
  urgency,
  onKeep,
  onMore,
  onReason,
}: {
  state: Live;
  seconds: number;
  urgency: Urgency;
  onKeep: () => void;
  onMore: () => void;
  onReason: (r: RejectReason) => void;
}): React.ReactElement {
  const sending = state.step === 'declining';
  const reasons = state.more ? [...FREQUENT_REASONS, ...MORE_REASONS] : FREQUENT_REASONS;
  return (
    <Sheet open onClose={KEEP_OPEN} variant="bottom" snapPoints={[0.84]} dismissible={false} elevate="offer" title={DECLINE_TITLE} testID="offer-decline-sheet">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space['4'] }}>
        <Countdown seconds={seconds} urgency={urgency} suffix={LABEL.left} testID="offer-decline-countdown" />
        <Button variant="tertiary" size="xl" critical disabled={sending} onPress={onKeep} testID="offer-keep">
          {BUTTON.keep}
        </Button>
      </View>
      {state.step === 'decline-failed' ? (
        // ds-request(native): InlineAlert (slate, persistent) — SH/OfferDeclineFailed
        <Banner variant="neutral" title={ALERT.declineFailed.title} description={ALERT.declineFailed.body} testID="offer-alert-decline-failed" />
      ) : null}
      {/* ds-request(native): ActionList (Button critical 72 rows, 8px apart) — SH/OfferDecline */}
      <View style={{ gap: space['2'] }}>
        {reasons.map((r) => (
          <Button
            key={r.code}
            variant="tertiary"
            size="xl"
            critical
            fullWidth
            loading={sending && state.reason === r.code}
            disabled={sending && state.reason !== r.code}
            onPress={() => onReason(r.code)}
            testID={`offer-reason-${r.code}`}
          >
            {r.label}
          </Button>
        ))}
        {state.more ? null : (
          <Button variant="ghost" size="xl" critical fullWidth disabled={sending} onPress={onMore} testID="offer-more-reasons">
            {BUTTON.moreReasons}
          </Button>
        )}
      </View>
    </Sheet>
  );
}

function AcceptedSheet({
  offer,
  address,
  restaurantAddress,
  onGo,
}: {
  offer: DispatchOffer;
  address: string;
  restaurantAddress: string;
  onGo: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const footer = (
    <Button variant="primary" size="xl" fullWidth onPress={onGo} testID="offer-go">
      {BUTTON.goToRestaurant}
    </Button>
  );
  return (
    <OfferSheet footer={footer}>
      <Icon name="check" size={icon['2xl']} color={theme.color.text.primary} />
      <Words type="heading.xl" header>
        {ACCEPTED_TITLE}
      </Words>
      <Words>{acceptedBody(offer.pickup.restaurant_name)}</Words>
      <View style={{ gap: space['1'] }}>
        <Words type="label.lg">{LABEL.earnings}</Words>
        <Price cents={cents(Number(offer.earnings.estimated_total_cents))} size="xl" />
      </View>
      <Fact label={LABEL.pickup} value={offer.pickup.restaurant_name} note={restaurantAddress} />
      <Fact label={LABEL.dropoff} value={address} testID="offer-full-address" />
    </OfferSheet>
  );
}

function ResultSheet({ result, onDone }: { result: ResultKind; onDone: (toHome: boolean) => void }): React.ReactElement {
  const theme = useTheme();
  const copy = RESULT[result];
  const footer = (
    <Button variant={copy.primary ? 'primary' : 'secondary'} size="xl" fullWidth onPress={() => onDone(true)} testID="offer-result-done">
      {copy.button}
    </Button>
  );
  return (
    <OfferSheet footer={footer}>
      {/* ds-request(native): StatusPanel (slate) — SH/OfferAcceptExpired, OfferExpired, OfferTaken, OfferWithdrawn */}
      <View style={{ gap: space['3'] }} testID={`offer-result-${result}`}>
        <Icon name="clock" size={icon['2xl']} color={theme.color.text.primary} />
        <Words type="heading.xl" header>
          {copy.title}
        </Words>
        {copy.body.map((line) => (
          <Words key={line}>{line}</Words>
        ))}
      </View>
    </OfferSheet>
  );
}
