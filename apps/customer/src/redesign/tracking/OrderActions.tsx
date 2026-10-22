/**
 * What sits around the order page: the Cancel order button and its sheet, the Get help button and
 * its sheet, and the page for an order that has ended. Kept out of `TrackingScreen.tsx` so that file
 * changes in two places only (issue #921, under the redesign tracker #656).
 *
 * - **Cancel order** shows only while the server says the order can still be cancelled for free
 *   (`can_cancel`); a button that goes nowhere is worse than none.
 * - **Get help** shows from the restaurant's acceptance (preparing to arrived), as the contract's
 *   rule for reporting before delivery says. A route that asks for the sheet (`sheet: 'getHelp'`,
 *   from Orders and Receipt) opens it for any order state.
 * - An order that has ended is drawn by `OutcomeScreen`; a delivered or completed one by
 *   `DeliveredScreen`, which has its own Get help button.
 * - While the payment recovery page is up (a bank check, a declined card) it carries its own cancel
 *   button, so this footer's is hidden.
 */
import * as React from 'react';
import { StyleSheet, View } from 'react-native';

import { GetHelpSheet } from '../help/GetHelpSheet';
import { helpKindOf, type RefundReasonCode } from '../help/helpModel';
import { Button, EmptyState } from '../ds';
import { useNav } from '../navigation/context';
import type { OrderCustomerView, OrderTracking } from '../orders/ordersApi';
import { CancelSheet, CancelWindowClosed } from './CancelSheet';
import { DeliveredScreen } from './DeliveredScreen';
import { isDeliveredState } from './deliveredView';
import { OutcomeScreen } from './OutcomeScreen';
import { isOutcomeState } from './outcomeView';
import { isWaitingLayout } from './trackingView';

function useHelp(order: OrderCustomerView) {
  const nav = useNav();
  const asked = nav.current.name === 'tracking' && nav.current.sheet === 'getHelp';
  const [open, setOpen] = React.useState(asked);
  const onReport = React.useCallback(
    (reason: RefundReasonCode | null) => nav.push({ name: 'reportProblem', orderId: order.id, ...(reason ? { reason } : {}) }),
    [nav, order.id],
  );
  return { open, setOpen, onReport };
}

/** The buttons and sheets under a waiting or live order page. */
export function OrderActions({
  order,
  tracking,
  reload,
  hideCancel = false,
}: {
  order: OrderCustomerView;
  tracking: OrderTracking | null;
  reload: () => void;
  /** The payment recovery page is showing and has its own cancel button. */
  hideCancel?: boolean;
}): React.ReactElement | null {
  const help = useHelp(order);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [closed, setClosed] = React.useState(false);

  const canCancel = !hideCancel && isWaitingLayout(order.state) && order.can_cancel === true;
  const showHelp = helpKindOf(order.state) === 'before';
  const accepted = cancelOpen && order.can_cancel === false;

  return (
    <>
      {closed ? (
        <CancelWindowClosed
          order={order}
          onGetHelp={() => {
            help.setOpen(true);
          }}
        />
      ) : null}
      {canCancel || showHelp ? (
        <View style={styles.footer} testID="Tracking-actions">
          {canCancel ? (
            <Button variant="tertiary" size="md" fullWidth onPress={() => setCancelOpen(true)} testID="Tracking-cancel">
              Cancel order
            </Button>
          ) : null}
          {showHelp ? (
            <Button variant="tertiary" size="md" fullWidth onPress={() => help.setOpen(true)} testID="Tracking-getHelp">
              Get help
            </Button>
          ) : null}
        </View>
      ) : null}
      <CancelSheet
        order={order}
        open={cancelOpen}
        accepted={accepted}
        onClose={() => setCancelOpen(false)}
        onCancelled={() => {
          setCancelOpen(false);
          reload();
        }}
        onWindowClosed={() => {
          setCancelOpen(false);
          setClosed(true);
          reload();
        }}
        onGetHelp={() => {
          setCancelOpen(false);
          help.setOpen(true);
        }}
      />
      <GetHelpSheet order={order} tracking={tracking} open={help.open} onClose={() => help.setOpen(false)} onReport={help.onReport} />
    </>
  );
}

/** The page for an order the live and waiting layouts do not draw. */
export function EndedOrder({ order }: { order: OrderCustomerView }): React.ReactElement {
  const nav = useNav();
  const help = useHelp(order);
  return (
    <View style={styles.fill}>
      {isOutcomeState(order.state) ? (
        <OutcomeScreen order={order} />
      ) : isDeliveredState(order.state) ? (
        <DeliveredScreen order={order} onGetHelp={() => help.setOpen(true)} />
      ) : (
        // A state this build does not know (the contract grew one): say so rather than guess.
        <EmptyState
          variant="page"
          headingLevel={1}
          title="We can't show this order here yet"
          description="Your order is safe. Update the app to see it, or find it in Orders."
          primaryAction={{ label: 'See your orders', onPress: () => nav.selectTab('orders') }}
          testID="Tracking-unknownState"
        />
      )}
      <GetHelpSheet order={order} tracking={null} open={help.open} onClose={() => help.setOpen(false)} onReport={help.onReport} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  footer: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, gap: 8 },
});
