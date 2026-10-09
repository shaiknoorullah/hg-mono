/**
 * Checkout (P-09 / C-23), as the approved "Cart & Checkout" canvas draws it: Checkout — ready,
 * calculating, tip, tip over the limit, prices updated, choose address, placing, the blocking
 * errors (cannot deliver, unavailable, closed, ran out, below minimum, price hold ran out) and
 * error.
 *
 * The screen reads the cart and the saved addresses, then POSTs a quote for the chosen address
 * and tip. The quote is the only source of the numbers shown, every one through `Price`. The
 * request carries the cart id, the address id and the tip in cents; never a price (G-3).
 * Changing the address or the tip prices the order again; only the newest quote may land.
 *
 * "Place order" POSTs `/v1/orders` with the `quote_id` only. A refused quote or order is a
 * designed state with one next step (`checkoutProblem`), never a throw: out of range offers
 * another address, a closed or unavailable restaurant goes back to the cart or elsewhere, an
 * expired or stale quote is priced again and the customer checks the new total.
 *
 * Payment is the payments module's (`payForOrder`); this screen only reads its outcome. Once the
 * order exists, a cancelled or failed payment keeps that same order and offers to pay again,
 * never a second order.
 *
 * Every async path here catches, and a render-time surprise falls to `ScreenBoundary`, so no
 * response shape the server sends can take the app down.
 */
import * as React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { parseAmountToCents } from '@hg/api-client';
import type { Cents, Schema } from '@hg/api-client';
import {
  AppBar,
  Button,
  ErrorState,
  HalalBadge,
  Icon,
  Input,
  Price,
  Radio,
  RadioGroup,
  Sheet,
  Skeleton,
  elevationStyle,
  formatAbsoluteTime,
  formatPrice,
  useTheme,
  useTypeStyle,
} from '@hg/ui-native';

import { getCart } from '../api/cart';
import { listAddresses, sortForDelivery, type Address } from '../api/addresses';
import { createQuote, placeOrder, type Quote } from '../api/orders';
import { payForOrder } from '../payments/payForOrder';
import { errorCodeOf } from '../api/async';
import { useNavigation } from '../navigation/stack';
import { ORDERING_PAUSED, OrderingPausedNotice, useOrderingPause } from '../ordering/orderingPause';
import {
  checkoutProblem,
  clockTime,
  pricedLineOptions,
  requestText,
  safeCents,
  type CheckoutProblem,
} from '../ordering/lines';
import { ItemRow, MoneyRow, Notice, SectionCard } from '../components/OrderBits';
import { ScreenBoundary } from '../components/ScreenBoundary';

type Cart = Schema['Cart'];

/** The canvas's presets. Tip is 0 by default (C-36 rule 1). */
const TIP_PRESETS: ReadonlyArray<{ value: string; label: string; cents: number }> = [
  { value: '0', label: 'No tip', cents: 0 },
  { value: '200', label: '$2', cents: 200 },
  { value: '300', label: '$3', cents: 300 },
  { value: '500', label: '$5', cents: 500 },
];

type Setup =
  | { kind: 'loading' }
  | { kind: 'error'; code: string | null }
  | { kind: 'no-address'; cart: Cart }
  | { kind: 'ready'; cart: Cart; addresses: Address[] };

type Pricing =
  | { kind: 'idle' }
  | { kind: 'pricing'; previous: Quote | null }
  | { kind: 'priced'; quote: Quote }
  | { kind: 'refused'; code: string | null; problem: CheckoutProblem };

/** The order exists; paying again uses it, never a new one. */
type Unpaid = { orderId: string; secret: string; message: string };

export function CheckoutScreen(): React.ReactElement {
  const nav = useNavigation();
  return (
    <ScreenBoundary what="checkout" exit={{ label: 'Back to cart', onPress: nav.back }}>
      <CheckoutView />
    </ScreenBoundary>
  );
}

