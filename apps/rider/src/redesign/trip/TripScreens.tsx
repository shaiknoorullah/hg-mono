/**
 * WP4 the pickup leg (DL canvas, section 3 "Pickup leg"): the trip flow host and its first two
 * steps, the contact screen, and the board for a step saved offline that the server refused.
 *
 * - `trip` (R19): finds the delivery (params, the dashboard, or `getRiderMe`), shows Restoring /
 *   TripLoading / TripLoadFailed while it loads, then hands over to the screen for its state.
 * - `tripPickup` (R20, step 1): go to the restaurant. EN_ROUTE_TO_PICKUP is posted on its own
 *   (no button); "I'm at the restaurant" posts ARRIVED_AT_PICKUP; 422 GEOFENCE_REQUIRED opens the
 *   override sheet, so GPS never strands the rider.
 * - `tripAtRestaurant` (R21 + R22, step 2): wait until the restaurant marks the food ready, then
 *   check the items and type the 4-digit pickup code the kitchen reads out (#290).
 *   422 PICKUP_CODE_INCORRECT keeps the code and says the tries left; 423 PICKUP_CODE_LOCKED
 *   removes the field and hands over to support; offline, the pickup is saved and the rider
 *   carries on to the customer.
 * - `tripContact` (R33): calls through the private numbers the assignment carries. Notes history
 *   and chat are Needs API (gaps 22, 23): the list is its empty state.
 * - `SavedStepLayer`: a saved step the server refused on replay (`outbox.onRejected`): the pickup
 *   code (PickupCodeRejectedLater) or any other step (QueuedRejected).
 *
 * Trip steps have no Back (registered `back: 'none'`); the BottomNav is hidden by the flow. The
 * rider app shows no halal badge and no seal; nothing on a halal or delivery state is red. Every
 * banner is slate (`Banner` neutral).
 *
 * Layout helpers below are local to this file on purpose: the app defines no components
 * (constitution §1). Each stand-in for a missing composite carries its `ds-request` line. The
 * drop-off leg (WP5, `../dropoff`) lays its boards out with the same helpers, imported from here
 * rather than copied, so the trip reads as one flow.
 */
import * as React from 'react';
import { AccessibilityInfo, ScrollView, Text, View, type TextStyle } from 'react-native';
import { cents, idempotencyKey } from '@hg/api-client';

import {
  AppBar,
  Banner,
  Button,
  Card,
  EmptyState,
  Input,
  MapView,
  Price,
  Sheet,
  Skeleton,
  space,
  typeStyle,
  useTheme,
  type ButtonVariant,
} from '../ds';
import { callSupport, useSupport, type Support } from '../data/config';
import { useOnline } from '../data/connectivity';
import { OFFLINE } from '../data/errors';
import { outbox, type OutboxEntry } from '../data/outbox';
import { useApiQuery } from '../data/query';
import { useOutbox } from '../data/useOutbox';
import { formatTime } from '../format/time';
import { useRiderDashboard } from '../home';
import { openPhoneSettings } from '../home/permissions';
import { useNav } from '../nav/Navigator';
import { screenFor, type ScreenProps } from '../nav/registry';
import { fetchRiderMe } from '../session/Session';
import {
  ENDED,
  cachedAssignment,
  classifyStepError,
  claimAutoStart,
  dial,
  itemCount,
  openDirections,
  pickupCodeOf,
  postNow,
  prepareStep,
  putAssignment,
  resyncAfterConflict,
  routeFor,
  sendStep,
  setTripNotice,
  useFollowTrip,
  useMinutesSince,
  useTripAssignment,
  useTripNotice,
  type Assignment,
  type AssignmentState,
  type PreparedStep,
  type TripAssignmentView,
} from './assignment';
import {
  ARRIVE_FAILED,
  BUTTON,
  CODE_HELP,
  CONTACT,
  CONTACT_TITLE,
  DELIVERY_TITLE,
  DETAILS,
  FOOD,
  GEOFENCE,
  ITEMS,
  LOAD_FAILED,
  LOCKED,
  LONG_WAIT,
  NOT_MARKED_READY,
  NOT_SENT,
  NO_CONNECTION,
  NO_DELIVERY,
  OUT_OF_DATE,
  PICKUP_TITLE,
  QUEUED_REJECTED,
  RECORDING,
  RECORD_FAILED,
  REJECTED_LATER,
  RESTORING,
  SOMETHING_WRONG,
  START_FAILED,
  STATE_WORDS,
  STEP_NAME,
  STEP_SUBTITLE,
  TRACKING,
  UPDATES_DELAYED,
  WAITING,
  callName,
  goTo,
  orderSubtitle,
  queuedBody,
  queuedRow,
  supportHelper,
  wrongCode,
} from './copy';

/** Spec gap 26: no LONG_WAIT API; the banner shows from 20 minutes at the counter. */
export const LONG_WAIT_MIN = 20;
/** Override reasons are 5–200 characters (`AssignmentTransitionInput.override_reason`). */
const REASON_MIN = 5;
const REASON_MAX = 200;
const CODE_LENGTH = 4;

/* ================================================================== R19 the flow host */

