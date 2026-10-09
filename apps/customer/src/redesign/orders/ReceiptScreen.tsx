/**
 * T10 Receipt (TA/Receipt-*): the frozen receipt of a completed order.
 *
 * - Rendered from `getOrderReceipt`, the snapshot written once at COMPLETED, in the fixed
 *   fee-breakdown order: Items subtotal, Delivery fee, Service fee (shown at $0.00 too), one row per
 *   `tax_lines` entry (none while it is empty), Rider tip, Total. Every amount is a server field
 *   through Price; nothing is added up here. A pickup receipt leaves out the zero delivery fee and
 *   tip rows rather than zeroing them.
 * - Payment: "Visa •••• 4242, charged" with `payment.amount_charged_cents`.
 * - Refunds come from `listRefunds?order_id` (falling back to the snapshot's own list), one card
 *   each, worded per RefundState: FAILED reads "Refund in progress", never "Refunded". The reason
 *   line comes from a fixed table, never from `Refund.note` (the requester's own text).
 * - Legal names and tax registration numbers render only when the server sends them.
 * - No download or share: the contract has no receipt PDF yet.
 *
 * No receipt (409 `RECEIPT_NOT_READY`): the order and its payment decide which page shows. Never
 * captured: "No receipt for this order", its second sentence chosen by `amount_authorized_cents`.
 * DISPUTED or RESOLVED without `completed_at`: "There's no receipt for this order". Otherwise
 * (DELIVERED): "Your receipt isn't ready yet".
 *
 * No halal badge on a receipt (manifest rule 2).
 */
import * as React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { cents, type Schema } from '@hg/api-client';

import { AppBar, Badge, Button, Card, EmptyState, ErrorState, Price, Skeleton, useTheme, useTypeStyle } from '../ds';
import { useQuery } from '../lib/query';
import { formatDate, formatTime } from '../lib/time';
import { useNav } from '../navigation/context';
import {
  NO_RECEIPT_COPY,
  cardName,
  chooseNoReceipt,
  refundNote,
  refundView,
  type NoReceipt,
} from './format';
import {
  getOrder,
  getOrderPayment,
  getOrderReceipt,
  isNoReceipt,
  listOrderRefunds,
  type Receipt,
  type Refund,
} from './ordersApi';

export const RECEIPT_COPY = {
  title: 'Receipt',
  receiptNumber: 'Receipt number',
  order: 'Order',
  issued: 'Issued',
  placed: 'Placed',
  delivered: 'Delivered',
  from: 'From',
  deliveredTo: 'Delivered to',
  items: 'Items',
  each: 'Each',
  summary: 'Summary',
  subtotal: 'Items subtotal',
  discount: 'Discount',
  deliveryFee: 'Delivery fee',
  serviceFee: 'Service fee',
  tip: 'Rider tip',
  total: 'Total',
  payment: 'Payment',
  charged: 'charged',
  chargedNoCard: 'Charged',
  refund: 'Refund',
  getHelp: 'Get help',
  errorTitle: "We couldn't load your receipt",
  errorBody: "Check your connection and try again. Your receipt is kept safely and won't change.",
  backToOrder: 'Back to order',
  backToOrders: 'Back to Orders',
} as const;

type Loaded =
  | { kind: 'receipt'; receipt: Receipt; refunds: Refund[] }
  | { kind: 'none'; none: NoReceipt };

/** Reads the receipt, or works out which "no receipt" page a 409 means. */
export async function loadReceipt(orderId: string): Promise<Loaded> {
  let receipt: Receipt;
  try {
    receipt = await getOrderReceipt(orderId);
  } catch (e) {
    if (!isNoReceipt(e)) throw e;
    const [order, payment] = await Promise.allSettled([getOrder(orderId), getOrderPayment(orderId)]);
    const none = chooseNoReceipt(
      order.status === 'fulfilled' ? order.value : null,
      payment.status === 'fulfilled' ? payment.value : null,
    );
    if (!none) throw e;
    return { kind: 'none', none };
  }
  let refunds: Refund[];
  try {
    refunds = await listOrderRefunds(orderId);
  } catch {
    // The snapshot carries the refunds appended so far; the receipt itself never waits on them.
    refunds = receipt.refunds ?? [];
  }
  refunds = refunds
    .filter((r) => r.order_id === undefined || r.order_id === receipt.order_id)
    .sort((x, y) => Date.parse(x.requested_at) - Date.parse(y.requested_at));
  return { kind: 'receipt', receipt, refunds };
}

