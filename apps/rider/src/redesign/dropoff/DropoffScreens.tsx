/**
 * WP5 the drop-off leg, steps 3 and 4 (DL canvas, section 4 "Drop-off leg"): go to the customer,
 * at the door, and how the bag is handed over.
 *
 * - `tripDropoff` (R23 + R24): PICKED_UP posts EN_ROUTE_TO_DROPOFF by itself (no button); "I'm
 *   here" posts ARRIVED_AT_DROPOFF through the outbox (offline it is saved and the step moves on
 *   with "Not sent yet"); 422 GEOFENCE_REQUIRED opens the override sheet, never strands the rider.
 *   At the door the heading and the "Customer asked" rows come from `delivery_instructions`;
 *   with no connection (or the arrival still saved) the bag stays with the rider
 *   (TripNoConnection, DropoffArriveQueued): proof needs a connection.
 * - `tripHandover` (R25): nothing pre-selected; all four `HandoverMethod`s for a photo proof,
 *   only met handovers for the customer's code.
 *
 * Trip steps have no Back (registered `back: 'none'`). "Something's wrong" opens the leg's sheet
 * (`tripException`, WP6). No halal badge, no seal, nothing red: every banner is slate.
 */
import * as React from 'react';
import { View } from 'react-native';

import { Banner, Button, MapView, Radio, RadioGroup, Sheet, Input, space } from '../ds';
import { useOnline } from '../data/connectivity';
import { outbox } from '../data/outbox';
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
  sendStep,
  useFollowTrip,
  useTripAssignment,
  type Assignment,
  type PreparedStep,
} from '../trip/assignment';
import { BUTTON, STEP_NAME, goTo, queuedRow } from '../trip/copy';
import {
  Actions,
  Facts,
  Lead,
  Line,
  MessagesLink,
  SavedRow,
  SavedSteps,
  Screen,
  StepPending,
  TripBanners,
  useAlive,
  type ActionSpec,
} from '../trip/TripScreens';
import {
  ADDRESS,
  ARRIVE_FAILED,
  ARRIVING,
  CUSTOMER_ASKED,
  DO_NOT_CALL_LINE,
  DROPOFF_TITLE,
  DROP_BUTTON,
  GEOFENCE,
  HANDOVER,
  HANDOVER_LABEL,
  HANDOVER_OTP_LABEL,
  HANDOVER_TITLE,
  INSTRUCTION,
  KEEP_BAG,
  NEXT_PROOF,
  PROOF_LABEL,
  PROOF_NEEDED,
  PROOF_NEEDED_NEXT,
  SUBTITLE,
  doorHeading,
  doorLine,
  enRouteHeading,
  nextLabel,
  quoted,
} from './copy';
import { MarkDeliveredScreen } from './ProofScreens';
import { REASON_MAX, REASON_MIN, claimEnRoute } from './proof';
import type { HandoverMethod } from './routes';

const DETAILS = { unit: 'Unit', buzzer: 'Buzzer' };

/* ================================================================== R23 + R24 steps 3 and 4 */

type Arrive = { phase: 'idle' } | { phase: 'sending' } | { phase: 'failed'; step: PreparedStep };