export function TripHost({ params }: ScreenProps<'trip'>): React.ReactElement {
  const nav = useNav();
  const dash = useRiderDashboard();
  const lookup = params.assignmentId === null && !dash.assignment;
  // Cold start into ACTIVE_DELIVERY without an id: `getRiderMe` names the delivery.
  const me = useApiQuery('trip-rider-me', fetchRiderMe, { enabled: lookup });
  const id = params.assignmentId ?? dash.assignment?.id ?? me.data?.active_assignment_id ?? null;

  // The dashboard already carries the delivery: show it at once, the poll refreshes it.
  React.useEffect(() => {
    if (dash.assignment && dash.assignment.id === id) putAssignment(dash.assignment, dash.updatedAt);
  }, [dash.assignment, dash.updatedAt, id]);

  const view = useTripAssignment(id);
  React.useEffect(() => {
    if (id && view.state) nav.replace(routeFor(view.state), { assignmentId: id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, view.state]);

  if (lookup && me.status === 'success' && !id) {
    return (
      <Screen title={DELIVERY_TITLE} testID="trip-none" actions={[{ label: BUTTON.backToHome, variant: 'primary', onPress: nav.closeFlow }]}>
        <Lead title={NO_DELIVERY.title} body={NO_DELIVERY.body} />
      </Screen>
    );
  }
  const failed = id ? view.status === 'error' : lookup && me.status === 'error';
  if (failed) {
    return <TripLoadFailed retry={() => void (id ? view.refetch() : me.refetch())} offline={(id ? view.error : me.error)?.kind === 'offline'} />;
  }
  // No dashboard yet means the app has just opened on this delivery: say so (DL/Restoring).
  return dash.data ? <TripLoading /> : <Restoring saved={id ? view.saved.length : 0} />;
}

function Restoring({ saved }: { saved: number }): React.ReactElement {
  return (
    <Screen title={DELIVERY_TITLE} testID="trip-restoring">
      <Lead title={RESTORING.title} body={RESTORING.body(saved)} />
      {/* ds-request(native): Skeleton in the trip step shape — DL/Restoring, TripLoading */}
      <Skeleton variant="rect" width="100%" height={160} />
      <Skeleton variant="text" lines={3} />
    </Screen>
  );
}

function TripLoading(): React.ReactElement {
  return (
    <Screen title={DELIVERY_TITLE} testID="trip-loading">
      <View accessible accessibilityLabel="Loading your delivery" style={{ gap: space['4'] }}>
        <Skeleton variant="rect" width="100%" height={160} />
        <Skeleton variant="text" lines={4} />
      </View>
    </Screen>
  );
}

function TripLoadFailed({ retry, offline }: { retry: () => void; offline: boolean }): React.ReactElement {
  const support = useSupport();
  const [wrong, setWrong] = React.useState(false);
  return (
    <Screen
      title={DELIVERY_TITLE}
      subtitle={LOAD_FAILED.subtitle}
      testID="trip-load-failed"
      actions={[
        { label: BUTTON.tryAgain, variant: 'primary', onPress: retry, testID: 'trip-retry' },
        { label: BUTTON.somethingWrong, variant: 'ghost', onPress: () => setWrong(true) },
        ...supportAction(support, 'tertiary'),
      ]}
    >
      {/* ds-request(native): StatusPanel (ErrorState/InlineAlert, slate) — DL/TripLoadFailed */}
      <Lead title={offline ? OFFLINE.title : LOAD_FAILED.title} body={offline ? OFFLINE.message : LOAD_FAILED.body} />
      <WrongSheet open={wrong} onClose={() => setWrong(false)} support={support} />
    </Screen>
  );
}

/* ================================================================== R20 step 1: go to the restaurant */

type Attempt =
  | { phase: 'idle' }
  | { phase: 'sending'; step?: PreparedStep }
  | { phase: 'failed'; step: PreparedStep };

export function PickupStepScreen({ params }: ScreenProps<'tripPickup'>): React.ReactElement {
  const id = params.assignmentId;
  const view = useTripAssignment(id);
  useFollowTrip(id, view, 'tripPickup');
  const a = view.assignment;
  const nav = useNav();
  const support = useSupport();
  const alive = useAlive();
  const [start, setStart] = React.useState<Attempt>({ phase: 'idle' });
  const [arrive, setArrive] = React.useState<Attempt>({ phase: 'idle' });
  const [sheet, setSheet] = React.useState<'wrong' | 'geofence' | null>(null);
  const openWrong = useOpenWrong(id, () => setSheet('wrong'));
  const [reason, setReason] = React.useState('');

  /** Send a step; `retry` reuses the failed attempt's key and body. */
  const run = React.useCallback(
    async (
      set: React.Dispatch<React.SetStateAction<Attempt>>,
      make: () => Promise<PreparedStep>,
      retry?: PreparedStep,
    ): Promise<'sent' | 'geofence' | 'failed'> => {
      set({ phase: 'sending', step: retry });
      const step = retry ?? (await make());
      try {
        await sendStep(id, step);
        if (alive.current) set({ phase: 'idle' });
        return 'sent';
      } catch (e) {
        const failure = classifyStepError(e);
        if (failure.kind === 'out-of-date') {
          if (alive.current) set({ phase: 'idle' });
          await resyncAfterConflict(id, failure.state, view.refetch);
          return 'sent';
        }
        if (failure.kind === 'geofence') {
          if (alive.current) set({ phase: 'idle' });
          return 'geofence';
        }
        if (alive.current) set({ phase: 'failed', step });
        return 'failed';
      }
    },
    [alive, id, view.refetch],
  );

  // The last EN_ROUTE_TO_PICKUP attempt and the one in flight: "I'm at the restaurant" waits for
  // it, and resends a failed one first (same key), so the arrival is never a 409 from ASSIGNED.
  const startStep = React.useRef<{ step: PreparedStep; failed: boolean } | null>(null);
  const startInFlight = React.useRef<Promise<'sent' | 'geofence' | 'failed'> | null>(null);
  const startTrip = React.useCallback(
    (retry?: PreparedStep) => {
      const make = async () => {
        const step = await prepareStep({ to_state: 'EN_ROUTE_TO_PICKUP' });
        startStep.current = { step, failed: false };
        return step;
      };
      if (retry) startStep.current = { step: retry, failed: false };
      const p = run(setStart, make, retry).then((outcome) => {
        if (startStep.current) startStep.current.failed = outcome === 'failed';
        if (startInFlight.current === p) startInFlight.current = null;
        return outcome;
      });
      startInFlight.current = p;
      return p;
    },
    [run],
  );

  // EN_ROUTE_TO_PICKUP has no button: posted once when the trip opens on an accepted offer.
  React.useEffect(() => {
    if (view.assignment?.state === 'ASSIGNED' && view.saved.length === 0 && claimAutoStart(id)) void startTrip();
  }, [id, startTrip, view.assignment?.state, view.saved.length]);

  /** One arrival at a time: a second tap while the first waits for a GPS fix sends nothing. */
  const arriving = React.useRef(false);
  const arriveWith = async (make: () => Promise<PreparedStep>, retry?: PreparedStep) => {
    if (arriving.current) return;
    arriving.current = true;
    try {
      setArrive({ phase: 'sending', step: retry });
      // "On my way" first (DL/PickupStartFailed: the arrival queues behind it). The machine has no
      // ASSIGNED → ARRIVED_AT_PICKUP, so arriving on a delivery still at ASSIGNED would be a 409.
      if (startInFlight.current) await startInFlight.current;
      const startQueued = outbox.pendingFor(id).some((e) => e.input.to_state === 'EN_ROUTE_TO_PICKUP');
      if (cachedAssignment(id)?.state === 'ASSIGNED' && !startQueued) {
        const last = startStep.current;
        const started = await startTrip(last?.failed ? last.step : undefined);
        if (started === 'failed') {
          const step = retry ?? (await make());
          if (alive.current) setArrive({ phase: 'failed', step });
          return;
        }
      }
      const outcome = await run(setArrive, make, retry);
      if (outcome === 'geofence' && alive.current) setSheet('geofence');
    } finally {
      arriving.current = false;
    }
  };

  const arrived = (retry?: PreparedStep) => arriveWith(() => prepareStep({ to_state: 'ARRIVED_AT_PICKUP' }), retry);

  const override = async () => {
    const reasonText = reason.trim();
    setSheet(null);
    await arriveWith(() => prepareStep({ to_state: 'ARRIVED_AT_PICKUP', override_reason: reasonText }));
  };

  if (!a) return <StepPending view={view} />;

  const r = a.pickup;
  const busy = arrive.phase === 'sending';
  const call = r.phone_alias ? { label: BUTTON.callRestaurant, variant: 'tertiary' as const, onPress: () => dial(r.phone_alias!) } : null;
  const startFailed = start.phase === 'failed' ? start.step : null;
  const pending = view.saved.filter((e) => e.status === 'pending');

  return (
    <Screen
      title={PICKUP_TITLE}
      subtitle={STEP_SUBTITLE.goToRestaurant}
      progress={1}
      testID="trip-pickup"
      actions={[
        ...(call ? [call] : []),
        { label: BUTTON.somethingWrong, variant: 'ghost', onPress: openWrong, disabled: busy },
        arrive.phase === 'failed'
          ? { label: BUTTON.tryAgain, variant: 'primary', onPress: () => void arrived(arrive.step), testID: 'trip-arrive' }
          : { label: BUTTON.arrived, variant: 'primary', onPress: () => void arrived(), loading: busy, testID: 'trip-arrive' },
      ]}
    >
      <TripBanners view={view} />
      {startFailed ? (
        <View style={{ gap: space['2'] }}>
          {/* ds-request(native): InlineAlert (slate) — DL/PickupStartFailed */}
          <Banner variant="neutral" title={START_FAILED.title} description={START_FAILED.body(r.restaurant_name)} testID="trip-start-failed" />
          <SavedRow label={queuedRow(STEP_NAME.EN_ROUTE_TO_PICKUP!, formatTime(startFailed.input.occurred_at))} />
          <Button variant="ghost" size="xl" fullWidth onPress={() => void startTrip(startFailed)} testID="trip-start-retry">
            {BUTTON.tryAgainNow}
          </Button>
        </View>
      ) : null}
      <SavedSteps entries={pending} />
      {arrive.phase === 'failed' ? (
        // ds-request(native): InlineAlert (slate) — DL/PickupArriveFailed
        <Banner variant="neutral" title={ARRIVE_FAILED.title} description={ARRIVE_FAILED.body} testID="trip-arrive-failed" />
      ) : null}
      {/* ds-request(native): MapView pins with the dark-mode outline — DL/PickupEnRoute */}
      <MapView
        summary={`${goTo(r.restaurant_name)}. ${r.address}`}
        restaurant={{ latitude: r.latitude, longitude: r.longitude }}
        interactive={false}
        follow="fit-all"
        height={160}
      />
      <Button variant="tertiary" size="xl" fullWidth onPress={() => openDirections(r.latitude, r.longitude)} testID="trip-navigate">
        {BUTTON.navigate}
      </Button>
      <Lead title={goTo(r.restaurant_name)} body={r.address} />
      <DropoffLines a={a} />
      <FoodPanel a={a} updatedAt={view.updatedAt} />
      <Facts
        rows={[
          [DETAILS.orderCode, a.order_code ?? null],
          [DETAILS.pickupNotes, r.pickup_notes ?? null],
        ]}
      />
      {a.earnings ? (
        <View style={{ gap: space['1'] }}>
          <Line tone="secondary" type="label.lg">
            {DETAILS.estimatedEarnings}
          </Line>
          <Price cents={cents(Number(a.earnings.estimated_total_cents))} size="lg" testID="trip-earnings" />
        </View>
      ) : null}
      <MessagesLink onPress={() => nav.push('tripContact', { assignmentId: id })} />
      <WrongSheet
        open={sheet === 'wrong'}
        onClose={() => setSheet(null)}
        support={support}
        restaurant={{ name: r.restaurant_name, phone: r.phone_alias ?? null }}
      />
      <Sheet
        open={sheet === 'geofence'}
        onClose={() => setSheet(null)}
        dismissible={false}
        title={GEOFENCE.title}
        testID="trip-geofence"
        footer={
          <Actions
            actions={[
              { label: BUTTON.somethingWrong, variant: 'ghost', onPress: () => setSheet('wrong') },
              {
                label: BUTTON.arrivedOverride,
                variant: 'primary',
                onPress: () => void override(),
                disabled: reason.trim().length < REASON_MIN,
                testID: 'trip-geofence-continue',
              },
              { label: BUTTON.notThereYet, variant: 'tertiary', onPress: () => setSheet(null) },
            ]}
          />
        }
      >
        <View style={{ gap: space['4'] }}>
          <Lead title={goTo(r.restaurant_name)} body={r.address} level={3} />
          <Line>{GEOFENCE.body(r.restaurant_name)}</Line>
          {/* ds-request(native): TextArea (rider, 56 min, 7:1 helper and counter) — DL/PickupGeofence */}
          <Input
            label={GEOFENCE.label}
            value={reason}
            onChange={setReason}
            size="lg"
            required
            maxLength={REASON_MAX}
            characterCount
            helperText={GEOFENCE.helper}
            testID="trip-geofence-reason"
          />
        </View>
      </Sheet>
    </Screen>
  );
}

/* ================================================================== R21 + R22 step 2: at the restaurant */

type Pickup =
  | { status: 'idle' }
  | { status: 'sending'; step?: PreparedStep }
  | { status: 'failed'; step: PreparedStep }
  | { status: 'wrong'; attemptsRemaining: number | null }
  | { status: 'locked' }
  | { status: 'queued'; at: string };

export function AtRestaurantScreen({ params }: ScreenProps<'tripAtRestaurant'>): React.ReactElement {
  const id = params.assignmentId;
  const view = useTripAssignment(id);
  const [pickup, setPickup] = React.useState<Pickup>({ status: 'idle' });
  // A pickup saved offline holds this board until the rider moves on (DL/PickupRecordQueued), or
  // until it sends: once it is accepted there is nothing left to say here.
  const pickupWaiting = view.saved.some((e) => e.input.to_state === 'PICKED_UP' && e.status === 'pending');
  useFollowTrip(id, view, 'tripAtRestaurant', pickup.status === 'queued' && pickupWaiting);
  const a = view.assignment;
  const nav = useNav();
  const support = useSupport();
  const alive = useAlive();
  const [code, setCode] = React.useState('');
  const [sheet, setSheet] = React.useState<'wrong' | 'help' | 'not-ready' | null>(null);
  const openWrong = useOpenWrong(id, () => setSheet('wrong'));
  const ready = a?.pickup.order_state === 'READY_FOR_PICKUP';
  // "I'm at the restaurant" lands on the items when the food is already ready, else on the wait.
  const [checking, setChecking] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    if (a && checking === null) setChecking(ready);
  }, [a, checking, ready]);
  const minutes = useMinutesSince(a?.arrived_pickup_at);

  // One pickup at a time: a second tap while the first waits up to 5 s for a GPS fix sends nothing.
  const recording = React.useRef(false);
  const gotFood = async () => {
    if (code.length !== CODE_LENGTH || recording.current) return;
    recording.current = true;
    // "Try again" after a 5xx is the same request, unless the rider changed the code.
    const previous = pickup.status === 'failed' && pickupCodeOf(pickup.step.input) === code ? pickup.step : null;
    setPickup({ status: 'sending', step: previous ?? undefined });
    let step = previous;
    try {
      step ??= await prepareStep({ to_state: 'PICKED_UP', pickup_code: code });
      const result = await sendStep(id, step);
      if (!alive.current) return;
      setPickup(result.queued ? { status: 'queued', at: step.input.occurred_at } : { status: 'idle' });
    } catch (e) {
      const failure = classifyStepError(e);
      if (!alive.current) return;
      switch (failure.kind) {
        case 'code-incorrect':
          return setPickup({ status: 'wrong', attemptsRemaining: failure.attemptsRemaining });
        case 'code-locked':
          return setPickup({ status: 'locked' });
        case 'out-of-date':
          setPickup({ status: 'idle' });
          return void resyncAfterConflict(id, failure.state, view.refetch);
        default:
          return step ? setPickup({ status: 'failed', step }) : setPickup({ status: 'idle' });
      }
    } finally {
      recording.current = false;
    }
  };

  if (!a) return <StepPending view={view} />;
  const r = a.pickup;
  const restaurantCall = r.phone_alias ? () => dial(r.phone_alias!) : null;
  const wrongSheet = (
    <WrongSheet
      open={sheet === 'wrong'}
      onClose={() => setSheet(null)}
      support={support}
      restaurant={{ name: r.restaurant_name, phone: r.phone_alias ?? null }}
    />
  );

  if (pickup.status === 'queued') {
    const d = a.dropoff;
    return (
      <Screen
        title={PICKUP_TITLE}
        subtitle={STEP_SUBTITLE.goToCustomer}
        progress={3}
        testID="trip-pickup-queued"
        actions={[
          { label: BUTTON.somethingWrong, variant: 'ghost', onPress: () => setSheet('wrong') },
          { label: BUTTON.goToCustomer, variant: 'primary', onPress: () => nav.replace('tripDropoff', { assignmentId: id }), testID: 'trip-go-customer' },
        ]}
      >
        {/* ds-request(native): InlineAlert (slate) — DL/PickupRecordQueued */}
        <Banner variant="neutral" title={NOT_SENT} description={queuedBody(STEP_NAME.PICKED_UP!)} testID="trip-pickup-saved" />
        <SavedRow label={queuedRow(STEP_NAME.PICKED_UP!, formatTime(pickup.at))} />
        <Lead title={goTo(d.customer_display_name)} body={d.address} />
        <Facts
          mono
          rows={[
            [DETAILS.unit, d.unit ?? null],
            [DETAILS.buzzer, d.buzzer ?? null],
          ]}
        />
        {wrongSheet}
      </Screen>
    );
  }

  if (pickup.status === 'locked') {
    return (
      <Screen
        title={PICKUP_TITLE}
        subtitle={STEP_SUBTITLE.atRestaurant}
        progress={2}
        testID="trip-code-locked"
        actions={lockedActions(r.restaurant_name, restaurantCall, support, () => setSheet('wrong'))}
      >
        {/* ds-request(native): StatusPanel (ErrorState/InlineAlert, slate) — DL/PickupCodeLocked */}
        <Lead title={LOCKED.title} body={LOCKED.body(r.restaurant_name, a.order_code ?? '')} />
        {wrongSheet}
      </Screen>
    );
  }

  if (pickup.status === 'sending') {
    return (
      <Screen
        title={PICKUP_TITLE}
        subtitle={STEP_SUBTITLE.checkBag}
        progress={2}
        testID="trip-recording"
        actions={[{ label: BUTTON.gotFood, variant: 'primary', loading: true, onPress: () => undefined, irreversible: true }]}
      >
        <Lead title={RECORDING.title} body={RECORDING.body} />
      </Screen>
    );
  }

  const showItems = checking === true;
  const wrong = pickup.status === 'wrong' ? wrongCode(a.order_code ?? '', pickup.attemptsRemaining) : undefined;
  const callAction = restaurantCall ? [{ label: BUTTON.callRestaurant, variant: 'tertiary' as const, onPress: restaurantCall }] : [];

  return (
    <Screen
      title={PICKUP_TITLE}
      subtitle={pickup.status === 'failed' ? STEP_SUBTITLE.checkBag : STEP_SUBTITLE.atRestaurant}
      progress={2}
      testID={showItems ? 'trip-items' : 'trip-waiting'}
      actions={
        showItems
          ? [
              ...callAction,
              { label: BUTTON.somethingWrong, variant: 'ghost', onPress: openWrong },
              {
                label: pickup.status === 'failed' ? BUTTON.tryAgain : BUTTON.gotFood,
                variant: 'primary',
                onPress: () => void gotFood(),
                disabled: code.length !== CODE_LENGTH,
                helper: code.length === CODE_LENGTH ? undefined : ITEMS.gotFoodHelper,
                irreversible: true,
                testID: 'trip-got-food',
              },
            ]
          : [
              ...callAction,
              { label: BUTTON.somethingWrong, variant: 'ghost', onPress: openWrong },
              {
                label: BUTTON.checkItems,
                variant: 'primary',
                onPress: () => setChecking(true),
                disabled: !ready,
                helper: ready ? undefined : WAITING.checkItemsHelper,
                testID: 'trip-check-items',
              },
              { label: BUTTON.notMarkedReady, variant: 'ghost', onPress: () => setSheet('not-ready'), testID: 'trip-not-ready' },
            ]
      }
    >
      <TripBanners view={view} />
      <SavedSteps entries={view.saved.filter((e) => e.status === 'pending')} />
      {pickup.status === 'failed' ? (
        // ds-request(native): InlineAlert (slate) — DL/PickupRecordFailed
        <Banner variant="neutral" title={RECORD_FAILED.title} description={RECORD_FAILED.body} testID="trip-record-failed" />
      ) : null}
      {showItems ? (
        <>
          <Lead title={ITEMS.title(itemCount(a))} />
          <Line tone="secondary" type="label.lg">
            {ITEMS.ready}
          </Line>
          <Line>
            {`${ITEMS.match} `}
            <Line type="mono.md">{a.order_code ?? ''}</Line>
            {` ${ITEMS.matchTail}`}
          </Line>
          <ItemList a={a} />
          <Lead title={ITEMS.codeTitle} body={ITEMS.codeBody} level={3} />
          {/* ds-request(native): 4-cell code entry (Input otp, length 4, 56px cells) — DL/PickupItems, PickupCodeWrong (#193) */}
          <Input
            label={ITEMS.codeLabel}
            value={code}
            onChange={(next) => {
              setCode(next.replace(/\D/g, '').slice(0, CODE_LENGTH));
              if (pickup.status === 'wrong') setPickup({ status: 'idle' });
            }}
            variant="numeric"
            size="lg"
            required
            maxLength={CODE_LENGTH}
            autoComplete="off"
            errorText={wrong}
            testID="trip-pickup-code"
          />
          <Button variant="tertiary" size="xl" fullWidth onPress={() => setSheet('help')} testID="trip-code-help">
            {BUTTON.kitchenCantFind}
          </Button>
          <Facts rows={[[DETAILS.payment, DETAILS.prepaid]]} />
          <DropoffLines a={a} />
        </>
      ) : (
        <>
          <Lead title={WAITING.title} body={WAITING.body} />
          {minutes != null && minutes >= LONG_WAIT_MIN ? (
            <View style={{ gap: space['2'] }}>
              {/* ds-request(native): InlineAlert (slate, 56px action) — DL/PickupLongWait */}
              <Banner variant="neutral" title={LONG_WAIT.title} description={LONG_WAIT.body} testID="trip-long-wait" />
              {restaurantCall ? (
                <Button variant="tertiary" size="xl" fullWidth onPress={restaurantCall}>
                  {callName(r.restaurant_name)}
                </Button>
              ) : null}
            </View>
          ) : null}
          <FoodPanel a={a} updatedAt={view.updatedAt} waited={minutes} />
          <DropoffLines a={a} />
          <Facts rows={[[DETAILS.orderCode, a.order_code ?? null]]} />
          <Line type="heading.sm">{WAITING.itemsToCollect(itemCount(a))}</Line>
          <ItemList a={a} />
          <MessagesLink onPress={() => nav.push('tripContact', { assignmentId: id })} />
        </>
      )}
      {wrongSheet}
      <Sheet
        open={sheet === 'help'}
        onClose={() => setSheet(null)}
        title={CODE_HELP.title}
        testID="trip-code-help-sheet"
        footer={
          <Actions
            actions={[
              ...(restaurantCall ? [{ label: callName(r.restaurant_name), variant: 'tertiary' as const, onPress: restaurantCall }] : []),
              ...supportAction(support, 'tertiary'),
              { label: BUTTON.somethingWrong, variant: 'ghost', onPress: () => setSheet('wrong') },
              { label: BUTTON.backToCode, variant: 'primary', onPress: () => setSheet(null) },
            ]}
          />
        }
      >
        <Line>{CODE_HELP.body(a.order_code ?? '')}</Line>
      </Sheet>
      <Sheet
        open={sheet === 'not-ready'}
        onClose={() => setSheet(null)}
        title={NOT_MARKED_READY.title}
        testID="trip-not-ready-sheet"
        footer={
          <Actions
            actions={[
              { label: BUTTON.somethingWrong, variant: 'ghost', onPress: () => setSheet('wrong') },
              ...(restaurantCall ? [{ label: callName(r.restaurant_name), variant: 'primary' as const, onPress: restaurantCall }] : []),
              ...supportAction(support, restaurantCall ? 'secondary' : 'primary'),
              { label: BUTTON.keepWaiting, variant: 'tertiary', onPress: () => setSheet(null) },
            ]}
          />
        }
      >
        <View style={{ gap: space['3'] }}>
          <Lead title={WAITING.title} body={r.address} level={3} />
          <Line>{NOT_MARKED_READY.body(r.restaurant_name)}</Line>
        </View>
      </Sheet>
    </Screen>
  );
}

