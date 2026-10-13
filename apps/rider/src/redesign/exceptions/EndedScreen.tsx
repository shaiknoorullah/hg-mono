/**
 * R31 Returned and R32 the trip ended (DL canvas, section 5): the screen WP4's trip host routes
 * every terminal state to (`tripEnded`).
 *
 * - RETURNED (DL/Returned, ReturnedPaid): "Returned to <restaurant>", no promise of pay (the
 *   undelivered-food policy is open); a ledger line only when one exists.
 * - RETURNED saved offline (DL/ReturnedQueued): "Not sent yet" with the rows, "Back to Home"
 *   leaves the saved steps to send by themselves.
 * - CANCELLED_BY_PLATFORM before pickup (DL/OrderCancelled): the trip ends; Back to Home closes
 *   the flow, forgets the saved steps and re-reads the session and the dashboard. The heading is
 *   the HalalGoes one: the contract carries no `order.cancelled.by` for the restaurant and
 *   customer headings (OrderCancelledByRestaurant, OrderCancelledByCustomer: Needs API, polling
 *   only, #29). The sentence under it follows the dashboard's mode.
 * - CANCELLED_BY_PLATFORM after pickup (DL/OrderCancelledAfterPickup): don't deliver it; support
 *   is the primary; the closing step (CancelledFoodConfirm) records nothing (Needs API, gap 24).
 * - REASSIGNED before pickup (DL/Reassigned) and after (ReassignedAfterPickup, closing on
 *   CancelledFoodConfirmReassigned): no earnings are claimed.
 * - DELIVERED reached from elsewhere (support): WP5's Delivered screen.
 *
 * Money only from the ledger: each `EarningEntry` matched on `assignment_id`, its `gross_cents`
 * through `Price`, never summed; nothing while unknown. After the end the address is cut to street
 * level and the customer call is gone. "See messages about this order" is shown only when notes
 * exist; with polling and no notes history (gap 22) there are none, so it is not drawn.
 * Registered `back: 'none'`. No halal badge, no seal, nothing red, no green.
 */
import * as React from 'react';
import { View } from 'react-native';
import { cents } from '@hg/api-client';

import { Banner, Card, Price, Sheet, space } from '../ds';
import { useSupport } from '../data/config';
import type { EarningEntry } from '../dropoff/proof';
import { ENTRY_TYPE_WORD } from '../earnings/format';
import { formatTime } from '../format/time';
import { useRiderDashboard } from '../home';
import { goOffline } from '../home/availability';
import { useNav } from '../nav/Navigator';
import type { ScreenProps } from '../nav/registry';
import { ENDED as ENDED_STATES, routeFor, useTripAssignment, type Assignment } from '../trip/assignment';
import { BUTTON, NOT_SENT, orderSubtitle, queuedRow } from '../trip/copy';
import { Actions, Facts, Lead, Line, SavedRow, Screen, StepPending, supportAction, type ActionSpec } from '../trip/TripScreens';
import { CONFIRM, ENDED, EX_BUTTON, RETURNING, RETURN_QUEUED, SAVED_NAME, TITLE, streetLevel } from './copy';
import { restaurantCall } from './ExceptionScreen';
import { RETURN_LEG, afterPickup, useEndedEntries, useLeaveTrip } from './state';

