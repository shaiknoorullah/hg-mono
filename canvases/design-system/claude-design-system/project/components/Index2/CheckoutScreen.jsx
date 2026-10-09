/* Cart (GET /v1/cart) and Checkout (POST /v1/quotes).
   Invariant 1: every amount on these screens is a field the server returned. The client
   sends item ids + tip_cents; it never sums, taxes or tips anything itself.
   Tax: rendered only from quote.tax_lines[] (label = statutory_label). While O-01 (HST
   registration) is open the server returns no tax lines, so none render. */
const { AppBar, Card, Button, Price, Icon, RadioGroup, Badge, Sheet, Input, IconButton } = window.HalalGoesDesignSystem_d11a47;

function CartScreen({ state, variant, go }) {
  const cart = variant === 'unavailable' ? CART_UNAVAILABLE : CART;
  const header = <AppBar tone="cream" onBack={() => go('restaurant')} backLabel={'Back to ' + cart.restaurant.name} title="Your cart" subtitle={cart.restaurant.name} />;
  const footer = state === 'populated' ? (
    <div style={{ padding: 'var(--space-4)', background: 'var(--surface-raised)', boxShadow: 'var(--elev-sticky)', display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--type-body-md-size)' }}>
        <span style={{ color: 'var(--text-secondary)' }}>Items (estimate)</span><Price cents={cart.indicative_subtotal_cents} />
      </div>
      <Muted>Delivery fee and any tax are priced at checkout for your address.</Muted>
      <Button fullWidth size="lg" disabled={!cart.is_quotable} onPress={() => go('checkout')}>Go to checkout</Button>
    </div>
  ) : null;
  return (
    <Screen header={header} footer={footer}>
      <Stateful state={state}
        loading={<GapSkeleton rows={2} height={64} />}
        empty={<GapEmptyState icon="cart" title="Your cart is empty" body="Add dishes from a verified restaurant to start an order." action="Discover restaurants" onAction={() => go('home')} />}
        error={<GapErrorState title="Couldn't load your cart" body="Your items are saved. Try again." />}>
        <div style={{ display: 'grid', gap: 12 }}>
          {!cart.is_quotable && <GapBanner tone="warning" title="Something in your cart changed">Remove the unavailable item to continue.</GapBanner>}
          <Card radius="lg" variant="outlined">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><Halal halal={cart.restaurant.halal} restaurantId={cart.restaurant.id} /></div>
            {cart.lines.map(l => (
              <div key={l.id} style={{ display: 'grid', gap: 6, padding: '10px 0', borderTop: '1px solid var(--border-decorative)', opacity: l.availability.is_available ? 1 : .7 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                  <span style={{ flex: 1, fontSize: 'var(--type-body-md-size)', fontWeight: 500 }}>{l.name}</span>
                  <Price cents={l.line_total_cents} size="sm" />
                </div>
                {(l.variant || l.addons.length > 0 || l.special_request) && (
                  <Muted>{[l.variant && l.variant.name, ...l.addons.map(a => a.name), l.special_request && '“' + l.special_request + '”'].filter(Boolean).join(' · ')}</Muted>
                )}
                {l.availability.is_available
                  ? <GapStepper value={l.quantity} onChange={() => {}} />
                  : <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Badge variant="neutral" size="sm">Out of stock</Badge><Button size="sm" variant="ghost" iconStart="close" accessibilityLabel={'Remove ' + l.name}>Remove</Button></div>}
              </div>
            ))}
          </Card>
        </div>
      </Stateful>
    </Screen>
  );
}

/* Quote lines, in the fixed P-10 order, straight from the Quote. Zero discount / service fee lines are not drawn. */
function QuoteLines({ q }) {
  const rows = [
    ['Items', q.subtotal_cents],
    q.discount_items_cents ? ['Discount', -q.discount_items_cents] : null,
    ['Delivery', q.delivery_fee_cents],
    q.service_fee_cents ? ['Service fee', q.service_fee_cents] : null,
    ...q.tax_lines.map(t => [t.statutory_label, t.amount_cents]),
    ['Tip · 100% to your rider', q.tip_cents],
  ].filter(Boolean);
  return (
    <>
      {rows.map(([l, v]) => (
        <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 'var(--type-body-md-size)', color: 'var(--text-secondary)' }}>
          <span>{l}</span><Price cents={v} size="sm" />
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 10, marginTop: 6, borderTop: '1px solid var(--border-decorative)' }}>
        <span style={{ fontSize: 'var(--type-heading-md-size)', fontWeight: 700 }}>Total</span>
        <Price cents={q.total_cents} size="lg" />
      </div>
    </>
  );
}

const PAY_VARIANTS = {
  ready: { q: QUOTE }, taxed: { q: QUOTE_TAXED }, expired: { q: QUOTE, expired: true }, requoting: { q: QUOTE, requoting: true },
  action: { q: QUOTE, pay: 'REQUIRES_ACTION' }, declined: { q: QUOTE, pay: 'FAILED' }, nocard: { q: QUOTE, nocard: true }, address: { q: QUOTE, picker: true },
};

function CheckoutScreen({ state, variant, go }) {
  const v = PAY_VARIANTS[variant] || PAY_VARIANTS.ready;
  const q = v.q;
  const [tip, setTip] = React.useState('15');
  const [addr, setAddr] = React.useState(ADDRESSES[0].id);
  const a = ADDRESSES.find(x => x.id === addr);
  const card = PAYMENT_METHODS[0];
  const blocked = v.expired || v.requoting || v.nocard || v.pay === 'FAILED';
  const header = <AppBar tone="cream" onBack={() => go('cart')} backLabel="Back to cart" title="Checkout" subtitle={CART.restaurant.name} />;
  const footer = state === 'populated' ? (
    <div style={{ padding: 'var(--space-4)', background: 'var(--surface-raised)', boxShadow: 'var(--elev-sticky)', display: 'grid', gap: 6 }}>
      {v.pay === 'REQUIRES_ACTION'
        ? <Button fullWidth size="lg" iconStart="lock">Confirm with your bank</Button>
        : <Button fullWidth size="lg" iconStart="lock" disabled={blocked} loading={!!v.requoting} onPress={() => go('tracking')}>Place order · {money(q.total_cents)}</Button>}
      <Muted style={{ textAlign: 'center' }}>Your card is authorised now and charged only when the restaurant accepts.</Muted>
    </div>
  ) : null;
  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <Screen header={header} footer={footer}>
        <Stateful state={state}
          loading={<div style={{ display: 'grid', gap: 10 }}><Muted>Pricing your order for this address…</Muted><GapSkeleton rows={3} height={64} /></div>}
          error={<GapErrorState title="We couldn't price this order" body="Nothing has been charged. Try again, or change the address." exit="Change address" />}>
          <div style={{ display: 'grid', gap: 12 }}>
            {v.expired && <GapBanner tone="warning" icon="clock" title="Price hold expired at 18:57" action={<Button size="sm" variant="secondary" iconStart="refresh">Refresh</Button>}>Refresh to get the current price before you order.</GapBanner>}
            {v.pay === 'REQUIRES_ACTION' && <GapBanner tone="info" icon="lock" title="Your bank needs to confirm this payment">You'll see a secure 3-D Secure check from your bank. Nothing is charged until the restaurant accepts.</GapBanner>}
            {v.pay === 'FAILED' && <GapBanner tone="danger" icon="error" title="Card declined">Your bank declined Visa •••• 4242. Choose another card or add a new one.</GapBanner>}

            <Card radius="lg" variant="outlined">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <Halal halal={CART.restaurant.halal} restaurantId={CART.restaurant.id} />
              </div>
              {CART.lines.map(l => (
                <div key={l.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '8px 0', borderTop: '1px solid var(--border-decorative)' }}>
                  <span style={{ fontVariantNumeric: 'var(--numeric-tabular)', color: 'var(--text-tertiary)', fontSize: 'var(--type-body-sm-size)', width: 22 }}>{l.quantity}×</span>
                  <span style={{ flex: 1, fontSize: 'var(--type-body-md-size)' }}>{l.name}</span>
                  <Price cents={l.line_total_cents} size="sm" />
                </div>
              ))}
            </Card>

            <Card radius="lg" variant="outlined" padding="0 var(--space-4)">
              <GapListRow icon="map" title={a.label + ' · ' + a.line1} sub={[a.unit && 'Unit ' + a.unit, a.buzzer && 'Buzz ' + a.buzzer, a.delivery_notes].filter(Boolean).join(' · ') || a.city}
                onClick={() => go('checkout', 'address')} style={{ borderTop: 'none' }} />
              {v.nocard
                ? <GapListRow icon="plus" title="Add a payment method" sub="Cards are saved with Stripe; HalalGoes never sees the number." onClick={() => {}} />
                : <GapListRow icon="lock" title={card.brand + ' •••• ' + card.last4} sub={'Expires ' + String(card.exp_month).padStart(2, '0') + '/' + String(card.exp_year).slice(2)}
                    right={v.pay === 'FAILED' ? <Badge variant="warning" size="sm">Declined</Badge> : null} onClick={() => {}} />}
            </Card>

            <Card radius="lg" variant="outlined">
              {/* The presets only PICK the tip: the choice is sent as tip_cents and the server re-quotes. */}
              <RadioGroup label="Tip your rider" orientation="horizontal" value={tip} onValueChange={setTip}
                options={[{ value: '10', label: '10%' }, { value: '15', label: '15%' }, { value: '20', label: '20%' }, { value: 'custom', label: 'Other' }]} />
              <Muted style={{ marginTop: 4 }}>100% goes to your rider. Changing it re-prices the order.</Muted>
              {tip === 'custom' && <Input label="Tip amount" variant="numeric" placeholder="0.00" prefix="$" />}
            </Card>

            <Card radius="lg" variant="outlined" style={{ opacity: v.requoting ? .55 : 1 }}>
              <QuoteLines q={q} />
              <Muted style={{ marginTop: 8 }}>{v.requoting ? 'Updating the price…' : 'Price held until ' + q.expires_at + '. The amount shown is the amount charged.'}</Muted>
            </Card>
            <Muted>Order updates arrive as app notifications. Manage them in Profile.</Muted>
          </div>
        </Stateful>
      </Screen>

      {v.picker && state === 'populated' && (
        <Sheet open contained title="Deliver to" onClose={() => go('checkout')} footer={<Button fullWidth variant="tertiary" iconStart="plus" onPress={() => go('address-form')}>Add a new address</Button>}>
          <RadioGroup label="Saved addresses" hideLabel value={addr} onValueChange={setAddr}
            options={ADDRESSES.map(x => ({ value: x.id, label: x.label + ' · ' + x.line1, description: x.city + ' ' + x.postal_code }))} />
          <Muted style={{ marginTop: 8 }}>Changing the address re-prices delivery.</Muted>
        </Sheet>
      )}
    </div>
  );
}
Object.assign(window, { CartScreen, CheckoutScreen });
