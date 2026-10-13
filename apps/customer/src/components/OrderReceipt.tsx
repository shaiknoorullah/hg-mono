/**
 * The order's receipt (P-10 / C-27), loaded from `GET /v1/orders/{orderId}/receipt`.
 *
 * The server writes the receipt once, when a delivered order completes, and never re-prices it, so
 * every figure here comes from that snapshot through `Price`; nothing is added up on the device.
 * Before the order completes the server answers 409: that is a calm "not ready yet" note, never an
 * error. Loading, error and an empty receipt (no lines) each have their own state.
 */
import * as React from 'react';
import { Text, View } from 'react-native';
import { cents, formatCents } from '@hg/api-client';
import {
  Divider,
  ErrorState,
  Price,
  Spinner,
  useTheme,
  useTypeStyle,
} from '@hg/ui-native';

import { getOrderReceipt, isReceiptNotReady } from '../api/orders';
import type { Receipt } from '../api/orders';
import { errorCodeOf } from '../api/async';

type State =
  | { kind: 'loading' }
  | { kind: 'not-ready' }
  | { kind: 'error'; code: string | null }
  | { kind: 'ready'; receipt: Receipt };

export function OrderReceipt({ orderId }: { orderId: string }): React.ReactElement {
  const theme = useTheme();
  const heading = useTypeStyle('heading.sm');
  const body = useTypeStyle('body.md');
  const [state, setState] = React.useState<State>({ kind: 'loading' });
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    let live = true;
    setState({ kind: 'loading' });
    getOrderReceipt(orderId)
      .then((receipt) => {
        if (live) setState({ kind: 'ready', receipt });
      })
      .catch((e) => {
        if (!live) return;
        setState(isReceiptNotReady(e) ? { kind: 'not-ready' } : { kind: 'error', code: errorCodeOf(e) });
      });
    return () => {
      live = false;
    };
  }, [orderId, nonce]);

  return (
    <View
      style={{
        gap: 10,
        padding: 16,
        borderRadius: 12,
        backgroundColor: theme.color.surface.raised,
        borderWidth: 1,
        borderColor: theme.color.border.decorative,
      }}
    >
      <Text style={[heading, { color: theme.color.text.primary }]}>Receipt</Text>

      {state.kind === 'loading' ? (
        <Spinner label="Loading your receipt" />
      ) : state.kind === 'not-ready' ? (
        <Text style={[body, { color: theme.color.text.secondary }]}>
          Your receipt will be ready when the order is complete.
        </Text>
      ) : state.kind === 'error' ? (
        <ErrorState
          variant="inline"
          errorCode={state.code}
          onRetry={() => setNonce((n) => n + 1)}
        />
      ) : (
        <ReceiptBody receipt={state.receipt} />
      )}
    </View>
  );
}

function ReceiptBody({ receipt }: { receipt: Receipt }): React.ReactElement {
  const theme = useTheme();
  const small = useTypeStyle('body.sm');
  const { money } = receipt;

  return (
    <>
      <Text style={[small, { color: theme.color.text.secondary }]}>
        Receipt {receipt.receipt_number}
      </Text>

      {receipt.lines.length === 0 ? (
        <Text style={[small, { color: theme.color.text.secondary }]}>
          No items on this receipt.
        </Text>
      ) : (
        receipt.lines.map((line) => <LineRow key={line.line_no} line={line} />)
      )}

      <Divider />

      <Row label="Subtotal" value={money.subtotal_cents} />
      {money.discount_cents !== 0 ? (
        <Row label="Discount" value={-money.discount_cents} />
      ) : null}
      <Row label="Delivery fee" value={money.delivery_fee_cents} free="Free delivery" />
      <Row label="Service fee" value={money.service_fee_cents} free="No service fee" />
      {(money.tax_lines ?? []).map((tax) => (
        <Row
          key={tax.jurisdiction_code + tax.statutory_label}
          label={tax.statutory_label}
          value={tax.amount_cents}
        />
      ))}
      {money.tip_cents !== 0 ? <Row label="Tip" value={money.tip_cents} /> : null}

      <Divider />

      <Row label="Total" value={money.total_cents} emphasise />
      <Text style={[small, { color: theme.color.text.secondary }]}>
        {paidWith(receipt.payment)}
      </Text>
    </>
  );
}

// "Paid with visa ••••4242", or the wallet's name; the figure is the amount actually charged.
function paidWith(payment: Receipt['payment']): string {
  const amount = formatCents(cents(payment.amount_charged_cents));
  const method = payment.card_last4
    ? `${payment.card_brand ?? 'card'} ••••${payment.card_last4}`
    : payment.wallet;
  return method ? `Paid ${amount} with ${method}` : `Paid ${amount}`;
}

function LineRow({ line }: { line: Receipt['lines'][number] }): React.ReactElement {
  const theme = useTheme();
  const body = useTypeStyle('body.md');
  const small = useTypeStyle('body.sm');
  const name = line.variant_name ? `${line.name} (${line.variant_name})` : line.name;

  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
        <Text style={[body, { color: theme.color.text.primary, flexShrink: 1 }]}>
          {line.quantity} × {name}
        </Text>
        <Price cents={cents(line.line_total_cents)} size="md" />
      </View>
      {(line.addons ?? []).map((addon) => (
        <Text key={addon.addon_id} style={[small, { color: theme.color.text.secondary }]}>
          + {addon.addon_quantity} × {addon.addon_name}
        </Text>
      ))}
      {line.special_request ? (
        <Text style={[small, { color: theme.color.text.secondary }]}>
          “{line.special_request}”
        </Text>
      ) : null}
    </View>
  );
}

function Row({
  label,
  value,
  emphasise = false,
  free,
}: {
  label: string;
  value: number;
  emphasise?: boolean;
  free?: string;
}): React.ReactElement {
  const theme = useTheme();
  const labelStyle = useTypeStyle(emphasise ? 'label.lg' : 'body.md');
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text
        style={[
          labelStyle,
          { color: emphasise ? theme.color.text.primary : theme.color.text.secondary },
        ]}
      >
        {label}
      </Text>
      <Price
        cents={cents(value)}
        size={emphasise ? 'lg' : 'md'}
        free={free}
        showCode={emphasise}
      />
    </View>
  );
}
