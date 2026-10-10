/**
 * R30 "Something's wrong" and R31 "Can't deliver" (DL canvas, section 5 "Exceptions"): the leg's
 * own sheet, drawn over the step it was opened from.
 *
 * - Every leg: "In danger or hurt? Call 911 first.", then HalalGoes support with its number and
 *   hours (`PublicConfig`; the row is not drawn when support is off), then the other party's
 *   private number (`phone_alias`, hidden when null), and "Back to the delivery" (pops back to
 *   the step: this screen is registered `back: 'pop'`).
 * - Pickup (DL/SomethingWrongPickup): the restaurant, and the line that only HalalGoes can
 *   release the order (rider incident reporting is Needs API, gap 25). No "I can't deliver"
 *   before the food is in the bag.
 * - Drop-off, steps 3 and 4 (DL/SomethingWrong, SomethingWrongDoor): the customer and "I can't
 *   deliver this order". On the way that sheet offers the return only (CantDeliverEnRoute); at
 *   the door, a customer who asked for LEAVE_AT_DOOR gets "Leave it at the door with a photo and
 *   a statement" first (owner decision, WP5's `tripProof` with `leftAtDoor`), the return second
 *   (CantDeliverConfirm).
 * - Returning (DL/SomethingWrongReturning): the restaurant only, "Back to the return".
 *
 * "Return it to the restaurant" posts UNDELIVERABLE through the outbox (the contract has no
 * reason field on it: `AssignmentTransitionInput` carries `override_reason` for the geofence
 * only). Sending, 5xx (Try again is the same request, same Idempotency-Key) and 409 have their
 * boards; offline the step is saved and the return leg opens with "Not sent yet".
 *
 * Coded reasons and "Tell HalalGoes" (DL/SomethingWrongReasonsAlt) are the Alternative board and
 * are not built; neither is the in-app SOS (gap 31). No halal badge, no seal, nothing red but the
 * 911 button (an emergency call, not a halal state).
 */
import * as React from 'react';
import { View } from 'react-native';

import { Banner, Card, Sheet, space } from '../ds';
import { useSupport } from '../data/config';
import type { TripLeg } from '../dropoff/routes';
import { useNav } from '../nav/Navigator';
import type { ScreenProps } from '../nav/registry';
import {
  ENDED as ENDED_STATES,
  classifyStepError,
  dial,
  prepareStep,
  resyncAfterConflict,
  sendStep,
  useTripAssignment,
  type Assignment,
  type PreparedStep,
} from '../trip/assignment';
import { BUTTON, SOMETHING_WRONG, callName, goTo } from '../trip/copy';
import { Actions, Lead, Line, Screen, StepPending, supportAction, useAlive, type ActionSpec } from '../trip/TripScreens';
import { CANT, CANT_FAILED, CANT_SENDING, EX_BUTTON, MENU, RETURNING } from './copy';
import { RETURN_LEG, cantDeliverWasOpen, legChrome, rememberCantDeliver } from './state';

type Attempt = { phase: 'idle' } | { phase: 'sending' } | { phase: 'failed'; step: PreparedStep };

