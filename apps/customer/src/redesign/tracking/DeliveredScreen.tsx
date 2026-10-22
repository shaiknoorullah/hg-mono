/**
 * The page for an order that has been delivered, and for one that is complete (the `Track-Delivered*`
 * and `Track-Completed*` boards of the customer redesign, issue #921 under the redesign tracker #656).
 * It is a separate screen from the live page: no map, no rider, no halal badge.
 *
 * - **Delivered**: the time it arrived, what the customer asked for at the door, the timeline, what
 *   was charged and any refund. Get help is the one action; a receipt is promised, not offered, until
 *   the order is complete.
 * - **Completed**: the same page with "View receipt" as the primary action.
 *
 * Rules (the full list is in `deliveredView.ts`): the handover line says what was *asked*, never what
 * happened; the restaurant card carries no halal badge after delivery; "Charged" is the payment
 * record's captured amount and nothing is subtracted; there is no rating action.
 *
 * Every state is drawn: the money card has its own loading and error, a failed timeline read only
 * leaves the timeline's own rows out.
 */
import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppBar, Badge, Button, Card, Price, Skeleton, StatusTimeline, useTheme, useTypeStyle } from '../ds';
import { useServerNow } from '../lib/now';
import { useQuery } from '../lib/query';
import { useNav } from '../navigation/context';
import { cardName } from '../orders/format';
import type { OrderCustomerView } from '../orders/ordersApi';
import { deliveredActionsOf, deliveredHeadingOf, refundRowFor, type DeliveredRefundRow } from './deliveredView';
import { readOutcome, type OutcomeData } from './outcomeApi';

/** The fixed words on the page (the heading and refund wording live in `deliveredView.ts`). */
export const DELIVERED_COPY = {
  backToOrders: 'Back to Orders',
  charged: 'Charged',
  moneyErrorTitle: "We couldn't load your payment details",
  moneyErrorBody: "This doesn't change your order.",
  tryAgain: 'Try again',
  viewReceipt: 'View receipt',
  getHelp: 'Get help with this order',
  loadingMoney: 'Loading your payment details',
} as const;

/** The page for a delivered or completed order; `onGetHelp` opens the Get help sheet. */
export function DeliveredScreen({ order, onGetHelp }: { order: OrderCustomerView; onGetHelp: () => void }): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const display = useTypeStyle('display.md');
  const labelLg = useTypeStyle('label.lg');
  const bodySm = useTypeStyle('body.sm');
  const now = useServerNow(60_000);
  const { query, reload } = useQuery<OutcomeData>(() => readOutcome(order.id, true), [order.id, order.state]);

  const heading = deliveredHeadingOf(order);
  const { actions, note } = deliveredActionsOf(order);
  const data = query.kind === 'ready' ? query.data : null;
  const payment = data?.payment ?? null;
  const refund = data ? refundRowFor(data.refunds, payment ? cardName(payment) : null) : null;
  const secondary = { color: theme.color.text.secondary };

  return (
    <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="Delivered">
      <AppBar
        title={`Order ${order.code}`}
        subtitle={order.restaurant.name}
        back={{ onPress: () => nav.selectTab('orders'), previousTitle: 'Orders' }}
        backLabel={DELIVERED_COPY.backToOrders}
        tone="cream"
        isPageHeading={false}
      />
      <ScrollView contentContainerStyle={styles.page} testID="Delivered-body">
        <View
          style={styles.gap4}
          accessible
          accessibilityRole="header"
          aria-level={1}
          accessibilityLabel={heading.spoken}
          testID="Delivered-h1"
        >
          {heading.overline ? (
            <Text aria-hidden style={[labelLg, secondary]}>
              {heading.overline}
            </Text>
          ) : null}
          <Text aria-hidden style={[display, { color: theme.color.text.primary }]}>
            {heading.display}
          </Text>
          {heading.line ? (
            <Text style={[bodySm, secondary]} testID="Delivered-handover">
              {heading.line}
            </Text>
          ) : null}
        </View>

        <StatusTimeline
          audience="customer"
          state={order.state}
          transitions={data?.timeline ?? undefined}
          orientation="compact"
          now={now}
          testID="Delivered-timeline"
        />

        <Card variant="outlined" radius={16} testID="Delivered-money">
          <View style={styles.gap8}>
            <Text accessibilityRole="header" aria-level={2} style={[labelLg, { color: theme.color.text.primary }]} testID="Delivered-restaurant">
              {order.restaurant.name}
            </Text>
            {query.kind === 'loading' ? (
              <View testID="Delivered-moneyLoading" accessibilityLabel={DELIVERED_COPY.loadingMoney} aria-busy>
                <Skeleton variant="text" lines={2} />
              </View>
            ) : query.kind === 'error' || !payment ? (
              <View style={styles.gap8} testID="Delivered-moneyError">
                <Text style={[labelLg, { color: theme.color.text.primary }]}>{DELIVERED_COPY.moneyErrorTitle}</Text>
                <Text style={[bodySm, secondary]}>{DELIVERED_COPY.moneyErrorBody}</Text>
                <Button variant="tertiary" size="md" onPress={reload} testID="Delivered-moneyRetry">
                  {DELIVERED_COPY.tryAgain}
                </Button>
              </View>
            ) : (
              <>
                <View style={styles.rowBetween} testID="Delivered-charged">
                  <Text style={[labelLg, styles.flex1, { color: theme.color.text.primary }]}>{DELIVERED_COPY.charged}</Text>
                  <Price cents={payment.amount_captured_cents} size="md" />
                </View>
                {refund ? <RefundRow row={refund} /> : null}
              </>
            )}
          </View>
        </Card>

        <View style={styles.gap12} testID="Delivered-actions">
          {actions.map((action, i) =>
            action === 'viewReceipt' ? (
              <Button
                key={action}
                variant="primary"
                size="lg"
                fullWidth
                onPress={() => nav.push({ name: 'receipt', orderId: order.id })}
                testID="Delivered-receipt"
              >
                {DELIVERED_COPY.viewReceipt}
              </Button>
            ) : (
              <Button
                key={action}
                variant={i === 0 ? 'secondary' : 'tertiary'}
                size={i === 0 ? 'lg' : 'md'}
                fullWidth
                onPress={onGetHelp}
                testID="Delivered-getHelp"
              >
                {DELIVERED_COPY.getHelp}
              </Button>
            ),
          )}
          {note ? (
            <Text style={[bodySm, secondary]} testID="Delivered-receiptNote">
              {note}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function RefundRow({ row }: { row: DeliveredRefundRow }): React.ReactElement {
  const theme = useTheme();
  const label = useTypeStyle('label.lg');
  const body = useTypeStyle('body.sm');
  return (
    <View style={styles.gap8} testID="Delivered-refund">
      <View style={styles.rowBetween}>
        <Text style={[label, styles.flex1, { color: theme.color.text.primary }]}>{row.label}</Text>
        {row.cents !== null ? <Price cents={row.cents} size="md" /> : null}
      </View>
      <View style={styles.badgeRow}>
        <Badge variant={row.tone} label={row.badge} />
      </View>
      <Text style={[body, { color: theme.color.text.secondary }]}>{row.line}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  page: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, gap: 14 },
  flex1: { flex: 1 },
  gap4: { gap: 4 },
  gap8: { gap: 8 },
  gap12: { gap: 12 },
  rowBetween: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  badgeRow: { flexDirection: 'row' },
});
