/**
 * Order tracking (C-26 / C-32).
 *
 * Reads `GET /v1/orders/{id}` and renders the order's position through `StatusTimeline`, the
 * shared state→step mapping the design system owns so the customer and restaurant apps can never
 * disagree about what a state is called. The order's fourteen possible `OrderState` values all
 * flow through that one component, including the terminal ones, so a cancelled or failed order
 * renders correctly rather than as a stuck spinner.
 *
 * Until the order is delivered, the "Order total" block re-uses the order's own `money`
 * decomposition, every figure through `Price`. Once delivered, `OrderReceipt` loads the receipt the
 * server saved at completion. Loading, empty (no active order) and error are all present.
 */
import * as React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cents } from '@hg/api-client';
import type { Schema } from '@hg/api-client';
import {
  AppBar,
  Button,
  Divider,
  EmptyState,
  ErrorState,
  ORDER_STATE_LABELS,
  Price,
  Spinner,
  StatusTimeline,
  useTheme,
  useTypeStyle,
} from '@hg/ui-native';

import { getOrder } from '../api/orders';
import { errorCodeOf } from '../api/async';
import { useNavigation } from '../navigation/stack';
import { OrderReceipt } from '../components/OrderReceipt';
import { TamperReportCard } from '../components/TamperReportCard';
import { TrackingMap } from '../components/TrackingMap';

// Delivery-phase states where the customer has (or has just received) the sealed bag and can
// report a broken seal.
const DELIVERY_PHASE: ReadonlySet<string> = new Set(['PICKED_UP', 'ARRIVED', 'DELIVERED']);

// The contract's five terminal states (OrderState); polling stops at these.
const TERMINAL_STATES: ReadonlySet<string> = new Set([
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
  'FAILED',
  'RESOLVED',
]);
const POLL_MS = 10_000;

// Delivered orders have a receipt, or will within minutes: the server saves it when the order
// completes, and answers 409 until then.
const HAS_RECEIPT: ReadonlySet<string> = new Set(['DELIVERED', 'COMPLETED']);

// Out for delivery: the rider has the bag. Only then does the map poll.
const ON_ITS_WAY: ReadonlySet<string> = new Set(['PICKED_UP', 'ARRIVED']);

type Order = Schema['OrderCustomerView'];

type State =
  | { kind: 'loading' }
  | { kind: 'error'; code: string | null }
  | { kind: 'empty' }
  | { kind: 'ready'; order: Order };

export function TrackingScreen({ orderId }: { orderId: string }): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation();

  const [state, setState] = React.useState<State>({ kind: 'loading' });

  const load = React.useCallback(() => {
    setState({ kind: 'loading' });
    getOrder(orderId)
      .then((order) => setState(order ? { kind: 'ready', order } : { kind: 'empty' }))
      .catch((e) => setState({ kind: 'error', code: errorCodeOf(e) }));
  }, [orderId]);

  React.useEffect(() => load(), [load]);

  // Poll every 10 s until the order is terminal. A failed poll keeps the last good order on
  // screen (the next tick retries); the cleanup stops the timer when the screen closes.
  const terminal = state.kind === 'ready' && TERMINAL_STATES.has(state.order.state);
  React.useEffect(() => {
    if (state.kind !== 'ready' || terminal) return;
    let live = true;
    const timer = setInterval(() => {
      getOrder(orderId)
        .then((order) => {
          if (live && order) setState({ kind: 'ready', order });
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [orderId, state.kind, terminal]);

  const title =
    state.kind === 'ready' ? `Order ${state.order.code}` : 'Your order';

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.sunken }}>
      <AppBar
        title={title}
        back={{ onPress: () => nav.popTo('discovery') }}
        loading={state.kind === 'loading'}
      />

      {state.kind === 'loading' ? (
        <View style={{ flex: 1, padding: 16 }}>
          <Spinner label="Loading your order" />
        </View>
      ) : state.kind === 'error' ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: 16 }}>
          <ErrorState errorCode={state.code} onRetry={load} />
        </View>
      ) : state.kind === 'empty' ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: 16 }}>
          <EmptyState
            title="No active order"
            description="When you place an order it will show up here so you can follow it."
            primaryAction={{
              label: 'Browse restaurants',
              onPress: () => nav.popTo('discovery'),
            }}
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 24 + insets.bottom, gap: 16 }}
        >
          <StateHeader order={state.order} />
          {ON_ITS_WAY.has(state.order.state) ? <TrackingMap orderId={orderId} /> : null}

          <View
            style={{
              padding: 16,
              borderRadius: 12,
              backgroundColor: theme.color.surface.raised,
              borderWidth: 1,
              borderColor: theme.color.border.decorative,
            }}
          >
            <StatusTimeline
              audience="customer"
              state={state.order.state}
              estimatedAt={state.order.eta_at}
              deadlineAt={state.order.deadline_at}
              showTimes
            />
          </View>

          {state.order.state !== 'COMPLETED' ? <OrderTotal order={state.order} /> : null}
          {HAS_RECEIPT.has(state.order.state) ? (
            // Keyed on state so the receipt reloads when a polled DELIVERED order completes.
            <OrderReceipt key={state.order.state} orderId={orderId} />
          ) : null}

          {DELIVERY_PHASE.has(state.order.state) ? (
            <TamperReportCard orderId={orderId} />
          ) : null}

          <Button variant="secondary" onPress={load}>
            Refresh
          </Button>
        </ScrollView>
      )}
    </View>
  );
}

function StateHeader({ order }: { order: Order }): React.ReactElement {
  const theme = useTheme();
  const heading = useTypeStyle('heading.md');
  const body = useTypeStyle('body.md');
  const stateLabel =
    ORDER_STATE_LABELS[order.state as keyof typeof ORDER_STATE_LABELS] ?? order.state;

  return (
    <View style={{ gap: 4 }}>
      <Text style={[heading, { color: theme.color.text.primary }]}>{stateLabel}</Text>
      <Text style={[body, { color: theme.color.text.secondary }]}>
        {order.restaurant.name}
      </Text>
    </View>
  );
}

function OrderTotal({ order }: { order: Order }): React.ReactElement {
  const theme = useTheme();
  const heading = useTypeStyle('heading.sm');
  const { money } = order;

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
      <Text style={[heading, { color: theme.color.text.primary }]}>Order total</Text>

      <Row label="Subtotal" value={money.subtotal_cents} />
      {(money.tax_lines ?? []).map((tax) => (
        <Row
          key={tax.jurisdiction_code + tax.statutory_label}
          label={tax.statutory_label}
          value={tax.amount_cents}
        />
      ))}
      <Row label="Delivery fee" value={money.delivery_fee_cents} free="Free delivery" />
      <Row label="Service fee" value={money.service_fee_cents} free="No service fee" />
      {money.tip_cents !== 0 ? <Row label="Tip" value={money.tip_cents} /> : null}

      <Divider />

      <Row label="Total" value={money.total_cents} emphasise />
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
      <Price cents={cents(value)} size={emphasise ? 'lg' : 'md'} free={free} />
    </View>
  );
}