export function ExceptionScreen({ params }: ScreenProps<'tripException'>): React.ReactElement {
  const { assignmentId: id, leg } = params;
  const view = useTripAssignment(id);
  const nav = useNav();
  const support = useSupport();
  const alive = useAlive();
  const [panel, setPanel] = React.useState<'menu' | 'cant'>(() => (cantDeliverWasOpen(id) ? 'cant' : 'menu'));
  const [attempt, setAttempt] = React.useState<Attempt>({ phase: 'idle' });
  const a = view.assignment;
  const server = a?.state;

  // The delivery ended under the menu (support cancelled it, ops moved it), or the food is going
  // back already (another phone, support): the step this menu belongs to is gone, so follow.
  React.useEffect(() => {
    if (!server || attempt.phase === 'sending') return;
    if (ENDED_STATES.has(server)) nav.replace('tripEnded', { assignmentId: id });
    else if (leg !== 'returning' && RETURN_LEG.has(server)) nav.replace('tripReturn', { assignmentId: id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, attempt.phase, leg, id]);

  // Once: the sheet's own Back and its button can both fire, and a second pop would drop the step.
  const leaving = React.useRef(false);
  const back = () => {
    if (leaving.current) return;
    leaving.current = true;
    rememberCantDeliver(id, false);
    nav.pop();
  };

  /** One UNDELIVERABLE at a time; "Try again" resends the failed one (same key, same body). */
  const busy = React.useRef(false);
  const returnIt = async () => {
    if (busy.current) return;
    busy.current = true;
    const retry = attempt.phase === 'failed' ? attempt.step : null;
    setAttempt({ phase: 'sending' });
    try {
      const step = retry ?? (await prepareStep({ to_state: 'UNDELIVERABLE' }));
      try {
        // Sent or saved offline: either way the food now goes back (DL/CantDeliverQueued).
        await sendStep(id, step);
        rememberCantDeliver(id, false);
        if (alive.current) nav.replace('tripReturn', { assignmentId: id });
      } catch (e) {
        const failure = classifyStepError(e);
        if (!alive.current) return;
        if (failure.kind === 'out-of-date') {
          setAttempt({ phase: 'idle' });
          rememberCantDeliver(id, false);
          await resyncAfterConflict(id, failure.state, view.refetch);
          nav.pop(); // the step under the menu follows the delivery to where it is now
          return;
        }
        setAttempt({ phase: 'failed', step });
      }
    } finally {
      busy.current = false;
    }
  };

  if (!a) return <StepPending view={view} />;
  const chrome = legChrome(leg, a, view.state);
  const customer = a.dropoff.customer_display_name;
  const customerCall: ActionSpec[] = a.dropoff.phone_alias
    ? [{ label: callName(customer), variant: 'tertiary', onPress: () => dial(a.dropoff.phone_alias!) }]
    : [];

  if (attempt.phase === 'sending') {
    return (
      <Screen
        {...chrome}
        testID="ex-cant-sending"
        actions={[{ label: EX_BUTTON.returnIt, variant: 'primary', loading: true, onPress: () => undefined }]}
      >
        <Lead title={CANT_SENDING.title} body={CANT_SENDING.body(a.pickup.restaurant_name)} />
      </Screen>
    );
  }

  if (attempt.phase === 'failed') {
    return (
      <Screen
        {...chrome}
        testID="ex-cant-failed"
        actions={[
          ...customerCall,
          { label: BUTTON.tryAgain, variant: 'primary', onPress: () => void returnIt(), testID: 'ex-cant-retry' },
          {
            label: BUTTON.somethingWrong,
            variant: 'ghost',
            onPress: () => {
              setAttempt({ phase: 'idle' });
              setPanel('menu');
            },
          },
        ]}
      >
        {/* ds-request(native): InlineAlert (slate) — DL/CantDeliverFailed */}
        <Banner variant="neutral" title={CANT_FAILED.title} description={CANT_FAILED.body} testID="ex-cant-failed-banner" />
      </Screen>
    );
  }

  const dropLeg = leg === 'dropoff' || leg === 'door';
  return (
    <Screen {...chrome} testID="ex-menu-screen">
      <Behind leg={leg} a={a} />
      <Sheet
        open={panel === 'menu'}
        onClose={back}
        title={MENU.title}
        testID="ex-menu"
        footer={
          <Actions
            actions={[
              { label: leg === 'returning' ? EX_BUTTON.backToReturn : BUTTON.backToDelivery, variant: 'primary', onPress: back, testID: 'ex-back' },
            ]}
          />
        }
      >
        {/* ds-request(native): Sheet (rider) close IconButton size lg (56) — DL/SomethingWrong* */}
        <View style={{ gap: space['4'] }}>
          <EmergencyBox />
          <Actions
            actions={[
              ...supportAction(support, 'tertiary'),
              ...(dropLeg ? customerCall : restaurantCall(a)),
              ...(dropLeg
                ? [
                    {
                      label: EX_BUTTON.cantDeliver,
                      variant: 'tertiary' as const,
                      onPress: () => {
                        rememberCantDeliver(id, true);
                        setPanel('cant');
                      },
                      testID: 'ex-cant-deliver',
                    },
                  ]
                : []),
            ]}
          />
          {leg === 'pickup' ? <Line tone="secondary">{SOMETHING_WRONG.release}</Line> : null}
        </View>
      </Sheet>
      {dropLeg ? (
        <CantDeliverSheet
          open={panel === 'cant'}
          a={a}
          atDoor={leg === 'door' || view.state === 'ARRIVED_AT_DROPOFF'}
          extra={[...customerCall, ...supportAction(support, 'tertiary')]}
          onReturn={() => void returnIt()}
          onLeave={() => nav.push('tripProof', { assignmentId: id, handover: 'LEFT_AT_DOOR', leftAtDoor: true })}
          onKeep={back}
        />
      ) : null}
    </Screen>
  );
}

/** DL/CantDeliverEnRoute (on the way: the return only) and CantDeliverConfirm (at the door). */
function CantDeliverSheet({
  open,
  a,
  atDoor,
  extra,
  onReturn,
  onLeave,
  onKeep,
}: {
  open: boolean;
  a: Assignment;
  atDoor: boolean;
  extra: ActionSpec[];
  onReturn: () => void;
  onLeave: () => void;
  onKeep: () => void;
}): React.ReactElement {
  const name = a.dropoff.customer_display_name;
  // Leave it at the door only when the customer asked for it, at the door, and the order's proof
  // can be a photo (PHOTO_WITH_ATTESTATION is accepted where PHOTO is required: #290).
  const leave = atDoor && (a.dropoff.delivery_instructions ?? []).includes('LEAVE_AT_DOOR') && a.required_pod_method !== 'OTP';
  const returnAction: ActionSpec = { label: EX_BUTTON.returnIt, variant: leave ? 'tertiary' : 'primary', onPress: onReturn, testID: 'ex-return-it' };
  return (
    <Sheet
      open={open}
      onClose={onKeep}
      title={CANT.title}
      testID="ex-cant"
      footer={
        <Actions
          actions={[
            ...(leave ? [{ label: EX_BUTTON.leaveAtDoor, variant: 'primary' as const, onPress: onLeave, testID: 'ex-leave-at-door' }] : []),
            returnAction,
            { label: atDoor ? EX_BUTTON.keepTrying : EX_BUTTON.keepGoing, variant: 'ghost', onPress: onKeep, testID: 'ex-keep' },
          ]}
        />
      }
    >
      <View style={{ gap: space['4'] }}>
        {!atDoor ? <Line>{CANT.enRoute(name)}</Line> : null}
        {atDoor && leave ? (
          <>
            <Line>{CANT.atDoorLeave(name)}</Line>
            <Line tone="secondary">{CANT.noWait(name)}</Line>
          </>
        ) : null}
        {atDoor && !leave ? <Line>{CANT.atDoor(name)}</Line> : null}
        {extra.length ? <Actions actions={extra} /> : null}
      </View>
    </Sheet>
  );
}

/** The 911 box at the top of every leg's sheet. */
function EmergencyBox(): React.ReactElement {
  return (
    <Card variant="outlined">
      <View style={{ gap: space['3'] }}>
        <Line type="heading.md">{SOMETHING_WRONG.danger}</Line>
        <Actions actions={[{ label: BUTTON.call911, variant: 'danger', onPress: () => dial('911'), testID: 'ex-call-911' }]} />
      </View>
    </Card>
  );
}

export function restaurantCall(a: Assignment, variant: ActionSpec['variant'] = 'tertiary'): ActionSpec[] {
  const phone = a.pickup.phone_alias;
  return phone ? [{ label: callName(a.pickup.restaurant_name), variant, onPress: () => dial(phone), testID: 'ex-call-restaurant' }] : [];
}

/** The step the sheet is drawn over: its heading and address (DL/CantDeliverEnRoute). */
function Behind({ leg, a }: { leg: TripLeg; a: Assignment }): React.ReactElement {
  if (leg === 'pickup') return <Lead title={goTo(a.pickup.restaurant_name)} body={a.pickup.address} />;
  if (leg === 'returning') return <Lead title={RETURNING.heading(a.pickup.restaurant_name)} body={a.pickup.address} />;
  return <Lead title={goTo(a.dropoff.customer_display_name)} body={a.dropoff.address} />;
}