function lockedActions(
  restaurant: string,
  restaurantCall: (() => void) | null,
  support: Support,
  openWrong: () => void,
): ActionSpec[] {
  // Support is the way through; with support off, calling the restaurant is what is left.
  const supportRow = supportAction(support, 'primary');
  return [
    ...(restaurantCall
      ? [{ label: callName(restaurant), variant: (supportRow.length ? 'tertiary' : 'primary') as ButtonVariant, onPress: restaurantCall }]
      : []),
    { label: BUTTON.somethingWrong, variant: 'ghost', onPress: openWrong },
    ...supportRow,
  ];
}

/* ================================================================== R33 contact */

export function ContactScreen({ params }: ScreenProps<'tripContact'>): React.ReactElement {
  const nav = useNav();
  const view = useTripAssignment(params.assignmentId);
  const support = useSupport();
  const [wrong, setWrong] = React.useState(false);
  const a = view.assignment;
  const back = { onPress: () => void nav.pop() };
  const sheet = (
    <WrongSheet
      open={wrong}
      onClose={() => setWrong(false)}
      support={support}
      restaurant={a ? { name: a.pickup.restaurant_name, phone: a.pickup.phone_alias ?? null } : undefined}
    />
  );
  const wrongAction: ActionSpec = { label: BUTTON.somethingWrong, variant: 'ghost', onPress: () => setWrong(true) };

  if (!a) {
    const failed = view.status === 'error';
    return (
      <Screen
        title={CONTACT_TITLE}
        back={back}
        testID={failed ? 'trip-contact-error' : 'trip-contact-loading'}
        actions={failed ? [wrongAction, { label: BUTTON.tryAgain, variant: 'primary', onPress: () => void view.refetch() }] : [wrongAction]}
      >
        {failed ? (
          // ds-request(native): ErrorState recoverable (StatusPanel, slate) — DL/ContactError
          <Lead title={CONTACT.errorTitle} body={CONTACT.errorBody} />
        ) : (
          <View accessible accessibilityLabel={CONTACT.loading} style={{ gap: space['3'] }}>
            <Line tone="secondary">{CONTACT.loading}</Line>
            <Skeleton variant="text" lines={3} />
          </View>
        )}
        {sheet}
      </Screen>
    );
  }

  const before = view.state ? routeFor(view.state) === 'tripPickup' || routeFor(view.state) === 'tripAtRestaurant' : true;
  const code = a.order_code ?? '';
  const calls: ActionSpec[] = [];
  if (a.pickup.phone_alias) calls.push({ label: callName(a.pickup.restaurant_name), variant: 'tertiary', onPress: () => dial(a.pickup.phone_alias!) });
  // Before pickup the restaurant only; the customer's line opens once the food is in the bag.
  if (!before && a.dropoff.phone_alias) {
    calls.push({ label: callName(a.dropoff.customer_display_name), variant: 'tertiary', onPress: () => dial(a.dropoff.phone_alias!) });
  }

  return (
    <Screen
      title={CONTACT_TITLE}
      subtitle={before ? CONTACT.beforePickup(code) : CONTACT.afterPickup(code)}
      back={back}
      testID="trip-contact"
      actions={[wrongAction]}
    >
      <Line type="heading.sm" header>
        {CONTACT.privateNumber}
      </Line>
      {calls.length ? (
        <>
          <Actions actions={calls} />
          <Line tone="secondary">{before ? CONTACT.restaurantOnlyHelper : CONTACT.bothHelper}</Line>
        </>
      ) : (
        <Line>{CONTACT.noCalling}</Line>
      )}
      <Line type="heading.sm" header>
        {before ? CONTACT.messagesBefore : CONTACT.messagesAfter}
      </Line>
      {/* Notes history is Needs API (gap 22) and notes arrive only over the socket (#29): none to list. */}
      <EmptyState variant="inline" title={CONTACT.emptyTitle} description={CONTACT.emptyBody} testID="trip-contact-empty" />
      {sheet}
    </Screen>
  );
}

