/**
 * Order outcome: the page for an order that ended instead of arriving (the `Outcome-*` boards of the
 * customer redesign, tracked in issue #921 under the redesign tracker #656).
 *
 * One screen, chosen by the server's own fields: rejected and timed-out orders, a payment that
 * expired or failed, a rider that was never found, an order cancelled by the customer or by our
 * team, an order under review, and a finished review. What each one says lives in `outcomeView.ts`.
 *
 * Rules this page holds:
 * - Money is a server field through Price. The page adds, subtracts and compares nothing, and sends
 *   nothing except the cart adds of "Put these items back", which carry ids and quantities.
 * - Voided is not refunded. When the order ended before the restaurant accepted, the hold was
 *   released and there is nothing to chase; the page says that and never says "expect a refund".
 * - A refund under review shows no amount and no promise. A failed one reads "Refund in progress".
 * - Plain tone, no invented reassurance: the page says what the server says and nothing more.
 * - Loading, error and the no-refund case are drawn: the order is already on screen, so a failed
 *   money read puts a retry inside the money card instead of blanking the page.
 */
import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  AppBar,
  Badge,
  Banner,
  Button,
  Card,
  Icon,
  Modal,
  Price,
  Skeleton,
  StatusTimeline,
  useTheme,
  useTypeStyle,
} from '../ds';
import { callSupport, useSupport, type Support } from '../api/config';
import { rememberNextCard } from '../checkout/nextCard';
import { useQuery } from '../lib/query';
import { useNow } from '../lib/now';
import { useNav } from '../navigation/context';
import { cardName } from '../orders/format';
import type { OrderCustomerView } from '../orders/ordersApi';
import { readOutcome, type OutcomeData } from './outcomeApi';
import { moneyOf, outcomeOf, type MoneyRows, type Outcome, type OutcomeAction, type RefundRow } from './outcomeView';
import { ChooseCardSheet } from './ChooseCardSheet';
import { usePutItemsBack } from './putItemsBack';

export const OUTCOME_COPY = {
  yourMoney: 'Your money',
  backToOrders: 'Back to Orders',
  moneyErrorTitle: "We couldn't load your payment details",
  moneyErrorBody: "This doesn't change your order. Try again in a moment.",
  tryAgain: 'Try again',
  noRefundYet: "We haven't set up a refund yet. We'll let you know when we do.",
  putBack: 'Put these items back in your cart',
  puttingBack: 'Putting your items back',
  putBackFailed: "We couldn't put your items back",
  putBackFailedBody: 'Check your connection and try again.',
  callUs: 'Call us',
} as const;

const RESTAURANT_CAUSED: ReadonlySet<string> = new Set(['RESTAURANT_TIMEOUT', 'RESTAURANT_CLOSED']);

export function OutcomeScreen({ order }: { order: OrderCustomerView }): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const { query, reload } = useQuery<OutcomeData>(() => readOutcome(order.id, order.state === 'DISPUTED'), [order.id, order.state]);
  const support = useSupport();
  const putBack = usePutItemsBack(order);
  const now = useNow(60_000);
  const [chooseOpen, setChooseOpen] = React.useState(false);

  const data = query.kind === 'ready' ? query.data : null;
  const payment = data?.payment ?? null;
  const refunds = data?.refunds ?? [];
  const outcome = outcomeOf({ order, payment, refunds, timeline: data?.timeline });
  const card = payment ? cardName(payment) : null;
  const money = moneyOf(payment, refunds, card, order.money.total_cents);

  return (
    <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="Outcome">
      <AppBar
        title={`Order ${order.code}`}
        subtitle={order.restaurant.name}
        back={{ onPress: () => nav.selectTab('orders'), previousTitle: 'Orders' }}
        backLabel={OUTCOME_COPY.backToOrders}
        tone="cream"
        isPageHeading={false}
      />
      <ScrollView contentContainerStyle={styles.page} testID="Outcome-body">
        <Heading outcome={outcome} />

        {outcome.timeline ? (
          <Card variant="outlined" radius={16} testID="Outcome-timelineCard">
            <StatusTimeline
              audience="customer"
              state={order.state}
              transitions={data?.timeline ?? undefined}
              showTimes
              connection="polling"
              now={now}
              testID="Outcome-timeline"
            />
          </Card>
        ) : null}

        <MoneyCard
          loading={query.kind === 'loading'}
          failed={query.kind === 'error'}
          onRetry={reload}
          money={money}
        />

        {putBack.state.kind === 'failed' ? (
          <Banner
            variant="warning"
            title={OUTCOME_COPY.putBackFailed}
            description={OUTCOME_COPY.putBackFailedBody}
            testID="Outcome-putBackFailed"
          />
        ) : null}

        <Actions
          outcome={outcome}
          order={order}
          support={support}
          putBack={putBack.state.kind}
          onPutBack={() => putBack.run(false)}
          onChooseCard={() => setChooseOpen(true)}
        />
      </ScrollView>

      <ChooseCardSheet
        variant="terminal"
        open={chooseOpen}
        restaurantName={order.restaurant.name}
        declined={payment ? { brand: payment.card_brand ?? null, last4: payment.card_last4 ?? null } : null}
        busy={putBack.state.kind === 'busy'}
        onClose={() => setChooseOpen(false)}
        onConfirm={(choice) => {
          // The order is already closed: nothing is cancelled, the items go back and the card is
          // chosen at the next checkout.
          rememberNextCard(choice);
          putBack.run(false);
        }}
      />

      <Modal
        open={putBack.state.kind === 'replace'}
        onClose={putBack.cancelReplace}
        variant="confirm"
        destructive
        title={
          putBack.state.kind === 'replace' && putBack.state.restaurant
            ? `Your cart has items from ${putBack.state.restaurant}`
            : 'Your cart has items from another restaurant'
        }
        description="A cart holds one restaurant at a time, so putting these items back replaces them."
        actions={[
          { label: 'Keep my cart', onPress: putBack.cancelReplace, testID: 'Outcome-keepCart' },
          { label: 'Replace them', destructive: true, onPress: () => putBack.run(true), testID: 'Outcome-replaceCart' },
        ]}
        testID="Outcome-replaceDialog"
      />
    </View>
  );
}