function CheckoutView(): React.ReactElement {
  const theme = useTheme();
  const nav = useNavigation();
  const { paused: configPaused, markPaused } = useOrderingPause();
  const bodyStyle = useTypeStyle('body.md');

  const [setup, setSetup] = React.useState<Setup>({ kind: 'loading' });
  const [addressId, setAddressId] = React.useState<string | null>(null);
  const [tipChoice, setTipChoice] = React.useState('0');
  const [otherText, setOtherText] = React.useState('');
  const [tipError, setTipError] = React.useState<string | null>(null);
  const [pricing, setPricing] = React.useState<Pricing>({ kind: 'idle' });
  const [repriced, setRepriced] = React.useState<{ title: string; was: Quote | null } | null>(
    null,
  );
  const [placing, setPlacing] = React.useState(false);
  const [placeProblem, setPlaceProblem] = React.useState<CheckoutProblem | null>(null);
  const [refusedPaused, setRefusedPaused] = React.useState(false);
  const [unpaid, setUnpaid] = React.useState<Unpaid | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);

  const live = React.useRef(true);
  const seq = React.useRef(0);
  React.useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );

  // The tip the customer chose, in cents, or null while "Other" holds no valid amount.
  const tipCents: number | null = React.useMemo(() => {
    if (tipChoice !== 'other') return TIP_PRESETS.find((p) => p.value === tipChoice)?.cents ?? 0;
    const parsed = parseAmountToCents(otherText);
    return parsed !== null && parsed >= 0 ? parsed : null;
  }, [tipChoice, otherText]);

  const cart = setup.kind === 'ready' || setup.kind === 'no-address' ? setup.cart : null;
  const restaurantName = cart?.restaurant?.name ?? null;
  const availabilityState = cart?.restaurant?.availability?.state ?? null;

  /** Price the cart for this address and tip. Only the newest request may land. */
  const price = React.useCallback(
    async (forCart: Cart, forAddress: string, tip: number, opts: { repricedTitle?: string } = {}) => {
      const mine = ++seq.current;
      setPricing((p) => ({
        kind: 'pricing',
        previous: p.kind === 'priced' ? p.quote : p.kind === 'pricing' ? p.previous : null,
      }));
      try {
        const quote = await createQuote({
          cartId: forCart.id,
          fulfilment: 'DELIVERY',
          deliveryAddressId: forAddress,
          tipCents: tip,
        });
        if (!live.current || mine !== seq.current) return;
        setPricing((p) => {
          if (opts.repricedTitle) {
            setRepriced({ title: opts.repricedTitle, was: p.kind === 'pricing' ? p.previous : null });
          }
          return { kind: 'priced', quote };
        });
      } catch (e) {
        if (!live.current || mine !== seq.current) return;
        const code = errorCodeOf(e);
        if (code === ORDERING_PAUSED) {
          setRefusedPaused(true);
          markPaused();
        }
        // A tip the server will not take: say so on the field and price without it, so the
        // customer still sees a real total (Checkout — tip over the limit).
        if (tip > 0 && (code === 'VALIDATION_FAILED' || code === 'TIP_OUT_OF_RANGE')) {
          setTipError('That tip is more than we can accept for this order. Try a smaller amount.');
          void price(forCart, forAddress, 0);
          return;
        }
        setPricing({
          kind: 'refused',
          code,
          problem: checkoutProblem(
            code,
            forCart.restaurant?.name,
            'quote',
            forCart.restaurant?.availability?.state,
          ),
        });
      }
    },
    [markPaused],
  );

  const load = React.useCallback(async () => {
    setSetup({ kind: 'loading' });
    setPricing({ kind: 'idle' });
    setPlaceProblem(null);
    try {
      const [loadedCart, list] = await Promise.all([getCart(), listAddresses()]);
      if (!live.current) return;
      const addresses = sortForDelivery(Array.isArray(list) ? list : []);
      // The cart's selected address first (C-19 rule 3), then the default, then the first.
      const chosen =
        addresses.find((a) => a.id === loadedCart.delivery_address_id) ?? addresses[0] ?? null;
      if (!chosen) {
        setSetup({ kind: 'no-address', cart: loadedCart });
        return;
      }
      setSetup({ kind: 'ready', cart: loadedCart, addresses });
      setAddressId(chosen.id);
      void price(loadedCart, chosen.id, 0);
    } catch (e) {
      if (live.current) setSetup({ kind: 'error', code: errorCodeOf(e) });
    }
  }, [price]);

  React.useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-price when the tip settles (debounced while typing an "Other" amount).
  const firstTip = React.useRef(true);
  React.useEffect(() => {
    if (firstTip.current) {
      firstTip.current = false;
      return;
    }
    if (setup.kind !== 'ready' || !addressId || tipCents === null || unpaid) return;
    setTipError(null);
    const t = setTimeout(() => void price(setup.cart, addressId, tipCents), tipChoice === 'other' ? 600 : 0);
    return () => clearTimeout(t);
  }, [tipCents]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseAddress = React.useCallback(
    (id: string) => {
      setSheetOpen(false);
      if (setup.kind !== 'ready' || id === addressId) return;
      setAddressId(id);
      setRepriced(null);
      setPlaceProblem(null);
      void price(setup.cart, id, tipCents ?? 0);
    },
    [setup, addressId, tipCents, price],
  );

  /**
   * Pay for an order that exists, through the payments module (`payForOrder`, which never
   * throws). Placed goes to tracking; anything else keeps this same order on screen with its
   * reason and "Retry payment".
   */
  const pay = React.useCallback(
    async (orderId: string, secret: string) => {
      const outcome = await payForOrder(orderId, secret);
      if (!live.current) return;
      if (outcome.kind === 'placed') {
        nav.reset({ name: 'tracking', orderId });
        return;
      }
      setUnpaid({ orderId, secret: outcome.secret, message: outcome.message });
    },
    [nav],
  );

  const onPlace = React.useCallback(async () => {
    if (placing) return;
    setPlacing(true);
    setPlaceProblem(null);
    try {
      if (unpaid) {
        await pay(unpaid.orderId, unpaid.secret);
        return;
      }
      if (pricing.kind !== 'priced' || setup.kind !== 'ready' || !addressId) return;
      let created: Schema['OrderCreated'] | null = null;
      try {
        created = await placeOrder(pricing.quote.id);
      } catch (e) {
        if (!live.current) return;
        const code = errorCodeOf(e);
        if (code === ORDERING_PAUSED) {
          setRefusedPaused(true);
          markPaused();
          return;
        }
        const problem = checkoutProblem(code, restaurantName, 'place', availabilityState);
        if (problem.action === 'requote') {
          // Price again and let the customer check the new total before placing it.
          void price(setup.cart, addressId, tipCents ?? 0, { repricedTitle: problem.title });
          return;
        }
        setPlaceProblem(problem);
        return;
      }
      const orderId = created?.order?.id;
      const secret = created?.client_secret;
      if (!orderId) {
        setPlaceProblem(checkoutProblem(null, restaurantName, 'place'));
        return;
      }
      if (typeof secret !== 'string' || secret === '') {
        // The order exists; tracking shows where its payment stands.
        nav.reset({ name: 'tracking', orderId });
        return;
      }
      await pay(orderId, secret);
    } catch {
      if (live.current) setPlaceProblem(checkoutProblem(null, restaurantName, 'place'));
    } finally {
      if (live.current) setPlacing(false);
    }
  }, [
    placing,
    unpaid,
    pay,
    pricing,
    setup,
    addressId,
    markPaused,
    restaurantName,
    availabilityState,
    price,
    tipCents,
    nav,
  ]);

  const showPaused = !unpaid && (configPaused || refusedPaused);
  const address =
    setup.kind === 'ready' ? (setup.addresses.find((a) => a.id === addressId) ?? null) : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.base }}>
      <AppBar
        tone="cream"
        title="Checkout"
        subtitle={restaurantName ?? undefined}
        back={{ onPress: nav.back, previousTitle: 'cart' }}
        loading={setup.kind === 'loading' || pricing.kind === 'pricing' || placing}
      />

      {showPaused ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: 16, gap: 16 }}>
          <OrderingPausedNotice refused={refusedPaused} />
          <Button variant="secondary" fullWidth onPress={nav.back}>
            Back to cart
          </Button>
        </View>
      ) : setup.kind === 'loading' ? (
        <LoadingBody />
      ) : setup.kind === 'error' ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: 16 }}>
          <ErrorState
            errorCode={setup.code}
            title="We couldn't price this order"
            description="Nothing has been charged and your cart is saved. Try again, or go back to your cart."
            onRetry={() => void load()}
            action={{ label: 'Back to cart', onPress: nav.back }}
          />
        </View>
      ) : setup.kind === 'no-address' ? (
        <View style={{ flex: 1, padding: 16, gap: 16 }}>
          <Notice
            icon="map"
            title="Where should we deliver?"
            body="Add a delivery address to see the price of this order. Nothing is charged yet."
          />
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onPress={() => nav.push({ name: 'addressForm', addressId: null })}
          >
            Add an address
          </Button>
        </View>
      ) : (
        <>
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, gap: 16 }}
            keyboardShouldPersistTaps="handled"
          >
            {unpaid ? (
              <Notice
                testID="Checkout-unpaid"
                icon="clock"
                title="Payment not completed"
                body={unpaid.message}
              />
            ) : null}
            {placeProblem ? (
              <Notice testID="Checkout-place-problem" title={placeProblem.title} body={placeProblem.body} />
            ) : null}
            {pricing.kind === 'refused' ? (
              <Notice
                testID="Checkout-quote-problem"
                icon={pricing.problem.action === 'address' ? 'map' : undefined}
                title={pricing.problem.title}
                body={pricing.problem.body}
              />
            ) : null}
            {repriced && pricing.kind === 'priced' ? (
              <Notice testID="Checkout-repriced" title={repriced.title}>
                <RepricedLine was={repriced.was} now={pricing.quote} />
              </Notice>
            ) : null}

            <RestaurantCard cart={setup.cart} />

            <SectionCard title="Deliver to">
              <AddressRow
                address={address}
                locked={unpaid !== null}
                onChange={() => setSheetOpen(true)}
              />
            </SectionCard>

            {pricing.kind === 'refused' ? (
              <SectionCard title="Your order">
                <Text style={[bodyStyle, { color: theme.color.text.secondary }]}>
                  {pricing.problem.action === 'address'
                    ? `We'll price your order once you choose an address ${restaurantName ?? 'the restaurant'} delivers to.`
                    : 'No price until this is sorted. Nothing has been charged.'}
                </Text>
              </SectionCard>
            ) : (
              <>
                <TipCard
                  choice={tipChoice}
                  otherText={otherText}
                  error={tipError}
                  locked={unpaid !== null || placing}
                  onChoice={(v) => {
                    setTipError(null);
                    setTipChoice(v);
                  }}
                  onOther={setOtherText}
                />
                <SummaryCard pricing={pricing} tipError={tipError !== null} />
              </>
            )}
          </ScrollView>

          <Footer>
            <FooterActions
              pricing={pricing}
              placeProblem={placeProblem}
              placing={placing}
              unpaid={unpaid}
              tipBlocked={tipError !== null || tipCents === null}
              onPlace={() => void onPlace()}
              onChangeAddress={() => setSheetOpen(true)}
              onRetry={() => {
                if (setup.kind === 'ready' && addressId) void price(setup.cart, addressId, tipCents ?? 0);
              }}
              onCart={nav.back}
              onBrowse={() => nav.reset({ name: 'discovery' })}
              onOrders={() => nav.reset({ name: 'orders' })}
              onProfile={() => nav.push({ name: 'profile' })}
              onTrack={(orderId) => nav.reset({ name: 'tracking', orderId })}
            />
          </Footer>

          <Sheet
            open={sheetOpen}
            onClose={() => setSheetOpen(false)}
            title="Deliver to"
            description="Changing the address prices the order again."
            snapPoints={[0.6]}
          >
            <View style={{ gap: 16, paddingBottom: 16 }}>
              <RadioGroup
                name="delivery-address"
                label="Saved addresses"
                value={addressId}
                onChange={chooseAddress}
              >
                {setup.addresses.map((a) => (
                  <Radio
                    key={a.id}
                    value={a.id}
                    label={addressTitle(a)}
                    description={addressDetail(a)}
                    testID={`Checkout-address-${a.id}`}
                  />
                ))}
              </RadioGroup>
              <Button
                variant="tertiary"
                size="lg"
                fullWidth
                iconStart={<Icon name="plus" size={20} color={theme.color.text.primary} />}
                onPress={() => {
                  setSheetOpen(false);
                  nav.push({ name: 'addressForm', addressId: null });
                }}
              >
                Add a new address
              </Button>
            </View>
          </Sheet>
        </>
      )}
    </View>
  );
}