/* ================================================================== saved steps the server refused */

/** A layer over every screen while a saved step is refused (`outbox.onRejected`). */
export function SavedStepLayer(): React.ReactElement | null {
  const entries = useOutbox();
  React.useEffect(
    () => outbox.onRejected((entry) => AccessibilityInfo.announceForAccessibility(isCodeRefusal(entry) ? REJECTED_LATER.title : QUEUED_REJECTED.title)),
    [],
  );
  const rejected = entries.find((e) => e.status === 'rejected');
  if (!rejected) return null;
  return isCodeRefusal(rejected) ? <CodeRejectedLater key={rejected.id} entry={rejected} /> : <QueuedRejected key={rejected.id} entry={rejected} />;
}

function isCodeRefusal(entry: OutboxEntry): boolean {
  return entry.input.to_state === 'PICKED_UP' && /^PICKUP_CODE_/.test(String(entry.error?.code ?? ''));
}

/** DL/PickupCodeRejectedLater: type the code again; the corrected pickup goes before the queue. */
function CodeRejectedLater({ entry }: { entry: OutboxEntry }): React.ReactElement {
  const id = entry.assignmentId;
  const view = useTripAssignment(id);
  const support = useSupport();
  const alive = useAlive();
  const [code, setCode] = React.useState('');
  const [result, setResult] = React.useState<Pickup | { status: 'offline' }>(
    entry.error?.code === 'PICKUP_CODE_LOCKED' ? { status: 'locked' } : { status: 'idle' },
  );
  const [wrongOpen, setWrongOpen] = React.useState(false);
  const a = view.assignment;

  // Support confirmed the pickup (or the delivery ended): the saved step is moot.
  const server = a?.state;
  React.useEffect(() => {
    if (server && (ENDED.has(server) || routeFor(server) === 'tripDropoff')) void outbox.dismiss(entry.id);
  }, [entry.id, server]);

  const send = async () => {
    if (code.length !== CODE_LENGTH) return;
    const previous = result.status === 'failed' && pickupCodeOf(result.step.input) === code ? result.step : null;
    // The pickup happened when the rider first tapped: keep that time and place, new code, new key.
    const step: PreparedStep = previous ?? { key: idempotencyKey(), input: { ...(entry.input as PreparedStep['input']), pickup_code: code } };
    setResult({ status: 'sending', step });
    try {
      await postNow(id, step);
      await outbox.dismiss(entry.id); // the steps queued behind it now follow, in order
    } catch (e) {
      if (!alive.current) return;
      const failure = classifyStepError(e);
      if (failure.kind === 'code-incorrect') return setResult({ status: 'wrong', attemptsRemaining: failure.attemptsRemaining });
      if (failure.kind === 'code-locked') return setResult({ status: 'locked' });
      if (failure.kind === 'out-of-date') {
        await outbox.dismiss(entry.id);
        return void resyncAfterConflict(id, failure.state, view.refetch);
      }
      if (failure.kind === 'failed' && failure.error.kind === 'offline') return setResult({ status: 'offline' });
      return setResult({ status: 'failed', step });
    }
  };

  const restaurant = a?.pickup.restaurant_name ?? '';
  const orderCode = a?.order_code ?? '';
  const restaurantCall = a?.pickup.phone_alias ? () => dial(a.pickup.phone_alias!) : null;
  const locked = result.status === 'locked';
  const sending = result.status === 'sending';

  return (
    <Overlay>
      <Screen
        title={PICKUP_TITLE}
        subtitle={orderSubtitle(orderCode)}
        testID={locked ? 'trip-rejected-locked' : 'trip-rejected-code'}
        actions={
          locked
            ? lockedActions(restaurant, restaurantCall, support, () => setWrongOpen(true))
            : [
                ...(restaurantCall ? [{ label: callName(restaurant), variant: 'tertiary' as const, onPress: restaurantCall }] : []),
                ...supportAction(support, 'tertiary'),
                {
                  label: BUTTON.sendCode,
                  variant: 'primary',
                  onPress: () => void send(),
                  disabled: code.length !== CODE_LENGTH,
                  loading: sending,
                  irreversible: true,
                  testID: 'trip-send-code',
                },
              ]
        }
      >
        {/* ds-request(native): StatusPanel (ErrorState/InlineAlert, slate) — DL/PickupCodeRejectedLater, PickupCodeLocked */}
        {locked ? (
          <Lead title={LOCKED.title} body={LOCKED.body(restaurant, orderCode)} />
        ) : (
          <>
            <Lead title={REJECTED_LATER.title} body={REJECTED_LATER.body(formatTime(entry.input.occurred_at), restaurant, orderCode)} />
            {result.status === 'failed' ? (
              <Banner variant="neutral" title={RECORD_FAILED.title} description={RECORD_FAILED.body} testID="trip-rejected-failed" />
            ) : null}
            {result.status === 'offline' ? (
              <Banner variant="neutral" title={OFFLINE.title} description={OFFLINE.message} testID="trip-rejected-offline" />
            ) : null}
            {/* ds-request(native): 4-cell code entry (Input otp, length 4) — DL/PickupCodeRejectedLater (#193) */}
            <Input
              label={ITEMS.codeLabel}
              value={code}
              onChange={(next) => {
                setCode(next.replace(/\D/g, '').slice(0, CODE_LENGTH));
                if (result.status === 'wrong') setResult({ status: 'idle' });
              }}
              variant="numeric"
              size="lg"
              required
              maxLength={CODE_LENGTH}
              autoComplete="off"
              errorText={result.status === 'wrong' ? wrongCode(orderCode, result.attemptsRemaining) : undefined}
              testID="trip-rejected-code-input"
            />
          </>
        )}
        <WrongSheet
          open={wrongOpen}
          onClose={() => setWrongOpen(false)}
          support={support}
          restaurant={a ? { name: restaurant, phone: a.pickup.phone_alias ?? null } : undefined}
        />
      </Screen>
    </Overlay>
  );
}

