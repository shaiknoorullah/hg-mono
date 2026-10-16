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
 * - An order that has ended is drawn by `OutcomeScreen`. A delivered or completed order still falls
 *   back to the legacy tracking screen until its own screen is built, with Get help available.
 */
import * as React from 'react';
import { StyleSheet, View } from 'react-native';

import { TrackingScreen as LegacyTrackingScreen } from '../../screens/TrackingScreen';
import { GetHelpSheet } from '../help/GetHelpSheet';
import { helpKindOf, type RefundReasonCode } from '../help/helpModel';
import { Button } from '../ds';
import { LegacyBridge } from '../navigation/LegacyBridge';
import { useNav } from '../navigation/context';
import type { OrderCustomerView, OrderTracking } from '../orders/ordersApi';
import { CancelSheet, CancelWindowClosed } from './CancelSheet';
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
}: {
  order: OrderCustomerView;
  tracking: OrderTracking | null;
  reload: () => void;
}): React.ReactElement | null {
  const help = useHelp(order);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [closed, setClosed] = React.useState(false);

  const canCancel = isWaitingLayout(order.state) && order.can_cancel === true;
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
      ) : (
        <LegacyBridge nav={nav} route={{ name: 'tracking', orderId: order.id }}>
          <LegacyTrackingScreen orderId={order.id} />
        </LegacyBridge>
      )}
      <GetHelpSheet order={order} tracking={null} open={help.open} onClose={() => help.setOpen(false)} onReport={help.onReport} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  footer: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, gap: 8 },
});