function useBody() {
  return useTypeStyle('body.md');
}

function addressTitle(a: Address): string {
  return a.label ? `${a.label} · ${a.line1}` : a.line1;
}

function addressDetail(a: Address): string {
  // Saved units often already say "Unit 4211"; never print "Unit Unit 4211".
  const unit = a.unit ? (/^(unit|apt|suite)\b/i.test(a.unit) ? a.unit : `Unit ${a.unit}`) : null;
  const buzz = a.buzzer ? (/^buzz/i.test(a.buzzer) ? a.buzzer : `Buzz ${a.buzzer}`) : null;
  return [unit, buzz, `${a.city} ${a.province} ${a.postal_code}`].filter(Boolean).join(' · ');
}

function Footer({ children }: { children: React.ReactNode }): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      testID="CheckoutFooter"
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

function LoadingBody(): React.ReactElement {
  const theme = useTheme();
  const body = useBody();
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 8, gap: 16 }}>
        <Text accessibilityLiveRegion="polite" style={[body, { color: theme.color.text.secondary }]}>
          Pricing your order…
        </Text>
        <Skeleton variant="rect" height={88} />
        <Skeleton variant="rect" height={96} />
        <SectionCard title="Your order">
          <MoneyRow label="Items subtotal" value={0} loading />
          <MoneyRow label="Delivery fee" value={0} loading />
          <MoneyRow label="Service fee" value={0} loading />
          <MoneyRow label="Total" value={0} loading total />
        </SectionCard>
      </View>
      <Footer>
        <Button variant="primary" size="lg" fullWidth loading>
          Place order
        </Button>
      </Footer>
    </View>
  );
}