/** DL/QueuedRejected: a saved step the delivery had already moved past. */
function QueuedRejected({ entry }: { entry: OutboxEntry }): React.ReactElement {
  const view = useTripAssignment(entry.assignmentId);
  const details = (entry.error?.details ?? {}) as { current_state?: string };
  const now = (details.current_state as AssignmentState | undefined) ?? view.assignment?.state;
  const step = STEP_NAME[entry.input.to_state] ?? STATE_WORDS[entry.input.to_state];
  const where = now ? STATE_WORDS[now] : null;
  const carryOn = async () => {
    await outbox.dismiss(entry.id);
    setTripNotice(entry.assignmentId, null);
    await view.refetch();
  };
  return (
    <Overlay>
      <Screen
        title={DELIVERY_TITLE}
        subtitle={orderSubtitle(view.assignment?.order_code ?? '')}
        testID="trip-queued-rejected"
        actions={[{ label: BUTTON.continueFromHere, variant: 'primary', onPress: () => void carryOn(), testID: 'trip-continue' }]}
      >
        {/* ds-request(native): StatusPanel (ErrorState/InlineAlert, slate) — DL/QueuedRejected */}
        <Lead title={QUEUED_REJECTED.title} body={QUEUED_REJECTED.body(step, formatTime(entry.input.occurred_at))} />
        {where ? <Facts rows={[[QUEUED_REJECTED.whereNow, where.charAt(0).toUpperCase() + where.slice(1)]]} /> : null}
      </Screen>
    </Overlay>
  );
}