/* --------------------------------------------------------------------------------- pieces */

function Heading({ outcome }: { outcome: Outcome }): React.ReactElement {
  const theme = useTheme();
  const h1 = useTypeStyle('heading.xl');
  const body = useTypeStyle('body.md');
  return (
    <View style={styles.gap8}>
      <Icon name={outcome.icon} size={32} color={theme.color.text.primary} />
      {outcome.badge ? <Badge variant="info" label={outcome.badge} /> : null}
      <Text accessibilityRole="header" aria-level={1} style={[h1, { color: theme.color.text.primary }]} testID="Outcome-h1">
        {outcome.title}
      </Text>
      {outcome.lead.map((line) => (
        <Text key={line} style={[body, { color: theme.color.text.primary }]}>
          {line}
        </Text>
      ))}
    </View>
  );
}

function MoneyCard({
  loading,
  failed,
  onRetry,
  money,
}: {
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  money: MoneyRows;
}): React.ReactElement {
  const theme = useTheme();
  const label = useTypeStyle('label.lg');
  const body = useTypeStyle('body.sm');

  return (
    <Card variant="outlined" radius={16} testID="Outcome-money">
      <View style={styles.gap8}>
        <Text accessibilityRole="header" aria-level={2} style={[label, { color: theme.color.text.primary }]}>
          {OUTCOME_COPY.yourMoney}
        </Text>
        {loading ? (
          <View testID="Outcome-moneyLoading" accessibilityLabel="Loading your payment details" aria-busy>
            <Skeleton variant="text" lines={2} />
          </View>
        ) : failed || money.kind === 'unread' ? (
          <View style={styles.gap8} testID="Outcome-moneyError">
            <Text style={[label, { color: theme.color.text.primary }]}>{OUTCOME_COPY.moneyErrorTitle}</Text>
            <Text style={[body, { color: theme.color.text.secondary }]}>{OUTCOME_COPY.moneyErrorBody}</Text>
            <Button variant="tertiary" size="md" onPress={onRetry} testID="Outcome-moneyRetry">
              {OUTCOME_COPY.tryAgain}
            </Button>
          </View>
        ) : (
          <>
            {money.hold ? <MoneyLine label={money.hold.label} cents={money.hold.cents} testID="Outcome-hold" /> : null}
            <MoneyLine label={money.charged.label} cents={money.charged.cents} strong testID="Outcome-charged" />
            {money.refund ? <RefundLine row={money.refund} /> : null}
            {money.noRefundYet ? (
              <Text style={[body, { color: theme.color.text.secondary }]} testID="Outcome-noRefundYet">
                {OUTCOME_COPY.noRefundYet}
              </Text>
            ) : null}
            {money.bankNote ? <Text style={[body, { color: theme.color.text.secondary }]}>{money.bankNote}</Text> : null}
          </>
        )}
      </View>
    </Card>
  );
}

function MoneyLine({
  label,
  cents,
  strong,
  testID,
}: {
  label: string;
  cents: Parameters<typeof Price>[0]['cents'];
  strong?: boolean;
  testID?: string;
}): React.ReactElement {
  const theme = useTheme();
  const text = useTypeStyle(strong ? 'label.lg' : 'body.md');
  return (
    <View style={styles.rowBetween} testID={testID}>
      <Text style={[text, styles.flex1, { color: theme.color.text.primary }]}>{label}</Text>
      <Price cents={cents} size="md" />
    </View>
  );
}

