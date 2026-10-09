/**
 * Cart (C-19), as the approved "Cart & Checkout" canvas draws it (Cart — default and its states).
 *
 * Reads `GET /v1/cart` and renders it verbatim. Every quantity change, removal and "Clear cart"
 * goes to the server and re-renders from the *recomputed* cart; the stepper freezes while its
 * mutation is in flight. Nothing here adds cents.
 *
 * Each line shows what tells it apart from another line of the same dish: the variant, every
 * add-on with its count, and the special request (the `CartLine` fields). A line the server marks
 * unavailable is annotated, never dropped (R-19).
 *
 * The totals block is the server's: once the cart is quotable and has a delivery address, the
 * cart prices it with `createQuote` (no tip) and shows the same rows checkout will (C-22 AC1).
 * Until then, or if that quote is refused, it shows the cart's indicative items subtotal and says
 * delivery and fees come at checkout. A refused quote is a neutral notice, never red.
 *
 * While staff have paused new orders (#388) the cart says so and offers no checkout.
 */
import * as React from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Schema } from '@hg/api-client';
import {
  AppBar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  HalalBadge,
  Modal,
  Price,
  QuantityStepper,
  Skeleton,
  elevationStyle,
  useTheme,
  useTypeStyle,
} from '@hg/ui-native';

import { clearCart, getCart, removeLine, setLineQuantity } from '../api/cart';
import { createQuote, type Quote } from '../api/orders';
import { errorCodeOf } from '../api/async';
import { useNavigation } from '../navigation/stack';
import { ORDERING_PAUSED, OrderingPausedNotice, useOrderingPause } from '../ordering/orderingPause';
import { checkoutProblem, lineOptions, requestText, safeCents } from '../ordering/lines';
import { MoneyRow, Notice } from '../components/OrderBits';
import { ScreenBoundary } from '../components/ScreenBoundary';

type Cart = Schema['Cart'];
type CartLine = Schema['CartLine'];

type State =
  | { kind: 'loading' }
  | { kind: 'error'; code: string | null }
  | { kind: 'ready'; cart: Cart };

type QuoteState =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'ready'; quote: Quote }
  | { kind: 'failed'; code: string | null };

/** Quote refusals that also stop checkout: the cart itself has to change first. */
const BLOCKS_CHECKOUT: ReadonlySet<string> = new Set([
  'BELOW_MINIMUM_ORDER',
  'CART_HAS_UNAVAILABLE_ITEMS',
  'RESTAURANT_CLOSED',
  'RESTAURANT_UNAVAILABLE',
  ORDERING_PAUSED,
]);

export function CartScreen(): React.ReactElement {
  const nav = useNavigation();
  return (
    <ScreenBoundary what="your cart" exit={{ label: 'Back', onPress: nav.back }}>
      <CartView />
    </ScreenBoundary>
  );
}