/* ================================================================== shared pieces of these boards */

/** Before the assignment is known on a step screen (normally the host has loaded it). */
export function StepPending({ view }: { view: TripAssignmentView }): React.ReactElement {
  if (view.status === 'error') return <TripLoadFailed retry={() => void view.refetch()} offline={view.error?.kind === 'offline'} />;
  return <TripLoading />;
}

/** Slate banners every pickup step can carry: moved on, no connection, tracking, stale poll. */
export function TripBanners({ view, offlineBody = NO_CONNECTION.body }: { view: TripAssignmentView; offlineBody?: string }): React.ReactElement {
  const online = useOnline();
  const a = view.assignment!;
  const id = view.id ?? a.id;
  const notice = useTripNotice(id);
  const tracking = a.tracking_health;
  // A refetch failed while the last good answer stays on screen: the polling equivalent of
  // DL/TripSocketLost (manifest §5 conflict 4).
  const stale = online && view.error !== null;
  return (
    <>
      {notice ? (
        // ds-request(native): InlineAlert — DL/TripOutOfDate
        <Banner
          variant="neutral"
          title={OUT_OF_DATE.title}
          description={OUT_OF_DATE.body(STATE_WORDS[notice.state])}
          dismissible
          onDismiss={() => setTripNotice(id, null)}
          testID="trip-out-of-date"
        />
      ) : null}
      {!online ? (
        // ds-request(native): InlineAlert (persistent) — DL/TripNoConnection
        <Banner variant="neutral" title={NO_CONNECTION.title} description={offlineBody} testID="trip-offline" />
      ) : null}
      {tracking === 'LOST' ? (
        <View style={{ gap: space['2'] }}>
          {/* ds-request(native): InlineAlert (slate, 56px action) — DL/PickupTrackingLost */}
          <Banner variant="neutral" title={TRACKING.lostTitle} description={TRACKING.lostBody} testID="trip-tracking-lost" />
          <Button variant="tertiary" size="xl" fullWidth onPress={openPhoneSettings}>
            {BUTTON.openLocationSettings}
          </Button>
        </View>
      ) : null}
      {tracking === 'DEGRADED' ? (
        // ds-request(native): InlineAlert (slate) — DL/PickupTrackingDegraded
        <Banner variant="neutral" title={TRACKING.degradedTitle} description={TRACKING.degradedBody} testID="trip-tracking-degraded" />
      ) : null}
      {stale ? <Banner variant="neutral" title={UPDATES_DELAYED.title} description={UPDATES_DELAYED.body} testID="trip-updates-delayed" /> : null}
    </>
  );
}