function RestaurantCard({ cart }: { cart: Cart }): React.ReactElement | null {
  const theme = useTheme();
  const name = useTypeStyle('heading.md');
  const small = useTypeStyle('body.sm');
  const r = cart.restaurant;
  if (!r) return null;
  const min = r.availability?.eta_min_minutes;
  const max = r.availability?.eta_max_minutes;
  const eta = typeof min === 'number' && typeof max === 'number' ? `About ${min}–${max} min` : null;
  return (
    <SectionCard>
      <Text style={[name, { color: theme.color.text.primary }]}>{r.name}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <HalalBadge state={r.halal?.display_state} size="md" surface="card" restaurantId={r.id} />
        {eta ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="clock" size={16} color={theme.color.text.secondary} />
            <Text style={[small, { color: theme.color.text.secondary }]}>{eta}</Text>
          </View>
        ) : null}
      </View>
    </SectionCard>
  );
}

function AddressRow({
  address,
  locked,
  onChange,
}: {
  address: Address | null;
  locked: boolean;
  onChange: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const strong = useTypeStyle('label.lg');
  const small = useTypeStyle('body.sm');
  const link = useTypeStyle('label.md');
  const content = (
    <>
      <Icon name="map" size={24} color={theme.color.text.secondary} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[strong, { color: theme.color.text.primary }]}>
          {address ? addressTitle(address) : 'Choose an address'}
        </Text>
        {address ? (
          <Text style={[small, { color: theme.color.text.secondary }]}>{addressDetail(address)}</Text>
        ) : null}
      </View>
      {locked ? null : <Text style={[link, { color: theme.color.text.link }]}>Change</Text>}
    </>
  );
  const rowStyle = { minHeight: 64, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 };
  if (locked) return <View style={rowStyle}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${address ? addressTitle(address) : 'No address'}. Change address`}
      onPress={onChange}
      testID="Checkout-change-address"
      style={({ pressed }) => [rowStyle, pressed ? { opacity: 0.7 } : null]}
    >
      {content}
    </Pressable>
  );
}

function TipCard({
  choice,
  otherText,
  error,
  locked,
  onChoice,
  onOther,
}: {
  choice: string;
  otherText: string;
  error: string | null;
  locked: boolean;
  onChoice: (value: string) => void;
  onOther: (text: string) => void;
}): React.ReactElement {
  const theme = useTheme();
  const small = useTypeStyle('body.sm');
  return (
    <SectionCard testID="Checkout-tip">
      <RadioGroup
        name="tip"
        label="Tip your rider"
        value={choice}
        onChange={onChoice}
        orientation="horizontal"
        disabled={locked}
      >
        {TIP_PRESETS.map((p) => (
          <Radio key={p.value} value={p.value} label={p.label} testID={`Checkout-tip-${p.value}`} />
        ))}
        <Radio value="other" label="Other" testID="Checkout-tip-other" />
      </RadioGroup>
      {choice === 'other' ? (
        <Input
          label="Tip amount"
          variant="numeric"
          prefix="$"
          value={otherText}
          onChange={onOther}
          placeholder="0.00"
          disabled={locked}
          errorText={
            error ??
            (otherText.trim() !== '' && parseAmountToCents(otherText) === null
              ? 'Enter an amount like 4.50.'
              : undefined)
          }
          testID="Checkout-tip-amount"
        />
      ) : null}
      <Text style={[small, { color: theme.color.text.secondary }]}>
        Goes entirely to your rider. Changing the tip updates the total.
      </Text>
    </SectionCard>
  );
}

function SummaryCard({
  pricing,
  tipError,
}: {
  pricing: Pricing;
  tipError: boolean;
}): React.ReactElement {
  const theme = useTheme();
  const small = useTypeStyle('body.sm');
  const quote =
    pricing.kind === 'priced' ? pricing.quote : pricing.kind === 'pricing' ? pricing.previous : null;
  const loading = pricing.kind !== 'priced';
  const discount = safeCents(quote?.discount?.amount_cents);
  const held = clockTime(quote?.expires_at, formatAbsoluteTime);
  return (
    <SectionCard title="Your order" testID="Checkout-summary">
      {(quote?.lines ?? []).map((line, i) => (
        <ItemRow
          key={`${line.line_no}-${i}`}
          quantity={line.quantity}
          name={line.menu_item_name}
          options={pricedLineOptions(line)}
          request={requestText(line.special_request)}
          amount={line.line_total_cents}
          loading={loading}
        />
      ))}
      <View style={{ height: 1, backgroundColor: theme.color.border.decorative, marginVertical: 8 }} />
      <MoneyRow label="Items subtotal" value={quote?.subtotal_cents} loading={loading} />
      {discount ? (
        <MoneyRow
          label={quote?.discount?.code ? `Discount (${quote.discount.code})` : 'Discount'}
          value={-Math.abs(discount)}
          loading={loading}
        />
      ) : null}
      <MoneyRow label="Delivery fee" value={quote?.delivery_fee_cents} loading={loading} />
      <MoneyRow label="Service fee" value={quote?.service_fee_cents} loading={loading} />
      {(quote?.tax_lines ?? []).map((tax, i) => (
        <MoneyRow
          key={`${tax.jurisdiction_code}-${tax.statutory_label}-${i}`}
          label={tax.statutory_label}
          value={tax.amount_cents}
          loading={loading}
        />
      ))}
      {safeCents(quote?.tip_cents) ? (
        <MoneyRow label="Tip for your rider" value={quote?.tip_cents} loading={loading} />
      ) : null}
      <MoneyRow label="Total" value={quote?.total_cents} total loading={loading} testID="Checkout-total" />
      <Text style={[small, { color: theme.color.text.secondary }]}>
        {loading
          ? 'Working out delivery and fees for your address.'
          : tipError
            ? 'Total without a tip until the tip amount is fixed.'
            : held
              ? `Price held until ${held}. This is the amount we'll charge.`
              : "This is the amount we'll charge."}
      </Text>
    </SectionCard>
  );
}

