/**
 * R31 the return leg (DL/Returning and its states): UNDELIVERABLE → RETURNING → RETURNED.
 *
 * - RETURNING has no button: it is posted once, by itself, when the leg opens on UNDELIVERABLE
 *   (DL/CantDeliverSending "200 → RETURNING"). Offline it queues behind the saved UNDELIVERABLE.
 * - "I've returned it" posts RETURNED through the outbox. Sending (ReturnedSending), 5xx
 *   (ReturnedFailed: Try again is the same request, same Idempotency-Key), 422 GEOFENCE_REQUIRED
 *   (ReturnedGeofence: `override_reason` 5–200 characters, never strands the rider), 409 (re-read,
 *   follow). Offline the step is saved and the trip ends on DL/ReturnedQueued (`tripEnded`).
 * - A saved "Can't deliver" shows as "Not sent yet" with its row (CantDeliverQueued); with no
 *   connection the slate banner says the tap will be saved (ReturningNoConnection).
 *
 * Registered `back: 'none'` (a trip step). No halal badge, no seal, every banner slate.
 */
import * as React from 'react';
import { View } from 'react-native';

import { Banner, Button, Input, MapView, Sheet, space } from '../ds';
import { outbox, type OutboxEntry } from '../data/outbox';
import { formatTime } from '../format/time';
import { useNav } from '../nav/Navigator';
import type { ScreenProps } from '../nav/registry';
import {
  cachedAssignment,
  classifyStepError,
  dial,
  openDirections,
  prepareStep,
  resyncAfterConflict,
  routeFor,
  sendStep,
  useTripAssignment,
  type Assignment,
  type PreparedStep,
} from '../trip/assignment';
import { BUTTON, NOT_SENT, orderSubtitle, queuedBody, queuedRow } from '../trip/copy';
import { Actions, Facts, Lead, Line, SavedRow, Screen, StepPending, TripBanners, useAlive, type ActionSpec } from '../trip/TripScreens';
import { REASON_MAX, REASON_MIN } from '../dropoff/proof';
import { EX_BUTTON, RETURNING, RETURN_FAILED, RETURN_GEOFENCE, RETURN_SENDING, SAVED_NAME, TITLE } from './copy';
import { RETURN_LEG, claimReturning } from './state';

type Attempt = { phase: 'idle' } | { phase: 'sending' } | { phase: 'failed'; step: PreparedStep };

/** The automatic RETURNING: its last attempt, so the RETURNED tap can resend a failed one first. */
interface ReturningRecord {
  step: PreparedStep | null;
  done: Promise<boolean>;
}