/** Steps saved on the phone, not sent yet (DL/PickupStartQueued, TripNoConnection). */
export function SavedSteps({ entries }: { entries: readonly OutboxEntry[] }): React.ReactElement | null {
  const latest = entries[entries.length - 1];
  if (!latest) return null;
  const name = STEP_NAME[latest.input.to_state] ?? STATE_WORDS[latest.input.to_state];
  return (
    <View style={{ gap: space['2'] }} testID="trip-saved-steps">
      {/* ds-request(native): InlineAlert (slate) — DL/PickupStartQueued */}
      <Banner variant="neutral" title={NOT_SENT} description={queuedBody(name)} />
      {entries.map((e) => (
        <SavedRow key={e.id} label={queuedRow(STEP_NAME[e.input.to_state] ?? STATE_WORDS[e.input.to_state], formatTime(e.input.occurred_at))} />
      ))}
    </View>
  );
}

export function SavedRow({ label }: { label: string }): React.ReactElement {
  return (
    // ds-request(native): QueuedStepRow (ListRow 56, static, no live region) — DL/PickupStartQueued, PickupRecordQueued
    <Card variant="filled" accessibilityLabel={`${label}. ${NOT_SENT}`}>
      <View style={{ minHeight: 56 - space['4'] * 2, justifyContent: 'center', gap: space['1'] }}>
        <Line type="label.lg">{label}</Line>
        <Line tone="secondary">{NOT_SENT}</Line>
      </View>
    </Card>
  );
}

/** The food's state as the restaurant last set it, and the wait (FoodStatusPanel stand-in). */
function FoodPanel({ a, updatedAt, waited }: { a: Assignment; updatedAt: number; waited?: number | null }): React.ReactElement {
  const ready = a.pickup.order_state === 'READY_FOR_PICKUP';
  const checked = updatedAt ? FOOD.checked(formatTime(updatedAt)) : FOOD.label;
  return (
    // ds-request(native): FoodStatusPanel (Icon + StatusTimeline in Card) — DL/PickupEnRoute, PickupReady, PickupWaiting
    <Card variant="filled" testID="trip-food">
      <View style={{ gap: space['2'] }}>
        <Line tone="secondary" type="label.md">
          {checked}
        </Line>
        <Line type="heading.sm" testID="trip-food-state">
          {ready ? FOOD.ready : FOOD.preparing}
        </Line>
        {ready ? <Line tone="secondary">{FOOD.updates}</Line> : null}
        {waited != null ? (
          <Line testID="trip-waited">
            {`${WAITING.waited} · ${WAITING.minutes(waited)}`}
          </Line>
        ) : null}
      </View>
    </Card>
  );
}

/** The full drop-off address and unit, on the phone from accept (owner decision). */
function DropoffLines({ a }: { a: Assignment }): React.ReactElement {
  return (
    <View style={{ gap: space['1'] }}>
      <Line tone="secondary" type="label.lg">
        {DETAILS.dropoff}
      </Line>
      <Line>{a.dropoff.address}</Line>
      {a.dropoff.unit ? <Line>{a.dropoff.unit}</Line> : null}
    </View>
  );
}

function ItemList({ a }: { a: Assignment }): React.ReactElement {
  return (
    <View style={{ gap: space['3'] }} testID="trip-items-list">
      {a.items.map((item, i) => {
        const extras = [item.variant_name, ...(item.addon_names ?? [])].filter(Boolean).join(' · ');
        return (
          <View key={`${item.name}-${i}`} style={{ gap: space['1'] }}>
            <Line type="label.lg">{`${item.quantity} × ${item.name}`}</Line>
            {extras ? <Line tone="secondary">{extras}</Line> : null}
            {item.note ? <Line tone="secondary">{ITEMS.note(item.note)}</Line> : null}
          </View>
        );
      })}
    </View>
  );
}