function dateTime(value: string | null | undefined): string | null {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return `${formatDate(value)}, ${formatTime(value)}`;
}

function addressLine(a: NonNullable<Receipt['delivery_address']>): string {
  const street = [a.line1, a.line2].filter((s) => s && s.trim()).join(', ');
  return `${street}, ${a.city} ${a.province} ${a.postal_code}`;
}

export function ReceiptScreen({ orderId }: { orderId: string }): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const { query, reload } = useQuery(() => loadReceipt(orderId), [orderId]);
  const getHelp = () => nav.push({ name: 'tracking', orderId, sheet: 'getHelp' });
  const backToOrder = () => nav.replace({ name: 'tracking', orderId });

  const receipt = query.kind === 'ready' && query.data.kind === 'receipt' ? query.data.receipt : null;
  const code = receipt?.order_code;
  const pageState = query.kind === 'error' || (query.kind === 'ready' && query.data.kind === 'none');

  let body: React.ReactElement;
  if (query.kind === 'loading') {
    body = <ReceiptSkeleton />;
  } else if (query.kind === 'error') {
    body = (
      <View style={styles.center}>
        <ErrorState
          variant="page"
          title={RECEIPT_COPY.errorTitle}
          description={RECEIPT_COPY.errorBody}
          onRetry={reload}
          action={{ label: RECEIPT_COPY.getHelp, onPress: getHelp }}
          testID="Receipt-error"
        />
      </View>
    );
  } else if (query.data.kind === 'none') {
    const none = query.data.none;
    const copy =
      none.kind === 'noCharge'
        ? { title: NO_RECEIPT_COPY.noCharge.title, description: `${NO_RECEIPT_COPY.noCharge.first} ${none.second}` }
        : NO_RECEIPT_COPY[none.kind];
    const action =
      none.kind === 'noCharge'
        ? { label: RECEIPT_COPY.backToOrders, onPress: () => (nav.canGoBack ? nav.back() : nav.selectTab('orders')) }
        : { label: RECEIPT_COPY.backToOrder, onPress: backToOrder };
    body = (
      <View style={styles.center}>
        <EmptyState
          variant="page"
          headingLevel={1}
          autoFocus
          title={copy.title}
          description={copy.description}
          primaryAction={action}
          testID={`Receipt-${none.kind}`}
        />
      </View>
    );
  } else {
    body = <ReceiptBody receipt={query.data.receipt} refunds={query.data.refunds} onGetHelp={getHelp} />;
  }

  return (
    <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="ReceiptScreen">
      <AppBar
        title={RECEIPT_COPY.title}
        subtitle={code ? `${RECEIPT_COPY.order} ${code}` : undefined}
        back={{ onPress: nav.back, previousTitle: code ? `order ${code}` : undefined }}
        isPageHeading={!pageState}
      />
      {body}
    </View>
  );
}

function ReceiptSkeleton(): React.ReactElement {
  const theme = useTheme();
  const label = useTypeStyle('heading.sm');
  return (
    <View style={styles.list} testID="Receipt-loading" accessibilityLabel="Loading your receipt" aria-busy>
      <Card variant="outlined">
        <Skeleton variant="text" lines={4} />
      </Card>
      <Card variant="outlined">
        <Skeleton variant="text" lines={3} />
      </Card>
      <Card variant="outlined">
        <View style={styles.gap8}>
          <Skeleton variant="text" lines={4} />
          <View style={styles.rowBetween}>
            <Text style={[label, { color: theme.color.text.primary }]}>{RECEIPT_COPY.total}</Text>
            {/* Price keeps the amount's width while loading, so the total never jumps. */}
            <Price cents={cents(0)} size="md" loading showCode />
          </View>
        </View>
      </Card>
    </View>
  );
}