function RepricedLine({ was, now }: { was: Quote | null; now: Quote }): React.ReactElement {
  const theme = useTheme();
  const small = useTypeStyle('body.sm');
  const before = safeCents(was?.total_cents);
  const after = safeCents(now.total_cents);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
      <Text style={[small, { color: theme.color.text.primary }]}>
        We priced the order again. Check the total before you place it.
      </Text>
      {before !== null && after !== null && before !== after ? (
        <>
          <Price cents={before} size="sm" strikethrough color={theme.color.text.secondary} />
          <Price cents={after} size="sm" />
        </>
      ) : null}
    </View>
  );
}

function FooterActions({
  pricing,
  placeProblem,
  placing,
  unpaid,
  tipBlocked,
  onPlace,
  onChangeAddress,
  onRetry,
  onCart,
  onBrowse,
  onOrders,
  onProfile,
  onTrack,
}: {
  pricing: Pricing;
  placeProblem: CheckoutProblem | null;
  placing: boolean;
  unpaid: Unpaid | null;
  tipBlocked: boolean;
  onPlace: () => void;
  onChangeAddress: () => void;
  onRetry: () => void;
  onCart: () => void;
  onBrowse: () => void;
  onOrders: () => void;
  onProfile: () => void;
  onTrack: (orderId: string) => void;
}): React.ReactElement {
  const theme = useTheme();
  const small = useTypeStyle('body.sm');
  const body = useTypeStyle('body.md');

  if (unpaid) {
    return (
      <>
        <Button variant="primary" size="lg" fullWidth loading={placing} onPress={onPlace} testID="Checkout-pay-again">
          Retry payment
        </Button>
        <Button variant="tertiary" size="md" fullWidth onPress={() => onTrack(unpaid.orderId)}>
          View my order
        </Button>
      </>
    );
  }

  const problem = pricing.kind === 'refused' ? pricing.problem : placeProblem;
  // A refused first quote has nothing to place, so even "price hold ran out" offers Try again.
  if (problem && (problem.action !== 'requote' || pricing.kind === 'refused')) {
    switch (problem.action) {
      case 'address':
        return (
          <Button variant="primary" size="lg" fullWidth onPress={onChangeAddress}>
            Change address
          </Button>
        );
      case 'browse':
        return (
          <>
            <Button variant="primary" size="lg" fullWidth onPress={onBrowse}>
              Find another restaurant
            </Button>
            <Button variant="ghost" size="md" fullWidth onPress={onCart}>
              Back to cart
            </Button>
          </>
        );
      case 'cart':
        return (
          <Button variant="primary" size="lg" fullWidth onPress={onCart}>
            Back to cart
          </Button>
        );
      case 'orders':
        return (
          <Button variant="primary" size="lg" fullWidth onPress={onOrders}>
            Go to my order
          </Button>
        );
      case 'profile':
        return (
          <Button variant="primary" size="lg" fullWidth onPress={onProfile}>
            Finish my profile
          </Button>
        );
      default:
        return (
          <>
            <Button variant="primary" size="lg" fullWidth onPress={pricing.kind === 'refused' ? onRetry : onPlace}>
              Try again
            </Button>
            <Button variant="ghost" size="md" fullWidth onPress={onCart}>
              Back to cart
            </Button>
          </>
        );
    }
  }

  const quote = pricing.kind === 'priced' ? pricing.quote : null;
  const total = safeCents(quote?.total_cents);
  return (
    <>
      {placing ? (
        <Text accessibilityLiveRegion="polite" style={[small, { color: theme.color.text.secondary }]}>
          Placing your order… please keep the app open.
        </Text>
      ) : tipBlocked ? (
        <Text style={[body, { color: theme.color.text.primary }]}>
          Fix the tip amount or choose a preset.
        </Text>
      ) : null}
      <Button
        variant="primary"
        size="lg"
        fullWidth
        loading={placing || pricing.kind === 'pricing'}
        disabled={!quote || tipBlocked}
        onPress={onPlace}
        testID="Checkout-place"
        accessibilityLabel={total !== null ? undefined : 'Place order'}
      >
        {total !== null ? `Place order · ${formatTotal(total)}` : 'Place order'}
      </Button>
      <Text style={[small, { textAlign: 'center', color: theme.color.text.secondary }]}>
        Your card is authorised now and charged only when the restaurant accepts.
      </Text>
    </>
  );
}

function formatTotal(value: Cents): string {
  // Price's own formatter, so the label matches every other amount on screen.
  return formatPrice(value);
}