export function DropoffScreen({ params }: ScreenProps<'tripDropoff'>): React.ReactElement {
  const id = params.assignmentId;
  const view = useTripAssignment(id);
  // Delivered from here replaces the whole flow (`openFlow('tripDelivered')`), so a DELIVERED
  // answer routed to `tripEnded` first is overtaken; one from elsewhere (support) still ends here.
  useFollowTrip(id, view, 'tripDropoff');
  const nav = useNav();
  const online = useOnline();
  const alive = useAlive();
  const a = view.assignment;
  const state = view.state;
  const [arrive, setArrive] = React.useState<Arrive>({ phase: 'idle' });
  const [geofence, setGeofence] = React.useState(false);
  const [reason, setReason] = React.useState('');

  // The food is going back (WP6): that leg has its own screens.
  React.useEffect(() => {
    if (state === 'UNDELIVERABLE' || state === 'RETURNING') nav.replace('tripReturn', { assignmentId: id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, id]);

  // EN_ROUTE_TO_DROPOFF: once, by itself, right after the pickup (DL note). Its last attempt is
  // kept so "I'm here" can resend a failed one (same key) before the arrival.
  const start = React.useRef<{ step: PreparedStep | null; sent: Promise<boolean> } | null>(null);
  const sendStart = React.useCallback(
    (retry?: PreparedStep) => {
      const record: { step: PreparedStep | null; sent: Promise<boolean> } = { step: retry ?? null, sent: Promise.resolve(false) };
      record.sent = (async () => {
        const step = retry ?? (await prepareStep({ to_state: 'EN_ROUTE_TO_DROPOFF' }));
        record.step = step;
        try {
          await sendStep(id, step);
          return true;
        } catch (e) {
          const failure = classifyStepError(e);
          if (failure.kind !== 'out-of-date') return false;
          await resyncAfterConflict(id, failure.state, view.refetch);
          return true;
        }
      })();
      start.current = record;
      return record.sent;
    },
    [id, view.refetch],
  );
  React.useEffect(() => {
    if (view.assignment?.state === 'PICKED_UP' && view.saved.length === 0 && claimEnRoute(id)) void sendStart();
  }, [id, sendStart, view.assignment?.state, view.saved.length]);

  /** One arrival at a time: a second tap while the first waits for a GPS fix sends nothing. */
  const busy = React.useRef(false);
  const arrived = async (overrideReason?: string) => {
    if (busy.current) return;
    busy.current = true;
    const retry = arrive.phase === 'failed' && !overrideReason ? arrive.step : null;
    setArrive({ phase: 'sending' });
    try {
      // The machine has no PICKED_UP → ARRIVED_AT_DROPOFF: "on my way" goes first if it has not.
      const startSaved = outbox.pendingFor(id).some((e) => e.input.to_state === 'EN_ROUTE_TO_DROPOFF');
      if (cachedAssignment(id)?.state === 'PICKED_UP' && !startSaved) {
        const last = start.current;
        const ok = await (last ? last.sent.then((done) => done || sendStart(last.step ?? undefined)) : sendStart());
        if (!ok) {
          const step = retry ?? (await prepareStep({ to_state: 'ARRIVED_AT_DROPOFF' }));
          if (alive.current) setArrive({ phase: 'failed', step });
          return;
        }
      }
      const step =
        retry ?? (await prepareStep(overrideReason ? { to_state: 'ARRIVED_AT_DROPOFF', override_reason: overrideReason } : { to_state: 'ARRIVED_AT_DROPOFF' }));
      try {
        await sendStep(id, step);
        if (alive.current) setArrive({ phase: 'idle' });
      } catch (e) {
        const failure = classifyStepError(e);
        if (!alive.current) return;
        if (failure.kind === 'geofence') {
          setArrive({ phase: 'idle' });
          setGeofence(true);
        } else if (failure.kind === 'out-of-date') {
          setArrive({ phase: 'idle' });
          await resyncAfterConflict(id, failure.state, view.refetch);
        } else {
          setArrive({ phase: 'failed', step });
        }
      }
    } finally {
      busy.current = false;
    }
  };

  if (!a || !state) return <StepPending view={view} />;
  // Proof recorded, DELIVERED not yet: the last tap is all that is left (cold start, a retry).
  if (state === 'ARRIVED_AT_DROPOFF' && a.pod_recorded) {
    return <MarkDeliveredScreen assignmentId={id} method={a.required_pod_method} />;
  }

  const d = a.dropoff;
  const instructions = d.delivery_instructions ?? [];
  const doNotCall = instructions.includes('DO_NOT_CALL');
  const call = d.phone_alias ? () => dial(d.phone_alias!) : null;
  const wrong = (leg: 'dropoff' | 'door') => () => nav.push('tripException', { assignmentId: id, leg });
  const pending = view.saved.filter((e) => e.status === 'pending');

  if (arrive.phase === 'sending') {
    return (
      <Screen
        title={DROPOFF_TITLE}
        subtitle={SUBTITLE.goToCustomer}
        progress={3}
        testID="dropoff-arriving"
        actions={[{ label: DROP_BUTTON.arrived, variant: 'primary', loading: true, onPress: () => undefined }]}
      >
        <Lead title={ARRIVING.title} body={ARRIVING.body} />
      </Screen>
    );
  }

  /* ---------------------------------------------------------------- step 4: at the door */
  if (state === 'ARRIVED_AT_DROPOFF') {
    // The arrival is still on the phone, or the phone is offline: proof cannot be sent yet.
    const arrivalSaved = pending.some((e) => e.input.to_state === 'ARRIVED_AT_DROPOFF');
    const keepBag = arrivalSaved || !online;
    const callAction: ActionSpec[] = call
      ? [{ label: keepBag ? `Call ${d.customer_display_name}` : DROP_BUTTON.callCustomer, variant: 'tertiary', onPress: call }]
      : [];
    const handOver: ActionSpec = {
      label: DROP_BUTTON.handOver,
      variant: 'primary',
      onPress: () => nav.push('tripHandover', { assignmentId: id }),
      disabled: keepBag,
      helper: keepBag ? KEEP_BAG.helper : undefined,
      testID: 'dropoff-hand-over',
    };
    return (
      <Screen
        title={DROPOFF_TITLE}
        subtitle={SUBTITLE.handOver}
        progress={4}
        testID={keepBag ? 'dropoff-keep-bag' : 'dropoff-door'}
        actions={keepBag ? [...callAction, handOver, wrongAction(wrong('door'))] : [...callAction, wrongAction(wrong('door')), handOver]}
      >
        <TripBanners view={view} offlineBody={KEEP_BAG.bannerBody} />
        {arrivalSaved ? <SavedSteps entries={pending} /> : null}
        {keepBag ? (
          <>
            <Lead title={KEEP_BAG.title} body={arrivalSaved ? KEEP_BAG.queuedBody : KEEP_BAG.offlineBody(d.customer_display_name)} />
            <Facts mono rows={[[DETAILS.unit, d.unit ?? null], [DETAILS.buzzer, d.buzzer ?? null]]} />
          </>
        ) : (
          <>
            <Lead title={doorHeading(d.customer_display_name, instructions)} />
            <CustomerAsked a={a} />
            <Facts rows={[[ADDRESS, d.address]]} />
            <Facts mono rows={[[DETAILS.unit, d.unit ?? null], [DETAILS.buzzer, d.buzzer ?? null]]} />
            <Line>{doorLine(a.required_pod_method, d.customer_display_name)}</Line>
            <MessagesLink onPress={() => nav.push('tripContact', { assignmentId: id })} />
          </>
        )}
      </Screen>
    );
  }

  /* ---------------------------------------------------------------- step 3: go to the customer */
  // DO_NOT_CALL with an alias: Call is demoted to a ghost button under the instructions.
  const footerCall: ActionSpec[] = call && !doNotCall ? [{ label: DROP_BUTTON.callCustomer, variant: 'tertiary', onPress: call }] : [];
  return (
    <Screen
      title={DROPOFF_TITLE}
      subtitle={SUBTITLE.goToCustomer}
      progress={3}
      testID="dropoff-en-route"
      actions={[
        ...footerCall,
        wrongAction(wrong('dropoff')),
        { label: DROP_BUTTON.arrived, variant: 'primary', onPress: () => void arrived(), testID: 'dropoff-arrive' },
      ]}
    >
      <TripBanners view={view} offlineBody={KEEP_BAG.bannerBody} />
      <SavedSteps entries={pending} />
      {arrive.phase === 'failed' ? (
        // ds-request(native): InlineAlert (slate) — DL/DropoffArriveFailed
        <Banner variant="neutral" title={ARRIVE_FAILED.title} description={ARRIVE_FAILED.body(d.customer_display_name)} testID="dropoff-arrive-failed" />
      ) : null}
      {/* ds-request(native): MapView pins with the dark-mode outline — DL/DropoffEnRoute */}
      <MapView
        summary={`${goTo(d.customer_display_name)}. ${d.address}`}
        customer={{ latitude: d.latitude, longitude: d.longitude }}
        interactive={false}
        follow="fit-all"
        height={160}
      />
      <Button variant="tertiary" size="xl" fullWidth onPress={() => openDirections(d.latitude, d.longitude)} testID="dropoff-navigate">
        {BUTTON.navigate}
      </Button>
      <Lead title={enRouteHeading(d.customer_display_name, instructions)} body={d.address} />
      <Facts mono rows={[[DETAILS.unit, d.unit ?? null], [DETAILS.buzzer, d.buzzer ?? null]]} />
      <CustomerAsked a={a} />
      {call && doNotCall ? (
        <View style={{ gap: space['2'] }}>
          <Line tone="secondary">{DO_NOT_CALL_LINE}</Line>
          <Button variant="ghost" size="xl" fullWidth onPress={call} testID="dropoff-call-anyway">
            {`Call ${d.customer_display_name}`}
          </Button>
        </View>
      ) : null}
      <Facts rows={[[PROOF_NEEDED, PROOF_LABEL[a.required_pod_method]]]} />
      <MessagesLink onPress={() => nav.push('tripContact', { assignmentId: id })} />
      <Sheet
        open={geofence}
        onClose={() => setGeofence(false)}
        dismissible={false}
        title={GEOFENCE.title}
        testID="dropoff-geofence"
        footer={
          <Actions
            actions={[
              wrongAction(() => {
                setGeofence(false);
                wrong('dropoff')();
              }),
              {
                label: DROP_BUTTON.arrivedOverride,
                variant: 'primary',
                disabled: reason.trim().length < REASON_MIN,
                testID: 'dropoff-geofence-continue',
                onPress: () => {
                  setGeofence(false);
                  void arrived(reason.trim());
                },
              },
              { label: BUTTON.notThereYet, variant: 'tertiary', onPress: () => setGeofence(false) },
            ]}
          />
        }
      >
        <View style={{ gap: space['4'] }}>
          <Lead title={goTo(d.customer_display_name)} body={d.address} level={3} />
          <Line>{GEOFENCE.body(d.address)}</Line>
          {/* ds-request(native): TextArea (rider, 56 min, 7:1 helper and counter) — DL/DropoffGeofence */}
          <Input
            label={GEOFENCE.label}
            value={reason}
            onChange={setReason}
            size="lg"
            required
            maxLength={REASON_MAX}
            characterCount
            helperText={GEOFENCE.helper}
            testID="dropoff-geofence-reason"
          />
        </View>
      </Sheet>
    </Screen>
  );
}

function wrongAction(onPress: () => void): ActionSpec {
  return { label: BUTTON.somethingWrong, variant: 'ghost', onPress, testID: 'dropoff-something-wrong' };
}

/** "Customer asked": one row per instruction, then `special_instructions` verbatim, never cut. */
function CustomerAsked({ a }: { a: Assignment }): React.ReactElement | null {
  const rows = (a.dropoff.delivery_instructions ?? []).map((i) => INSTRUCTION[i]);
  const special = a.dropoff.special_instructions;
  if (!rows.length && !special) return null;
  return (
    // ds-request(native): KeyValueList (label over rows) — DL/DropoffEnRoute, DropoffArrived
    <View style={{ gap: space['1'] }} testID="dropoff-customer-asked">
      <Line tone="secondary" type="label.lg">
        {CUSTOMER_ASKED}
      </Line>
      {rows.map((row) => (
        <Line key={row}>{row}</Line>
      ))}
      {special ? <Line>{quoted(special)}</Line> : null}
    </View>
  );
}

/* ================================================================== R25 hand it over */

const ALL_HANDOVERS: readonly HandoverMethod[] = ['HANDED_TO_CUSTOMER', 'LEFT_AT_DOOR', 'LEFT_WITH_RECEPTION', 'HANDED_TO_OTHER_PERSON'];

/** The rows the board lists: every method for a photo proof; met handovers only for the code. */
export function handoverChoices(a: Assignment): readonly HandoverMethod[] {
  if (a.required_pod_method !== 'OTP') return ALL_HANDOVERS;
  const met: HandoverMethod[] = ['HANDED_TO_CUSTOMER', 'HANDED_TO_OTHER_PERSON'];
  if (a.dropoff.delivery_instructions?.includes('MEET_IN_LOBBY')) met.push('LEFT_WITH_RECEPTION');
  return met;
}

export function HandoverScreen({ params }: ScreenProps<'tripHandover'>): React.ReactElement {
  const id = params.assignmentId;
  const view = useTripAssignment(id);
  useFollowTrip(id, view, 'tripDropoff');
  const nav = useNav();
  const online = useOnline();
  // Nothing pre-selected (DL note).
  const [picked, setPicked] = React.useState<HandoverMethod | null>(null);
  const a = view.assignment;
  if (!a) return <StepPending view={view} />;

  const method = a.required_pod_method;
  const otp = method === 'OTP';
  const labels = otp ? HANDOVER_OTP_LABEL : HANDOVER_LABEL;
  const savedArrival = view.saved.find((e) => e.input.to_state === 'ARRIVED_AT_DROPOFF' && e.status === 'pending');
  const blocked = !online || !!savedArrival;
  return (
    <Screen
      title={HANDOVER_TITLE}
      subtitle={SUBTITLE.handoverOrder(a.order_code ?? '')}
      progress={4}
      testID="dropoff-handover"
      actions={[
        { label: BUTTON.somethingWrong, variant: 'ghost', onPress: () => nav.push('tripException', { assignmentId: id, leg: 'door' }) },
        {
          label: nextLabel(method, picked !== null),
          variant: 'primary',
          disabled: picked === null || blocked,
          helper: blocked ? KEEP_BAG.helper : undefined,
          onPress: () => picked && nav.push('tripProof', { assignmentId: id, handover: picked }),
          testID: 'dropoff-handover-next',
        },
      ]}
    >
      <TripBanners view={view} offlineBody={KEEP_BAG.bannerBody} />
      {savedArrival ? <SavedRow label={queuedRow(STEP_NAME.ARRIVED_AT_DROPOFF!, formatTime(savedArrival.input.occurred_at))} /> : null}
      <Lead title={otp ? HANDOVER.otpTitle : HANDOVER.title} body={otp ? HANDOVER.otpBody : undefined} />
      {/* ds-request(native): RadioGroup roomy (72 rows, body-lg labels) — DL/Handover, HandoverOtp */}
      <RadioGroup
        name="handover"
        label={otp ? HANDOVER.otpTitle : HANDOVER.title}
        value={picked}
        onChange={(next) => setPicked(next as HandoverMethod)}
        required
        testID="dropoff-handover-group"
      >
        {handoverChoices(a).map((m) => (
          <Radio key={m} value={m} label={labels[m] ?? HANDOVER_LABEL[m]} testID={`dropoff-handover-${m}`} />
        ))}
      </RadioGroup>
      <Facts rows={[[PROOF_NEEDED_NEXT, NEXT_PROOF[method]]]} />
    </Screen>
  );
}