function CartView(): React.ReactElement {
  const theme = useTheme();
  const nav = useNavigation();
  const { paused: configPaused, markPaused } = useOrderingPause();

  const [state, setState] = React.useState<State>({ kind: 'loading' });
  const [quote, setQuote] = React.useState<QuoteState>({ kind: 'none' });
  const [mutating, setMutating] = React.useState<string | null>(null);
  const [mutationFailed, setMutationFailed] = React.useState(false);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const live = React.useRef(true);
  const quoteSeq = React.useRef(0);
  React.useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );

  // Price the cart the same way checkout will. Only the latest request may land.
  const priceCart = React.useCallback(
    (cart: Cart) => {
      const seq = ++quoteSeq.current;
      const paused = configPaused || (cart.blocking_reasons ?? []).includes(ORDERING_PAUSED);
      if (!cart.is_quotable || !cart.delivery_address_id || cart.lines.length === 0 || paused) {
        setQuote({ kind: 'none' });
        return;
      }
      setQuote({ kind: 'loading' });
      createQuote({
        cartId: cart.id,
        fulfilment: 'DELIVERY',
        deliveryAddressId: cart.delivery_address_id,
        tipCents: 0,
      })
        .then((q) => {
          if (live.current && seq === quoteSeq.current) setQuote({ kind: 'ready', quote: q });
        })
        .catch((e) => {
          if (!live.current || seq !== quoteSeq.current) return;
          const code = errorCodeOf(e);
          if (code === ORDERING_PAUSED) markPaused();
          setQuote({ kind: 'failed', code });
        });
    },
    [configPaused, markPaused],
  );

  const show = React.useCallback(
    (cart: Cart) => {
      setState({ kind: 'ready', cart });
      priceCart(cart);
    },
    [priceCart],
  );

  const load = React.useCallback(() => {
    setState({ kind: 'loading' });
    getCart()
      .then((cart) => {
        if (live.current) show(cart);
      })
      .catch((e) => {
        if (live.current) setState({ kind: 'error', code: errorCodeOf(e) });
      });
  }, [show]);

  React.useEffect(() => load(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Every mutation returns the whole recomputed cart; we render that, never a local guess. A
  // failed mutation keeps the cart on screen, says so, and re-reads the server's copy.
  const mutate = React.useCallback(
    async (key: string, run: () => Promise<Cart>) => {
      setMutating(key);
      setMutationFailed(false);
      try {
        const cart = await run();
        if (live.current) show(cart);
      } catch {
        if (!live.current) return;
        setMutationFailed(true);
        try {
          const cart = await getCart();
          if (live.current) show(cart);
        } catch {
          /* keep what is on screen; the notice says the change did not go through */
        }
      } finally {
        if (live.current) setMutating(null);
      }
    },
    [show],
  );

  const restaurantName = state.kind === 'ready' ? (state.cart.restaurant?.name ?? null) : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.base }}>
      <AppBar
        tone="cream"
        title="Your cart"
        back={{ onPress: nav.back, previousTitle: restaurantName ?? undefined }}
        loading={state.kind === 'loading' || mutating !== null}
      />

      {state.kind === 'loading' ? (
        <LoadingBody />
      ) : state.kind === 'error' ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: 16 }}>
          <ErrorState
            errorCode={state.code}
            title="We couldn't load your cart"
            description="Your items are saved on our side. Check your connection and try again."
            onRetry={load}
          />
        </View>
      ) : state.cart.lines.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: 16 }}>
          <EmptyState
            title="Your cart is empty"
            description="Add dishes from a certified restaurant to start an order."
            primaryAction={{ label: 'Find a restaurant', onPress: () => nav.reset({ name: 'discovery' }) }}
          />
        </View>
      ) : (
        <ReadyBody
          cart={state.cart}
          quote={quote}
          mutating={mutating}
          mutationFailed={mutationFailed}
          configPaused={configPaused}
          onClear={() => setConfirmClear(true)}
          onQuantity={(line, q) =>
            void mutate(line.id, () => (q <= 0 ? removeLine(line.id) : setLineQuantity(line.id, q)))
          }
          onCheckout={() => nav.push({ name: 'checkout' })}
        />
      )}

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Clear your cart?"
        description={
          restaurantName
            ? `This removes everything from ${restaurantName}.`
            : 'This removes everything in your cart.'
        }
        actions={[
          { label: 'Keep my items', onPress: () => setConfirmClear(false) },
          {
            label: 'Clear cart',
            destructive: true,
            onPress: () => {
              setConfirmClear(false);
              void mutate('__all__', () => clearCart());
            },
          },
        ]}
      />
    </View>
  );
}

function LoadingBody(): React.ReactElement {
  const theme = useTheme();
  const small = useTypeStyle('body.sm');
  return (
    <View style={{ flex: 1 }} aria-busy>
      <View style={{ flex: 1, padding: 16, paddingTop: 8, gap: 12 }}>
        <Skeleton variant="rect" height={72} />
        {[0, 1].map((i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 12 }}>
            <Skeleton variant="rect" width={56} height={56} />
            <View style={{ flex: 1, gap: 8 }}>
              <Skeleton variant="text" width="70%" height={16} />
              <Skeleton variant="text" width="50%" height={12} />
            </View>
          </View>
        ))}
        <Text accessibilityRole="text" style={[small, { color: theme.color.text.secondary }]}>
          Loading your cart…
        </Text>
      </View>
      <Footer>
        <MoneyRow label="Items subtotal" value={0} loading />
        <MoneyRow label="Total" value={0} loading total />
        <Button variant="primary" size="lg" fullWidth disabled>
          Go to checkout
        </Button>
      </Footer>
    </View>
  );
}

function Footer({ children }: { children: React.ReactNode }): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      testID="CartFooter"
      style={[
        elevationStyle(theme, 'sticky'),
        {
          gap: 8,
          padding: 16,
          paddingBottom: 16 + insets.bottom,
          backgroundColor: theme.color.surface.raised,
        },
      ]}
    >
      {children}
    </View>
  );
}