export function EndedScreen({ params }: ScreenProps<'tripEnded'>): React.ReactElement {
  const id = params.assignmentId;
  const view = useTripAssignment(id);
  const nav = useNav();
  const dash = useRiderDashboard();
  const leave = useLeaveTrip(id);
  const a = view.assignment;
  const server = a?.state;
  const state = view.state;
  const ended = !!server && ENDED_STATES.has(server);
  const showsPay = server === 'RETURNED' || (server === 'CANCELLED_BY_PLATFORM' && !!a && !afterPickup(a));
  const entries = useEndedEntries(id, showsPay);

  // The server moves the rider back online (or offline, if they asked) when a delivery ends:
  // read the mode now for the sentence, rather than on the next poll.
  React.useEffect(() => {
    if (ended) void dash.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended]);

  // Not an end after all (a saved "I've returned it" refused, a 409 elsewhere), or delivered
  // from elsewhere: the screen for it takes over.
  React.useEffect(() => {
    if (!state || !a) return;
    if (state === 'DELIVERED' && server === 'DELIVERED') {
      nav.replace('tripDelivered', { assignmentId: id, method: a.required_pod_method, at: a.delivered_at ?? new Date().toISOString() });
    } else if (!ENDED_STATES.has(state)) {
      nav.replace(RETURN_LEG.has(state) ? 'tripReturn' : routeFor(state), { assignmentId: id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, server, id]);

  if (!a || !state || !ENDED_STATES.has(state) || state === 'DELIVERED') return <StepPending view={view} />;
  const subtitle = orderSubtitle(a.order_code ?? '');
  const offline = dash.mode === 'OFFLINE';
  const restaurant = a.pickup.restaurant_name;
  const wentTo = <Facts rows={[[ENDED.wasGoingTo, streetLevel(a.dropoff.address)]]} />;
  const home: ActionSpec = { label: BUTTON.backToHome, variant: 'primary', onPress: () => leave(), testID: 'ended-home' };

  // "I've returned it" is saved on the phone; the server still has the food going back.
  if (state === 'RETURNED' && server !== 'RETURNED') {
    const rows = view.saved.filter((e) => e.status === 'pending' && (e.input.to_state === 'UNDELIVERABLE' || e.input.to_state === 'RETURNED'));
    return (
      <Screen
        title={TITLE.returning}
        subtitle={subtitle}
        testID="ended-return-saved"
        actions={[
          {
            label: BUTTON.somethingWrong,
            variant: 'ghost',
            onPress: () => nav.push('tripException', { assignmentId: id, leg: 'returning' }),
          },
          { ...home, onPress: () => leave({ keepSaved: true }) },
        ]}
      >
        {/* ds-request(native): InlineAlert (slate, the one live region) — DL/ReturnedQueued */}
        <Banner variant="neutral" title={NOT_SENT} description={RETURN_QUEUED.body} testID="ended-return-saved-banner" />
        {rows.map((e) => (
          <SavedRow
            key={e.id}
            label={queuedRow(e.input.to_state === 'RETURNED' ? SAVED_NAME.RETURNED : SAVED_NAME.UNDELIVERABLE, formatTime(e.input.occurred_at))}
          />
        ))}
        <Facts mono rows={[[RETURNING.orderCode, a.order_code ?? null]]} />
      </Screen>
    );
  }

  if (state === 'RETURNED') {
    return (
      <Screen title={TITLE.returned} subtitle={subtitle} testID="ended-returned" actions={[home]}>
        <Lead title={ENDED.returned(restaurant)} body={ENDED.closed} />
        <Pay entries={entries} />
        {wentTo}
      </Screen>
    );
  }

  if (!afterPickup(a)) {
    const cancelled = state === 'CANCELLED_BY_PLATFORM';
    return (
      <Screen
        title={cancelled ? TITLE.cancelled : TITLE.moved}
        subtitle={subtitle}
        testID={cancelled ? 'ended-cancelled' : 'ended-moved'}
        actions={[home]}
      >
        <Lead
          title={cancelled ? ENDED.cancelled : ENDED.moved}
          body={cancelled ? ENDED.cancelledLine(restaurant, offline) : ENDED.movedLine(restaurant, offline)}
        />
        {cancelled ? (
          <>
            {wentTo}
            <Pay entries={entries} />
          </>
        ) : null}
      </Screen>
    );
  }

  return <AfterPickup a={a} subtitle={subtitle} offline={offline} leave={() => leave()} />;
}

/**
 * DL/OrderCancelledAfterPickup and ReassignedAfterPickup: the rider still has the food. Support
 * is the primary (the restaurant when support is off); "Done" opens the closing step, which
 * records nothing.
 */
function AfterPickup({
  a,
  subtitle,
  offline,
  leave,
}: {
  a: Assignment;
  subtitle: string;
  offline: boolean;
  leave: () => void;
}): React.ReactElement {
  const support = useSupport();
  const [confirming, setConfirming] = React.useState(false);
  const [goingOffline, setGoingOffline] = React.useState(false);
  const cancelled = a.state === 'CANCELLED_BY_PLATFORM';
  const supportFirst = supportAction(support, 'primary');
  const restaurant = restaurantCall(a, supportFirst.length ? 'ghost' : 'primary');
  const offlineNow = (then?: () => void) => {
    setGoingOffline(true);
    void goOffline().finally(() => {
      setGoingOffline(false);
      then?.();
    });
  };
  const goOfflineAction = (testID: string, then?: () => void): ActionSpec[] =>
    offline ? [] : [{ label: EX_BUTTON.goOffline, variant: 'tertiary', loading: goingOffline, onPress: () => offlineNow(then), testID }];

  return (
    <Screen
      title={cancelled ? TITLE.cancelled : TITLE.moved}
      subtitle={subtitle}
      testID={cancelled ? 'ended-cancelled-after' : 'ended-moved-after'}
      actions={[
        ...(supportFirst.length ? supportFirst : restaurant),
        { label: cancelled ? EX_BUTTON.doneFood : EX_BUTTON.doneBag, variant: 'tertiary', onPress: () => setConfirming(true), testID: 'ended-done' },
        ...(cancelled ? goOfflineAction('ended-go-offline') : []),
        ...(supportFirst.length ? restaurant : []),
      ]}
    >
      {/* DL/CancelledFoodConfirm draws "Don't deliver it" behind its sheet; the reassigned one keeps the heading. */}
      <Lead title={cancelled ? (confirming ? CONFIRM.foodHeading : ENDED.cancelled) : ENDED.moved} body={cancelled ? ENDED.dontDeliver : ENDED.keepBag} />
      {/* Needs API (gap 24): the food disposition / hand-back instruction. */}
      <Line>{cancelled ? ENDED.foodInstruction : ENDED.bagInstruction}</Line>
      {cancelled ? <Line tone="secondary">{ENDED.newOffers}</Line> : null}
      <Sheet
        open={confirming}
        onClose={() => setConfirming(false)}
        title={cancelled ? CONFIRM.foodTitle : CONFIRM.bagTitle}
        testID="ended-confirm"
        footer={
          <Actions
            actions={[
              { label: cancelled ? EX_BUTTON.dealtWithFood : EX_BUTTON.handedOver, variant: 'primary', onPress: leave, testID: 'ended-confirm-done' },
              ...goOfflineAction('ended-confirm-offline', leave),
            ]}
          />
        }
      >
        {/* ds-request(native): Sheet (rider) close IconButton size lg (56) — DL/CancelledFoodConfirm */}
        <View style={{ gap: space['4'] }}>
          <Line>{cancelled ? CONFIRM.foodBody : CONFIRM.bagBody}</Line>
          <Actions actions={supportAction(support, 'tertiary')} />
          <Line tone="secondary">{ENDED.newOffers}</Line>
        </View>
      </Sheet>
    </Screen>
  );
}

/**
 * The ledger's lines for this delivery, each its own amount as returned (DL/ReturnedPaid,
 * OrderCancelled); a CANCELLATION_COMPENSATION line reads "Paid for your time". Nothing while
 * none exists: the offer estimate is never shown here.
 */
function Pay({ entries }: { entries: readonly EarningEntry[] }): React.ReactElement | null {
  if (!entries.length) return null;
  return (
    <Card variant="outlined" testID="ended-pay">
      <View style={{ gap: space['3'] }}>
        {entries.map((e) => {
          const label = e.type === 'CANCELLATION_COMPENSATION' ? ENDED.paidForTime : ENTRY_TYPE_WORD[e.type];
          return (
            <View key={e.id} style={{ gap: space['1'] }} accessible accessibilityLabel={label}>
              <Line tone="secondary" type="label.lg">
                {label}
              </Line>
              <Price cents={cents(Number(e.gross_cents))} size="lg" testID={`ended-pay-${e.id}`} />
            </View>
          );
        })}
      </View>
    </Card>
  );
}