/** Label / value pairs; rows with no value are left out (KeyValueList stand-in). */
export function Facts({ rows, mono = false }: { rows: [string, string | null][]; mono?: boolean }): React.ReactElement | null {
  const shown = rows.filter((row): row is [string, string] => !!row[1]);
  if (!shown.length) return null;
  return (
    // ds-request(native): KeyValueList (2-col, mono values) — DL/PickupEnRoute, PickupRecordQueued
    <View style={{ gap: space['3'] }}>
      {shown.map(([label, value]) => (
        <View key={label} style={{ gap: space['1'] }} accessible accessibilityLabel={`${label}: ${value}`}>
          <Line tone="secondary" type="label.md">
            {label}
          </Line>
          <Line type={mono ? 'mono.md' : 'body.lg'}>{value}</Line>
        </View>
      ))}
    </View>
  );
}

export function MessagesLink({ onPress }: { onPress: () => void }): React.ReactElement {
  // ds-request(native): MessagePreview (Card outlined + ghost Button) — DL/PickupEnRoute; notes are Needs API (gap 22)
  return (
    <Button variant="ghost" size="xl" fullWidth onPress={onPress} testID="trip-messages">
      {BUTTON.seeAllMessages}
    </Button>
  );
}

/**
 * WP6 hook: "Something's wrong" on the pickup steps opens WP6's menu for the leg
 * (`tripException`, leg 'pickup', `../exceptions`) once it is registered, and the sheet below
 * until then. Boards whose state must survive the trip there and back (the code lock, the
 * pickup saved offline) and the sheets inside a step keep the sheet below.
 */
function useOpenWrong(assignmentId: string, fallback: () => void): () => void {
  const nav = useNav();
  return () => (screenFor('tripException') ? nav.push('tripException', { assignmentId, leg: 'pickup' }) : fallback());
}

/** "What's wrong?" for the pickup leg (DL/SomethingWrongPickup, SomethingWrongPickupNoSupport). */
function WrongSheet({
  open,
  onClose,
  support,
  restaurant,
}: {
  open: boolean;
  onClose: () => void;
  support: Support;
  restaurant?: { name: string; phone: string | null };
}): React.ReactElement {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={SOMETHING_WRONG.title}
      testID="trip-wrong-sheet"
      footer={<Actions actions={[{ label: BUTTON.backToDelivery, variant: 'primary', onPress: onClose }]} />}
    >
      <View style={{ gap: space['3'] }}>
        <Line type="label.lg">{SOMETHING_WRONG.danger}</Line>
        <Actions
          actions={[
            { label: BUTTON.call911, variant: 'danger', onPress: () => dial('911') },
            ...supportAction(support, 'tertiary'),
            ...(restaurant?.phone ? [{ label: callName(restaurant.name), variant: 'tertiary' as const, onPress: () => dial(restaurant.phone!) }] : []),
          ]}
        />
        <Line tone="secondary">{SOMETHING_WRONG.release}</Line>
      </View>
    </Sheet>
  );
}

/** "Call HalalGoes support" with its number and hours, or nothing when support is off. */
export function supportAction(support: Support, variant: ButtonVariant): ActionSpec[] {
  if (!support.phone) return [];
  return [
    {
      label: BUTTON.callSupport,
      variant,
      onPress: () => void callSupport(support),
      helper: supportHelper(support.phone, support.hours),
      testID: 'trip-call-support',
    },
  ];
}

/* ------------------------------------------------------------------ layout */

export interface ActionSpec {
  label: string;
  variant: ButtonVariant;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** The line under the button ("Turns on when …", support's number and hours). */
  helper?: string;
  /** Irreversible under time pressure: 72px on the boards ("I've got the food"). */
  irreversible?: boolean;
  testID?: string;
}

export function Actions({ actions }: { actions: readonly ActionSpec[] }): React.ReactElement {
  return (
    <View style={{ gap: space['2'] }}>
      {actions.map((act) => (
        <View key={act.label} style={{ gap: space['1'] }}>
          {/* Irreversible under time pressure ("I've got the food", "Send the code"): the 72px critical target. */}
          <Button
            variant={act.variant}
            size="xl"
            critical={act.irreversible}
            fullWidth
            disabled={act.disabled}
            loading={act.loading}
            onPress={act.onPress}
            testID={act.testID}
            accessibilityHint={act.helper}
          >
            {act.label}
          </Button>
          {act.helper ? (
            <Line tone="secondary" type="body.md" center>
              {act.helper}
            </Line>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export function Screen({
  title,
  subtitle,
  progress,
  back,
  actions,
  testID,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Step N of 4. */
  progress?: number;
  /** `previousTitle` names where Back goes ("Back to handover"). */
  back?: { onPress: () => void; previousTitle?: string };
  actions?: readonly ActionSpec[];
  testID: string;
  children: React.ReactNode;
}): React.ReactElement {
  const theme = useTheme();
  return (
    <View testID={testID} style={{ flex: 1, backgroundColor: theme.color.surface.base }}>
      {/* ds-request(native): ProgressSteps (AssignmentState, "Step N of 4") — DL trip boards; AppBar's determinate bar until then */}
      <AppBar title={title} subtitle={subtitle} tone="field" back={back} progress={progress == null ? undefined : progress / 4} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: space['4'], paddingVertical: space['5'], gap: space['4'] }}>
        {children}
      </ScrollView>
      {actions && actions.length ? (
        <View style={{ padding: space['4'], borderTopWidth: 1, borderTopColor: theme.color.border.decorative }}>
          <Actions actions={actions} />
        </View>
      ) : null}
    </View>
  );
}

/** A full-screen cover for the saved-step boards (they sit above every screen). */
function Overlay({ children }: { children: React.ReactNode }): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: theme.color.surface.base }}>{children}</View>
  );
}

export function Lead({ title, body, level = 2 }: { title: string; body?: string; level?: 2 | 3 }): React.ReactElement {
  return (
    <View style={{ gap: space['2'] }}>
      <Line type={level === 2 ? 'heading.xl' : 'heading.md'} header>
        {title}
      </Line>
      {body ? <Line>{body}</Line> : null}
    </View>
  );
}

export type LineType = 'heading.xl' | 'heading.md' | 'heading.sm' | 'body.lg' | 'body.md' | 'label.lg' | 'label.md' | 'mono.md';

export function Line({
  children,
  type = 'body.lg',
  tone = 'primary',
  header = false,
  center = false,
  testID,
}: {
  children: React.ReactNode;
  type?: LineType;
  tone?: 'primary' | 'secondary';
  header?: boolean;
  center?: boolean;
  testID?: string;
}): React.ReactElement {
  const theme = useTheme();
  const style: TextStyle = { color: tone === 'primary' ? theme.color.text.primary : theme.color.text.secondary };
  if (center) style.textAlign = 'center';
  return (
    <Text accessibilityRole={header ? 'header' : undefined} style={[typeStyle(theme, type), style]} testID={testID}>
      {children}
    </Text>
  );
}

/** `false` after unmount: a step answered after the screen moved on sets nothing. */
export function useAlive(): React.MutableRefObject<boolean> {
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}