function ReadyBody({
  cart,
  quote,
  mutating,
  mutationFailed,
  configPaused,
  onClear,
  onQuantity,
  onCheckout,
}: {
  cart: Cart;
  quote: QuoteState;
  mutating: string | null;
  mutationFailed: boolean;
  configPaused: boolean;
  onClear: () => void;
  onQuantity: (line: CartLine, quantity: number) => void;
  onCheckout: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const nameStyle = useTypeStyle('heading.md');
  const small = useTypeStyle('body.sm');
  const orderingPaused = configPaused || (cart.blocking_reasons ?? []).includes(ORDERING_PAUSED);
  const restaurant = cart.restaurant ?? null;
  const quoteCode = quote.kind === 'failed' ? quote.code : null;
  const quoteProblem =
    quoteCode && quoteCode !== ORDERING_PAUSED
      ? checkoutProblem(quoteCode, restaurant?.name, 'quote', restaurant?.availability?.state)
      : null;
  // A cart with no delivery address is not quotable, but checkout is where the address is
  // chosen, so that alone does not stop the customer going on.
  const needsAddressOnly =
    !cart.is_quotable && !cart.delivery_address_id && (cart.blocking_reasons ?? []).length === 0;
  const blocked =
    orderingPaused ||
    (!cart.is_quotable && !needsAddressOnly) ||
    (quoteCode !== null && BLOCKS_CHECKOUT.has(quoteCode));

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 16 }}>
        {restaurant ? (
          <Card variant="outlined" padding={16}>
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={[nameStyle, { flex: 1, color: theme.color.text.primary }]}>
                  {restaurant.name}
                </Text>
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={onClear}
                  disabled={mutating !== null}
                  testID="Cart-clear"
                >
                  Clear cart
                </Button>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <HalalBadge
                  state={restaurant.halal?.display_state}
                  size="md"
                  surface="card"
                  restaurantId={restaurant.id}
                />
                {restaurant.halal?.certifying_body_name ? (
                  <Text style={[small, { color: theme.color.text.secondary }]}>
                    {restaurant.halal.certifying_body_name}
                  </Text>
                ) : null}
              </View>
            </View>
          </Card>
        ) : null}

        {mutationFailed ? (
          <Notice
            testID="Cart-mutation-failed"
            title="That change didn't go through"
            body="Your cart below is what we have saved. Try again."
          />
        ) : null}

        <View accessibilityLabel="Items">
          {cart.lines.map((line, i) => (
            <LineRow
              key={line.id}
              line={line}
              last={i === cart.lines.length - 1}
              busy={mutating === line.id || mutating === '__all__'}
              frozen={mutating !== null}
              onQuantity={(q) => onQuantity(line, q)}
            />
          ))}
        </View>
      </ScrollView>

      <Footer>
        {orderingPaused ? (
          <OrderingPausedNotice />
        ) : needsAddressOnly ? null : !cart.is_quotable ? (
          <Notice
            title="Not ready to check out"
            body={blockingCopy(
              cart.blocking_reasons?.[0] ?? null,
              restaurant?.availability?.state ?? null,
            )}
          />
        ) : quoteProblem ? (
          <Notice title={quoteProblem.title} body={quoteProblem.body} />
        ) : null}

        {quote.kind === 'ready' ? (
          <QuoteRows quote={quote.quote} />
        ) : (
          <>
            <MoneyRow
              label="Items subtotal"
              value={cart.indicative_subtotal_cents}
              loading={quote.kind === 'loading'}
            />
            {quote.kind === 'loading' ? (
              <>
                <MoneyRow label="Delivery fee" value={0} loading />
                <MoneyRow label="Service fee" value={0} loading />
                <MoneyRow label="Total" value={0} loading total />
              </>
            ) : (
              <Text style={[small, { color: theme.color.text.secondary }]}>
                Delivery and service fees are added at checkout, priced for your address.
              </Text>
            )}
          </>
        )}

        {orderingPaused ? null : (
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onPress={onCheckout}
            disabled={blocked || mutating !== null}
            testID="Cart-checkout"
          >
            Go to checkout
          </Button>
        )}
      </Footer>
    </View>
  );
}

/** The quote's rows, in the C-22 order, with the same labels checkout uses. */
export function QuoteRows({ quote }: { quote: Quote }): React.ReactElement {
  const discount = safeCents(quote.discount?.amount_cents);
  return (
    <View style={{ gap: 4 }}>
      <MoneyRow label="Items subtotal" value={quote.subtotal_cents} />
      {discount !== null && discount !== 0 ? (
        <MoneyRow
          label={quote.discount?.code ? `Discount (${quote.discount.code})` : 'Discount'}
          value={-Math.abs(discount)}
        />
      ) : null}
      <MoneyRow label="Delivery fee" value={quote.delivery_fee_cents} />
      <MoneyRow label="Service fee" value={quote.service_fee_cents} />
      {(quote.tax_lines ?? []).map((tax, i) => (
        <MoneyRow
          key={`${tax.jurisdiction_code}-${tax.statutory_label}-${i}`}
          label={tax.statutory_label}
          value={tax.amount_cents}
        />
      ))}
      {safeCents(quote.tip_cents) ? (
        <MoneyRow label="Tip for your rider" value={quote.tip_cents} />
      ) : null}
      <MoneyRow label="Total" value={quote.total_cents} total testID="Quote-total" />
    </View>
  );
}

