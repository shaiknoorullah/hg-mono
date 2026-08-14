/**
 * Cart (C-19).
 *
 * Reads `GET /v1/cart` and renders each line with a `QuantityStepper`. Every quantity change,
 * removal and the "clear" action goes to the server and re-renders from the *recomputed* cart —
 * there is no optimistic arithmetic here (the stepper freezes while a mutation is in flight),
 * because cart money is server-authoritative. The running total is the cart's
 * `indicative_subtotal_cents`, rendered through `Price`, and it is labelled *indicative*: the
 * binding numbers only appear once a quote is priced at checkout.
 *
 * A line whose `availability.is_available` is false is annotated, never silently dropped (R-19):
 * the customer sees exactly why, and the "Continue to checkout" button is disabled while the cart
 * is not quotable.
 */
import * as React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cents } from '@hg/api-client';
import type { Schema } from '@hg/api-client';
import {
  AppBar,
  Banner,
  Button,
  EmptyState,
  ErrorState,
  Price,
  QuantityStepper,
  Spinner,
  useTheme,
  useTypeStyle,
} from '@hg/ui-native';

import { clearCart, getCart, removeLine, setLineQuantity } from '../api/cart';
import { errorCodeOf } from '../api/async';
import { useNavigation } from '../navigation/stack';

type Cart = Schema['Cart'];
type CartLine = Schema['CartLine'];

type State =
  | { kind: 'loading' }
  | { kind: 'error'; code: string | null }
  | { kind: 'ready'; cart: Cart };

export function CartScreen(): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation();

  const [state, setState] = React.useState<State>({ kind: 'loading' });
  const [mutating, setMutating] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    setState({ kind: 'loading' });
    getCart()
      .then((cart) => setState({ kind: 'ready', cart }))
      .catch((e) => setState({ kind: 'error', code: errorCodeOf(e) }));
  }, []);

  React.useEffect(() => load(), [load]);

  // Every mutation returns the whole recomputed cart; we render that, never a local guess.
  const mutate = React.useCallback(
    async (lineId: string, run: () => Promise<Cart>) => {
      setMutating(lineId);
      try {
        const cart = await run();
        setState({ kind: 'ready', cart });
      } catch (e) {
        setState({ kind: 'error', code: errorCodeOf(e) });
      } finally {
        setMutating(null);
      }
    },
    [],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.sunken }}>
      <AppBar
        title="Your cart"
        back={{ onPress: nav.back }}
        loading={state.kind === 'loading'}
      />
      <Body
        state={state}
        mutating={mutating}
        onRetry={load}
        onBrowse={() => nav.popTo('discovery')}
        onClear={() => void mutate('__all__', () => clearCart())}
        onQuantity={(line, q) =>
          void mutate(line.id, () =>
            q <= 0 ? removeLine(line.id) : setLineQuantity(line.id, q),
          )
        }
        onCheckout={() => nav.push({ name: 'checkout' })}
        bottomInset={insets.bottom}
      />
    </View>
  );
}