export function ReturnScreen({ params }: ScreenProps<'tripReturn'>): React.ReactElement {
  const id = params.assignmentId;
  const view = useTripAssignment(id);
  const nav = useNav();
  const alive = useAlive();
  const [attempt, setAttempt] = React.useState<Attempt>({ phase: 'idle' });
  const [geofence, setGeofence] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const state = view.state;

  // Returned (or saved as returned), cancelled, or put back elsewhere: that screen takes over.
  React.useEffect(() => {
    if (state && attempt.phase !== 'sending' && !RETURN_LEG.has(state)) nav.replace(routeFor(state), { assignmentId: id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, attempt.phase, id]);

  const record = React.useRef<ReturningRecord | null>(null);
  const goingBack = React.useCallback(
    (again?: PreparedStep): Promise<boolean> => {
      const next: ReturningRecord = { step: again ?? null, done: Promise.resolve(false) };
      next.done = (async () => {
        const step = again ?? (await prepareStep({ to_state: 'RETURNING' }));
        next.step = step;
        return sendStep(id, step).then(
          () => true,
          async (e: unknown) => {
            const failure = classifyStepError(e);
            if (failure.kind !== 'out-of-date') return false;
            await resyncAfterConflict(id, failure.state, view.refetch);
            return true;
          },
        );
      })();
      record.current = next;
      return next.done;
    },
    [id, view.refetch],
  );
  const returningSaved = view.saved.some((e) => e.input.to_state === 'RETURNING' && e.status === 'pending');
  React.useEffect(() => {
    if (state === 'UNDELIVERABLE' && !returningSaved && claimReturning(id)) void goingBack();
  }, [id, state, returningSaved, goingBack]);

  /** One RETURNED at a time; "Try again" resends the failed one (same key, same body). */
  const busy = React.useRef(false);
  const returned = async (overrideReason?: string) => {
    if (busy.current) return;
    busy.current = true;
    const retry = attempt.phase === 'failed' && !overrideReason ? attempt.step : null;
    const make = () => prepareStep(overrideReason ? { to_state: 'RETURNED', override_reason: overrideReason } : { to_state: 'RETURNED' });
    setAttempt({ phase: 'sending' });
    try {
      // The machine has no UNDELIVERABLE → RETURNED: RETURNING goes first if it has not.
      const queued = outbox.pendingFor(id).some((e) => e.input.to_state === 'RETURNING');
      if (cachedAssignment(id)?.state === 'UNDELIVERABLE' && !queued) {
        const last = record.current;
        const ok = await (last ? last.done.then((sent) => sent || goingBack(last.step ?? undefined)) : goingBack());
        if (!ok) {
          const step = retry ?? (await make());
          if (alive.current) setAttempt({ phase: 'failed', step });
          return;
        }
      }
      const step = retry ?? (await make());
      try {
        await sendStep(id, step);
        if (alive.current) setAttempt({ phase: 'idle' });
      } catch (e) {
        const failure = classifyStepError(e);
        if (!alive.current) return;
        if (failure.kind === 'geofence') {
          setAttempt({ phase: 'idle' });
          setGeofence(true);
        } else if (failure.kind === 'out-of-date') {
          setAttempt({ phase: 'idle' });
          await resyncAfterConflict(id, failure.state, view.refetch);
        } else {
          setAttempt({ phase: 'failed', step });
        }
      }
    } finally {
      busy.current = false;
    }
  };

  const a = view.assignment;
  if (!a) return <StepPending view={view} />;
  const r = a.pickup;
  const subtitle = orderSubtitle(a.order_code ?? '');
  const call = restaurantLine(a);
  const wrong: ActionSpec = {
    label: BUTTON.somethingWrong,
    variant: 'ghost',
    onPress: () => nav.push('tripException', { assignmentId: id, leg: 'returning' }),
    testID: 'return-something-wrong',
  };
  const code = <Facts mono rows={[[RETURNING.orderCode, a.order_code ?? null]]} />;

  if (attempt.phase === 'sending') {
    return (
      <Screen
        title={TITLE.returning}
        subtitle={subtitle}
        testID="return-sending"
        actions={[{ label: EX_BUTTON.returned, variant: 'primary', loading: true, onPress: () => undefined }]}
      >
        <Lead title={RETURN_SENDING.title} body={RETURN_SENDING.body} />
      </Screen>
    );
  }

  if (attempt.phase === 'failed') {
    return (
      <Screen
        title={TITLE.returning}
        subtitle={subtitle}
        testID="return-failed"
        actions={[...call, wrong, { label: BUTTON.tryAgain, variant: 'primary', onPress: () => void returned(), testID: 'return-retry' }]}
      >
        {/* ds-request(native): InlineAlert (slate) — DL/ReturnedFailed */}
        <Banner variant="neutral" title={RETURN_FAILED.title} description={RETURN_FAILED.body} testID="return-failed-banner" />
        {code}
      </Screen>
    );
  }

  return (
    <Screen
      title={TITLE.returning}
      subtitle={subtitle}
      testID="return-leg"
      actions={[...call, wrong, { label: EX_BUTTON.returned, variant: 'primary', onPress: () => void returned(), testID: 'return-returned' }]}
    >
      <TripBanners view={view} offlineBody={RETURNING.offlineBody(r.restaurant_name)} />
      <SavedCantDeliver entries={view.saved} />
      {/* ds-request(native): MapView pins with the dark-mode outline — DL/Returning */}
      <MapView
        summary={`${RETURNING.heading(r.restaurant_name)}. ${r.address}`}
        restaurant={{ latitude: r.latitude, longitude: r.longitude }}
        interactive={false}
        follow="fit-all"
        height={160}
      />
      <Button variant="tertiary" size="xl" fullWidth onPress={() => openDirections(r.latitude, r.longitude)} testID="return-navigate">
        {BUTTON.navigate}
      </Button>
      <Lead title={RETURNING.heading(r.restaurant_name)} body={r.address} />
      <Line>{RETURNING.body}</Line>
      {code}
      <Sheet
        open={geofence}
        onClose={() => setGeofence(false)}
        dismissible={false}
        title={RETURN_GEOFENCE.title(r.restaurant_name)}
        testID="return-geofence"
        footer={
          <Actions
            actions={[
              {
                label: EX_BUTTON.returnedOverride,
                variant: 'primary',
                onPress: () => {
                  setGeofence(false);
                  void returned(reason.trim());
                },
                disabled: reason.trim().length < REASON_MIN,
                testID: 'return-geofence-confirm',
              },
              { label: EX_BUTTON.keepGoingToRestaurant, variant: 'tertiary', onPress: () => setGeofence(false) },
            ]}
          />
        }
      >
        {/* ds-request(native): Sheet (rider) close IconButton size lg (56) — DL/ReturnedGeofence */}
        <View style={{ gap: space['4'] }}>
          <Lead title={RETURNING.heading(r.restaurant_name)} body={r.address} level={3} />
          <Line>{RETURN_GEOFENCE.body}</Line>
          {/* ds-request(native): TextArea (rider, 56 min, 7:1 helper and counter) — DL/ReturnedGeofence */}
          <Input
            label={RETURN_GEOFENCE.label}
            value={reason}
            onChange={setReason}
            size="lg"
            required
            maxLength={REASON_MAX}
            characterCount
            helperText={RETURN_GEOFENCE.helper}
            testID="return-geofence-reason"
          />
        </View>
      </Sheet>
    </Screen>
  );
}

/** "Call restaurant" on the return leg (hidden when `pickup.phone_alias` is null). */
function restaurantLine(a: Assignment): ActionSpec[] {
  const phone = a.pickup.phone_alias;
  return phone ? [{ label: BUTTON.callRestaurant, variant: 'tertiary', onPress: () => dial(phone) }] : [];
}

/**
 * DL/CantDeliverQueued: the "Can't deliver" saved offline, its row while it waits. The automatic
 * RETURNING behind it has no row (the boards list the steps the rider tapped).
 */
export function SavedCantDeliver({ entries }: { entries: readonly OutboxEntry[] }): React.ReactElement | null {
  const saved = entries.find((e) => e.input.to_state === 'UNDELIVERABLE' && e.status === 'pending');
  if (!saved) return null;
  return (
    <View style={{ gap: space['2'] }} testID="return-saved">
      {/* ds-request(native): InlineAlert (slate) — DL/CantDeliverQueued */}
      <Banner variant="neutral" title={NOT_SENT} description={queuedBody(SAVED_NAME.UNDELIVERABLE)} />
      <SavedRow label={queuedRow(SAVED_NAME.UNDELIVERABLE, formatTime(saved.input.occurred_at))} />
    </View>
  );
}