function ReceiptBody({
  receipt,
  refunds,
  onGetHelp,
}: {
  receipt: Receipt;
  refunds: Refund[];
  onGetHelp: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const headingSm = useTypeStyle('heading.sm');
  const headingMd = useTypeStyle('heading.md');
  const bodySm = useTypeStyle('body.sm');
  const bodyMd = useTypeStyle('body.md');
  const labelLg = useTypeStyle('label.lg');
  const mono = useTypeStyle('mono.sm');
  const secondary = { color: theme.color.text.secondary };
  const primary = { color: theme.color.text.primary };

  const money = receipt.money;
  const pickup = receipt.delivery_address == null;
  const card = cardName(receipt.payment);

  const facts: Array<[string, string, boolean]> = [
    [RECEIPT_COPY.receiptNumber, receipt.receipt_number, true],
    ...(receipt.order_code ? ([[RECEIPT_COPY.order, receipt.order_code, true]] as Array<[string, string, boolean]>) : []),
    ...([
      [RECEIPT_COPY.issued, dateTime(receipt.issued_at)],
      [RECEIPT_COPY.placed, dateTime(receipt.placed_at)],
      [RECEIPT_COPY.delivered, dateTime(receipt.delivered_at)],
    ].filter((f): f is [string, string] => f[1] !== null).map(([k, v]) => [k, v, false]) as Array<[string, string, boolean]>),
  ];

  const summary: Array<{ label: string; cents: Schema['Cents']; key: string }> = [
    { key: 'subtotal', label: RECEIPT_COPY.subtotal, cents: money.subtotal_cents },
    ...(money.discount_cents !== 0 ? [{ key: 'discount', label: RECEIPT_COPY.discount, cents: money.discount_cents }] : []),
    ...(pickup && money.delivery_fee_cents === 0 ? [] : [{ key: 'delivery', label: RECEIPT_COPY.deliveryFee, cents: money.delivery_fee_cents }]),
    { key: 'service', label: RECEIPT_COPY.serviceFee, cents: money.service_fee_cents },
    ...(money.tax_lines ?? []).map((t, i) => ({ key: `tax-${i}`, label: t.statutory_label, cents: t.amount_cents })),
    ...(pickup && money.tip_cents === 0 ? [] : [{ key: 'tip', label: RECEIPT_COPY.tip, cents: money.tip_cents }]),
  ];

  return (
    <ScrollView contentContainerStyle={styles.list} testID="Receipt-body">
      <Card variant="outlined">
        <View style={styles.gap10}>
          {receipt.platform_legal_name ? <Text style={[headingSm, primary]}>{receipt.platform_legal_name}</Text> : null}
          {receipt.platform_tax_registration_number ? (
            <Text style={[bodySm, secondary]} testID="Receipt-platformTax">{receipt.platform_tax_registration_number}</Text>
          ) : null}
          {facts.map(([label, value, isCode]) => (
            <View key={label} style={styles.rowBetween}>
              <Text style={[bodySm, secondary]}>{label}</Text>
              <Text style={[isCode ? mono : bodySm, primary, styles.right]}>{value}</Text>
            </View>
          ))}
        </View>
      </Card>

      {receipt.restaurant_legal_name || receipt.delivery_address ? (
        <Card variant="outlined">
          <View style={styles.gap6}>
            {receipt.restaurant_legal_name ? (
              <>
                <Text style={[bodySm, secondary]}>{RECEIPT_COPY.from}</Text>
                <Text style={[labelLg, primary]}>{receipt.restaurant_legal_name}</Text>
                {receipt.restaurant_tax_registration_number ? (
                  <Text style={[bodySm, secondary]} testID="Receipt-restaurantTax">{receipt.restaurant_tax_registration_number}</Text>
                ) : null}
              </>
            ) : null}
            {receipt.delivery_address ? (
              <>
                <Text style={[bodySm, secondary, { marginTop: 6 }]}>{RECEIPT_COPY.deliveredTo}</Text>
                <Text style={[bodyMd, primary]}>{addressLine(receipt.delivery_address)}</Text>
              </>
            ) : null}
          </View>
        </Card>
      ) : null}

      <Card variant="outlined">
        <Text accessibilityRole="header" aria-level={2} style={[headingMd, primary, styles.cardHeading]}>
          {RECEIPT_COPY.items}
        </Text>
        <View style={styles.gap12}>
          {receipt.lines.map((line) => {
            const detail = [
              line.variant_name,
              ...(line.addons ?? []).map((a) => (a.addon_quantity > 1 ? `${a.addon_quantity} × ${a.addon_name}` : a.addon_name)),
            ]
              .filter((s): s is string => !!s && !!s.trim())
              .join(' · ');
            return (
              <View key={line.line_no} style={styles.rowBetweenTop} testID={`Receipt-line-${line.line_no}`}>
                <View style={[styles.flex1, styles.gap2]}>
                  <Text style={[labelLg, primary]}>{`${line.quantity} × ${line.name}`}</Text>
                  {detail ? <Text style={[bodySm, secondary]}>{detail}</Text> : null}
                  {line.quantity > 1 ? (
                    <View style={styles.rowBaseline}>
                      <Text style={[bodySm, secondary]}>{RECEIPT_COPY.each}</Text>
                      <Price cents={line.unit_price_cents} size="sm" />
                    </View>
                  ) : null}
                </View>
                <Price cents={line.line_total_cents} size="sm" />
              </View>
            );
          })}
        </View>
      </Card>

      <Card variant="outlined">
        <Text accessibilityRole="header" aria-level={2} style={[headingMd, primary, styles.cardHeading]}>
          {RECEIPT_COPY.summary}
        </Text>
        <View style={styles.gap8}>
          {summary.map((row) => (
            <View key={row.key} style={styles.rowBetweenBaseline} testID={`Receipt-row-${row.key}`}>
              <Text style={[bodyMd, secondary]}>{row.label}</Text>
              <Price cents={row.cents} size="sm" testID={`Receipt-row-${row.key}-price`} />
            </View>
          ))}
          <View style={[styles.rowBetweenBaseline, styles.totalRow, { borderTopColor: theme.color.border.decorative }]}>
            <Text style={[headingSm, primary]}>{RECEIPT_COPY.total}</Text>
            <Price cents={money.total_cents} size="md" showCode testID="Receipt-total" />
          </View>
        </View>
      </Card>

      <Card variant="outlined">
        <View style={styles.gap8}>
          <Text style={[headingSm, primary]}>{RECEIPT_COPY.payment}</Text>
          <View style={styles.rowBetweenBaseline}>
            <Text style={[bodyMd, secondary, styles.flex1]}>
              {card ? `${card}, ${RECEIPT_COPY.charged}` : RECEIPT_COPY.chargedNoCard}
            </Text>
            <Price cents={receipt.payment.amount_charged_cents} size="sm" showCode testID="Receipt-charged" />
          </View>
        </View>
      </Card>

      {refunds.map((refund) => {
        const view = refundView(refund, card);
        return (
          <Card variant="outlined" key={refund.id} testID={`Receipt-refund-${refund.id}`}>
            <View style={styles.gap10}>
              <View style={styles.rowBetween}>
                <Text style={[headingSm, primary]}>{RECEIPT_COPY.refund}</Text>
                {/* Every refund state is neutral: never an error colour, never green. */}
                <Badge label={view.badge} variant="neutral" size="sm" testID="Receipt-refund-badge" />
              </View>
              <View style={styles.rowBetweenBaseline}>
                <Text style={[bodyMd, secondary, styles.flex1]}>{view.line}</Text>
                {view.showAmount ? <Price cents={refund.amount_cents} size="md" showCode /> : null}
              </View>
              {refund.state === 'SUCCEEDED' || refund.state === 'SETTLED' ? (
                <Text style={[bodySm, secondary]}>{refundNote(refund.reason_code)}</Text>
              ) : null}
            </View>
          </Card>
        );
      })}

      <Button variant="tertiary" size="md" fullWidth onPress={onGetHelp}>
        {RECEIPT_COPY.getHelp}
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', padding: 16 },
  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24, gap: 16 },
  gap2: { gap: 2 },
  gap6: { gap: 6 },
  gap8: { gap: 8 },
  gap10: { gap: 10 },
  gap12: { gap: 12 },
  flex1: { flex: 1 },
  right: { textAlign: 'right', flexShrink: 1 },
  cardHeading: { marginBottom: 12 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowBetweenTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  rowBetweenBaseline: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  rowBaseline: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  totalRow: { paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
});