function Body({
  state,
  mutating,
  onRetry,
  onBrowse,
  onClear,
  onQuantity,
  onCheckout,
  bottomInset,
}: {
  state: State;
  mutating: string | null;
  onRetry: () => void;
  onBrowse: () => void;
  onClear: () => void;
  onQuantity: (line: CartLine, quantity: number) => void;
  onCheckout: () => void;
  bottomInset: number;
}): React.ReactElement {
  const theme = useTheme();
  const labelStyle = useTypeStyle('label.lg');
  const bodyStyle = useTypeStyle('body.md');

  if (state.kind === 'loading') {
    return (
      <View style={{ flex: 1, padding: 16 }}>
        <Spinner label="Loading your cart" />
      </View>
    );
  }

  if (state.kind === 'error') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 16 }}>
        <ErrorState errorCode={state.code} onRetry={onRetry} />
      </View>
    );
  }

  const { cart } = state;

  if (cart.lines.length === 0) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 16 }}>
        <EmptyState
          title="Your cart is empty"
          description="Add dishes from a certified kitchen and they'll show up here."
          primaryAction={{ label: 'Browse restaurants', onPress: onBrowse }}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {cart.restaurant ? (
          <Text style={[labelStyle, { color: theme.color.text.secondary }]}>
            {cart.restaurant.name}
          </Text>
        ) : null}

        {cart.lines.map((line) => (
          <LineRow
            key={line.id}
            line={line}
            busy={mutating === line.id}
            onQuantity={(q) => onQuantity(line, q)}
          />
        ))}
      </ScrollView>

      <View
        style={{
          padding: 16,
          paddingBottom: 16 + bottomInset,
          gap: 12,
          backgroundColor: theme.color.surface.raised,
          borderTopWidth: 1,
          borderTopColor: theme.color.border.decorative,
        }}
      >
        {!cart.is_quotable ? (
          <Banner
            variant="warning"
            title="Not ready to check out"
            description={
              cart.blocking_reasons && cart.blocking_reasons.length > 0
                ? blockingCopy(cart.blocking_reasons[0]!)
                : 'One or more items are unavailable, or no delivery address is selected.'
            }
          />
        ) : null}

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={[bodyStyle, { color: theme.color.text.secondary }]}>
            Subtotal (indicative)
          </Text>
          <Price cents={cents(cart.indicative_subtotal_cents)} size="lg" />
        </View>

        <Button variant="primary" onPress={onCheckout} disabled={!cart.is_quotable}>
          Continue to checkout
        </Button>
        <Button variant="ghost" onPress={onClear} disabled={mutating === '__all__'}>
          Clear cart
        </Button>
      </View>
    </View>
  );
}

function LineRow({
  line,
  busy,
  onQuantity,
}: {
  line: CartLine;
  busy: boolean;
  onQuantity: (quantity: number) => void;
}): React.ReactElement {
  const theme = useTheme();
  const nameStyle = useTypeStyle('label.lg');
  const subStyle = useTypeStyle('body.sm');
  const unavailable = !line.availability.is_available;

  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 12,
        padding: 12,
        borderRadius: 12,
        backgroundColor: theme.color.surface.raised,
        borderWidth: 1,
        borderColor: theme.color.border.decorative,
        opacity: unavailable ? 0.7 : 1,
      }}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[nameStyle, { color: theme.color.text.primary }]}>{line.name}</Text>
        {line.variant ? (
          <Text style={[subStyle, { color: theme.color.text.secondary }]}>
            {line.variant.name}
          </Text>
        ) : null}
        {unavailable ? (
          <Text style={[subStyle, { color: theme.color.text.tertiary }]}>
            {availabilityCopy(line.availability.reason)}
          </Text>
        ) : null}
        <Price cents={cents(line.line_total_cents)} size="md" />
      </View>

      <QuantityStepper
        value={line.quantity}
        min={0}
        max={20}
        removeAtZero
        itemName={line.name}
        loading={busy}
        disabled={unavailable}
        onChange={onQuantity}
      />
    </View>
  );
}

function availabilityCopy(reason: CartLine['availability']['reason']): string {
  switch (reason) {
    case 'OUT_OF_STOCK':
      return 'Out of stock';
    case 'ITEM_DELETED':
      return 'No longer on the menu';
    case 'CATEGORY_INACTIVE':
      return 'Section unavailable';
    case 'RESTAURANT_CLOSED':
      return 'Restaurant is closed';
    case 'RESTAURANT_UNAVAILABLE':
      return 'Restaurant is unavailable';
    case 'PRICE_CHANGED':
      return 'Price changed';
    case 'VARIANT_UNAVAILABLE':
      return 'Chosen option unavailable';
    case 'ADDON_UNAVAILABLE':
      return 'An add-on is unavailable';
    default:
      return 'Currently unavailable';
  }
}

function blockingCopy(code: string): string {
  switch (code) {
    case 'RESTAURANT_CLOSED':
      return 'The restaurant is closed right now.';
    case 'CART_HAS_UNAVAILABLE_ITEMS':
      return 'Some items in your cart are no longer available.';
    case 'NO_ADDRESS':
      return 'Add a delivery address to continue.';
    default:
      return 'This cart can’t be quoted yet.';
  }
}