function RefundLine({ row }: { row: RefundRow }): React.ReactElement {
  const theme = useTheme();
  const label = useTypeStyle('label.lg');
  const body = useTypeStyle('body.sm');
  return (
    <View style={styles.gap8} testID="Outcome-refund">
      <View style={styles.rowBetween}>
        <Text style={[label, styles.flex1, { color: theme.color.text.primary }]}>{row.label}</Text>
        {row.cents !== null ? <Price cents={row.cents} size="md" /> : null}
      </View>
      {row.badge ? (
        <View style={styles.badgeRow}>
          <Badge variant="info" label={row.badge} />
        </View>
      ) : null}
      {row.line ? <Text style={[body, { color: theme.color.text.secondary }]}>{row.line}</Text> : null}
    </View>
  );
}

function Actions({
  outcome,
  order,
  support,
  putBack,
  onPutBack,
  onChooseCard,
}: {
  outcome: Outcome;
  order: OrderCustomerView;
  support: Support | null;
  putBack: 'idle' | 'busy' | 'failed' | 'replace';
  onPutBack: () => void;
  onChooseCard: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const body = useTypeStyle('body.sm');
  const findLabel = order.state === 'REJECTED' || (order.cancel_reason && RESTAURANT_CAUSED.has(order.cancel_reason))
    ? 'Find another restaurant'
    : 'Find something to eat';

  const render = (action: OutcomeAction, primary: boolean): React.ReactElement | null => {
    const variant = primary ? 'primary' : 'tertiary';
    switch (action) {
      case 'putBack':
        return (
          <Button
            key={action}
            variant={variant}
            size="lg"
            fullWidth
            loading={putBack === 'busy'}
            onPress={onPutBack}
            testID="Outcome-putBack"
          >
            {putBack === 'busy' ? OUTCOME_COPY.puttingBack : putBack === 'failed' ? 'Try again' : OUTCOME_COPY.putBack}
          </Button>
        );
      case 'chooseCard':
        return (
          <Button key={action} variant={variant} size="lg" fullWidth onPress={onChooseCard} testID="Outcome-chooseCard">
            {order.state === 'FAILED' ? 'Choose another card' : 'Try again with another card'}
          </Button>
        );
      case 'findRestaurant':
        return (
          <Button key={action} variant={variant} size="lg" fullWidth onPress={() => nav.selectTab('home')} testID="Outcome-find">
            {findLabel}
          </Button>
        );
      case 'restaurantMenu':
        return (
          <Button
            key={action}
            variant="tertiary"
            size="md"
            fullWidth
            onPress={() => nav.push({ name: 'restaurant', restaurantId: order.restaurant.id })}
            testID="Outcome-menu"
          >
            {`See ${order.restaurant.name}'s menu`}
          </Button>
        );
      case 'checkAddress':
        return (
          <Button key={action} variant={variant} size="lg" fullWidth onPress={() => nav.push({ name: 'addresses' })} testID="Outcome-address">
            Check your address
          </Button>
        );
      case 'backToOrders':
      case 'done':
        return (
          <Button
            key={action}
            variant={primary ? 'primary' : 'tertiary'}
            size={primary ? 'lg' : 'md'}
            fullWidth
            onPress={() => nav.selectTab('orders')}
            testID={action === 'done' ? 'Outcome-done' : 'Outcome-backToOrders'}
          >
            {action === 'done' ? 'Done' : OUTCOME_COPY.backToOrders}
          </Button>
        );
      case 'viewReceipt':
        return (
          <Button key={action} variant="tertiary" size="md" fullWidth onPress={() => nav.push({ name: 'receipt', orderId: order.id })} testID="Outcome-receipt">
            View receipt
          </Button>
        );
      case 'callUs':
        if (!support) return null;
        if (support.kind === 'open') {
          return (
            <View key={action} style={styles.gap8}>
              <Button
                variant={primary ? 'primary' : 'tertiary'}
                size={primary ? 'lg' : 'md'}
                fullWidth
                iconStart="phone"
                accessibilityLabel={`Call us, HalalGoes support, ${support.phoneE164}`}
                onPress={() => callSupport(support.phoneE164)}
                testID="Outcome-call"
              >
                {OUTCOME_COPY.callUs}
              </Button>
              {support.hours ? <Text style={[body, { color: theme.color.text.secondary }]}>{support.hours}</Text> : null}
            </View>
          );
        }
        // Closed or off: only the hours line, never a number to call.
        return support.kind === 'closed' ? (
          <Text key={action} style={[body, { color: theme.color.text.secondary }]} testID="Outcome-hours">
            {support.hours}
          </Text>
        ) : null;
      default:
        return null;
    }
  };

  const firstVisible = outcome.actions.findIndex((a) => a !== 'callUs');
  return (
    <View style={styles.gap12} testID="Outcome-actions">
      {outcome.actions.map((a, i) => render(a, i === firstVisible && a !== 'callUs'))}
      {outcome.actionNote ? <Text style={[body, { color: theme.color.text.secondary }]}>{outcome.actionNote}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  page: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, gap: 16 },
  flex1: { flex: 1 },
  gap8: { gap: 8 },
  gap12: { gap: 12 },
  rowBetween: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  badgeRow: { flexDirection: 'row' },
});