function LineRow({
  line,
  last,
  busy,
  frozen,
  onQuantity,
}: {
  line: CartLine;
  last: boolean;
  busy: boolean;
  frozen: boolean;
  onQuantity: (quantity: number) => void;
}): React.ReactElement {
  const theme = useTheme();
  const nameStyle = useTypeStyle('label.lg');
  const small = useTypeStyle('body.sm');
  const unavailable = line.availability?.is_available === false;
  const options = lineOptions(line);
  const request = requestText(line.special_request);
  const lineTotal = safeCents(line.line_total_cents);
  const unit = safeCents(line.unit_price_cents);
  const nowPrice = safeCents(line.availability?.current_price_cents);

  return (
    <View
      testID={`CartLine-${line.id}`}
      style={{
        flexDirection: 'row',
        gap: 12,
        paddingVertical: 12,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: theme.color.border.decorative,
      }}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 56,
          height: 56,
          borderRadius: 8,
          overflow: 'hidden',
          backgroundColor: theme.color.surface.sunken,
          opacity: unavailable ? 0.6 : 1,
        }}
      >
        {line.image_url ? (
          <Image source={{ uri: line.image_url }} style={{ width: 56, height: 56 }} />
        ) : null}
      </View>

      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text style={[nameStyle, { flex: 1, color: theme.color.text.primary }]}>{line.name}</Text>
          {lineTotal !== null ? <Price cents={lineTotal} size="md" /> : null}
        </View>
        {options ? (
          <Text testID="CartLine-options" style={[small, { color: theme.color.text.secondary }]}>
            {options}
          </Text>
        ) : null}
        {request ? (
          <Text
            testID="CartLine-request"
            style={[small, { color: theme.color.text.secondary, fontStyle: 'italic' }]}
          >
            {request}
          </Text>
        ) : null}
        {unavailable ? (
          <Text style={[small, { color: theme.color.text.primary, fontWeight: '600' }]}>
            {availabilityCopy(line.availability?.reason ?? null)}
          </Text>
        ) : null}
        {line.availability?.reason === 'PRICE_CHANGED' && nowPrice !== null ? (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
            <Text style={[small, { color: theme.color.text.secondary }]}>Now</Text>
            <Price cents={nowPrice} size="sm" />
            <Text style={[small, { color: theme.color.text.secondary }]}>each</Text>
          </View>
        ) : null}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
            {unit !== null ? (
              <>
                <Price cents={unit} size="sm" color={theme.color.text.secondary} />
                <Text style={[small, { color: theme.color.text.secondary }]}>each</Text>
              </>
            ) : null}
          </View>
          <QuantityStepper
            variant="tonal"
            size="sm"
            value={line.quantity}
            min={0}
            max={20}
            removeAtZero
            itemName={line.name}
            maxReason="20 is the most one line can hold"
            loading={busy}
            disabled={frozen && !busy}
            onChange={onQuantity}
            testID={`CartLine-stepper-${line.id}`}
          />
        </View>
      </View>
    </View>
  );
}

function availabilityCopy(reason: string | null): string {
  switch (reason) {
    case 'OUT_OF_STOCK':
      return 'Sold out right now. Remove it to check out.';
    case 'ITEM_DELETED':
      return 'No longer on the menu. Remove it to check out.';
    case 'CATEGORY_INACTIVE':
      return 'Not served right now. Remove it to check out.';
    case 'RESTAURANT_CLOSED':
      return 'The restaurant is closed right now.';
    case 'RESTAURANT_UNAVAILABLE':
      return "The restaurant can't take orders right now.";
    case 'PRICE_CHANGED':
      return 'The price changed since you added it.';
    case 'VARIANT_UNAVAILABLE':
      return 'The size you chose is sold out.';
    case 'ADDON_UNAVAILABLE':
      return 'An extra you chose ran out.';
    default:
      return 'Not available right now.';
  }
}

function blockingCopy(code: string | null, availabilityState: string | null): string {
  switch (code) {
    case 'RESTAURANT_CLOSED':
      // Paused, switch off or order screen offline reads PAUSED, never "closed" (owner, 2026-10-09).
      return availabilityState === 'PAUSED'
        ? 'Temporarily not accepting orders, please try again later. Your cart is saved.'
        : 'The restaurant is closed right now. Your cart is saved.';
    case 'RESTAURANT_UNAVAILABLE':
      return "The restaurant can't take orders right now. Your cart is saved.";
    case 'CART_HAS_UNAVAILABLE_ITEMS':
      return 'Something in your cart is no longer available. Remove it to continue.';
    case 'BELOW_MINIMUM_ORDER':
      return 'Your cart is below the minimum order. Add more items to continue.';
    case 'NO_ADDRESS':
      return 'Add a delivery address to continue.';
    default:
      return 'One or more items are unavailable, or no delivery address is selected.';
  }
}
