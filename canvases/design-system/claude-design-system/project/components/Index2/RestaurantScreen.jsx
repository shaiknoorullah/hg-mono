/* Restaurant detail, the item sheet and the certificate viewer.
   - HalalCertificationPanel takes the API's CertificationPanel payload unchanged. onViewCertificate
     is passed only when certificate_viewable; it calls POST /v1/restaurants/{id}/certificate-url
     (presigned, <= 300 s).
   - Non-OPEN RestaurantAvailabilityState blocks add-to-cart and says why.
   - Section headings come from the menu's categories; OUT_OF_STOCK rows show out_of_stock_until. */
const { AppBar, IconButton, Card, Badge, Rating, HalalCertificationPanel, Icon, Price, Button, Sheet, RadioGroup, Checkbox, Input } = window.HalalGoesDesignSystem_d11a47;

const AVAIL_BANNER = {
  CLOSED_HOURS: { icon: 'clock', title: 'Closed now', body: 'Opens tomorrow at 11:00. You can look at the menu, but not order yet.' },
  PAUSED: { icon: 'clock', title: 'Not taking orders right now', body: 'The kitchen paused new orders until 19:20.' },
  OUT_OF_RANGE: { icon: 'map', title: 'Does not deliver to Home', body: '14 Ellesmere Rd is outside this restaurant\'s delivery area.', action: 'Change address', to: 'addresses' },
  NO_ADDRESS: { icon: 'map', title: 'Add a delivery address to order', body: 'We need an address to check delivery and show a price.', action: 'Add address', to: 'address-form' },
};

function MenuRow({ m, canOrder, onOpen }) {
  const oos = m.availability_state === 'OUT_OF_STOCK';
  const tappable = canOrder && !oos;
  return (
    <Card radius="lg" variant="outlined" onPress={tappable ? onOpen : undefined} accessibilityLabel={tappable ? m.name + ', ' + money(m.price_cents) : undefined} style={{ opacity: oos ? .7 : 1 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, display: 'grid', gap: 4 }}>
          <div style={{ fontSize: 'var(--type-heading-sm-size)', fontWeight: 600 }}>{m.name}</div>
          {m.description && <div style={{ fontSize: 'var(--type-body-sm-size)', color: 'var(--text-tertiary)', lineHeight: 'var(--type-body-sm-line)' }}>{m.description}</div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
            <Price cents={m.price_cents} />
            {m.dietary_tags.map(t => <Badge key={t} variant="neutral" size="sm">{DIETARY_LABEL[t]}</Badge>)}
            {oos && <Badge variant="neutral" size="sm" icon="clock">Out of stock · back at {m.out_of_stock_until}</Badge>}
          </div>
        </div>
        <Photo src={m.image_url} alt={m.name} height={72} radius="md" style={{ width: 72, flex: '0 0 auto' }} />
      </div>
    </Card>
  );
}

function RestaurantBody({ state, variant, go, onItem }) {
  /* The certification section follows the screen's baseline state: loading and error are its own. */
  const panelStatus = state === 'loading' ? 'loading' : state === 'error' ? 'error' : 'ready';
  const r = variant === 'expiring' ? R_KARAHI : R_ZAYTOUN;
  const avail = AVAIL_BANNER[variant];
  const canOrder = !avail;
  const panel = variant === 'expiring'
    ? { ...CERT_PANEL, display_state: 'EXPIRING_SOON', certifying_body_name: r.halal.certifying_body_name, certificate_number: 'ISNA-C-7731 (sample, transcribed)', issued_on: '2025-11-13', expires_on: '2026-11-12', certificate_viewable: false }
    : CERT_PANEL;
  return (
    <div style={{ paddingBottom: canOrder ? 88 : 16 }}>
      <div style={{ position: 'relative' }}>
        <Photo src={r.hero_image_url} alt={r.name} height={168} radius={0} />
        <div style={{ position: 'absolute', top: 12, left: 12 }}>
          <IconButton icon="back" accessibilityLabel="Back to Discover" variant="filled" shape="circle" onPress={() => go('home')} />
        </div>
      </div>
      <div style={{ padding: 'var(--space-4)', display: 'grid', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 'var(--type-heading-xl-size)', fontWeight: 700, letterSpacing: '-.01em' }}>{r.name}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', color: 'var(--text-tertiary)', fontSize: 'var(--type-body-sm-size)' }}>
          {r.rating_avg != null && <Rating value={r.rating_avg} count={r.rating_count} size="sm" />}
          <span>·</span><span>{r.cuisines.join(' · ')}</span><span>·</span><span>{r.price_band}</span>
          {canOrder && <><span>·</span><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="clock" size="sm" />{r.availability.eta_min_minutes}–{r.availability.eta_max_minutes} min</span></>}
        </div>
        <Halal halal={r.halal} restaurantId={r.id} size="lg" surface="detail" />
        {avail && (
          <GapBanner tone={variant === 'OUT_OF_RANGE' || variant === 'NO_ADDRESS' ? 'info' : 'neutral'} icon={avail.icon} title={avail.title}
            action={avail.action ? <Button size="sm" variant="secondary" onPress={() => go(avail.to)}>{avail.action}</Button> : null}>{avail.body}</GapBanner>
        )}
      </div>

      <div style={{ padding: '0 var(--space-4)', display: 'grid', gap: 10 }}>
        {panelStatus === 'ready'
          ? <HalalCertificationPanel restaurantId={r.id} certification={panel} headingLevel={2}
              onViewCertificate={panel.certificate_viewable ? () => go('certificate') : undefined}
              onReportConcern={() => {}} />
          : <HalalCertificationPanel restaurantId={r.id} status={panelStatus} onRetry={() => {}} />}
      </div>

      <div style={{ padding: 'var(--space-6) var(--space-4) 0', display: 'grid', gap: 12 }}>
        <Stateful state={state}
          loading={<GapSkeleton rows={3} height={80} />}
          empty={<GapEmptyState icon="orders" title="No menu yet" body="This restaurant has not published a menu. Check back later." />}
          error={<GapErrorState title="Couldn't load the menu" body="The restaurant details above are current." />}>
          {MENU.map(cat => (
            <section key={cat.id} style={{ display: 'grid', gap: 10 }}>
              <h2 style={{ margin: '4px 0 0', fontSize: 'var(--type-heading-lg-size)', fontWeight: 600, letterSpacing: '-.01em' }}>{cat.name}</h2>
              {cat.items.map(m => <MenuRow key={m.id} m={m} canOrder={canOrder} onOpen={() => onItem && onItem(m)} />)}
            </section>
          ))}
        </Stateful>
      </div>
    </div>
  );
}

function CartBar({ go }) {
  return (
    <div style={{ position: 'absolute', left: 12, right: 12, bottom: 12, zIndex: 'var(--z-sticky)' }}>
      <Button fullWidth size="lg" iconEnd="chevron-right" onPress={() => go('cart')}>
        View cart · {CART.item_count} items · {money(CART.indicative_subtotal_cents)}
      </Button>
    </div>
  );
}

function RestaurantScreen({ state, variant, go }) {
  const canOrder = !AVAIL_BANNER[variant];
  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <div style={{ height: '100%', overflowY: 'auto' }}>
        <RestaurantBody state={state} variant={variant} go={go} onItem={() => go('item')} />
      </div>
      {canOrder && state === 'populated' && <CartBar go={go} />}
    </div>
  );
}

/* Item sheet. Required variant group, add-on group with min/max, allergens ('not provided'
   when the list is empty, never 'no allergens'), special request, quantity, validation.
   Prices beside options are the API's price_cents / delta_cents; the Add button shows no
   computed total: the cart line total comes back from the server. */
function ItemSheet({ state, variant, go }) {
  const m = variant === 'no-allergens' ? { ...MENU[1].items[0], variant_groups: [], addon_groups: [] } : MENU[0].items[0];
  const invalid = variant === 'invalid';
  const [size, setSize] = React.useState(invalid ? null : 'v1');
  const [extras, setExtras] = React.useState(invalid ? ['a1', 'a2', 'a3'] : ['a1']);
  const [qty, setQty] = React.useState(1);
  const vg = m.variant_groups[0], ag = m.addon_groups[0];
  const content = (
    <div style={{ display: 'grid', gap: 14 }}>
      {m.description && <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--type-body-md-size)' }}>{m.description}</p>}
      <div style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: 'var(--type-label-md-size)', fontWeight: 600, color: 'var(--text-secondary)' }}>Allergens</span>
        {m.allergen_tags.length
          ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{m.allergen_tags.map(t => <Badge key={t} variant="warning" size="sm">{ALLERGEN_LABEL[t]}</Badge>)}</div>
          : <Muted>Not provided by the restaurant. Ask them before ordering if you have an allergy.</Muted>}
      </div>
      {vg && (
        <RadioGroup label={vg.name + ' (required)'} value={size} onValueChange={setSize} required
          error={invalid ? 'Choose a size to continue.' : null}
          options={vg.variants.map(v => ({ value: v.id, label: v.name, disabled: !v.is_available,
            /* ABSOLUTE variants show the API's price; DELTA variants show the API's delta. No sums. */
            description: v.pricing_mode === 'ABSOLUTE' ? <Price cents={v.price_cents} size="sm" /> : undefined,
            priceDeltaCents: v.pricing_mode === 'ABSOLUTE' ? undefined : v.delta_cents }))} />
      )}
      {ag && (
        <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
          <legend style={{ fontSize: 'var(--type-label-lg-size)', fontWeight: 600, marginBottom: 4 }}>{ag.name} <Muted style={{ display: 'inline' }}>· choose up to {ag.max_select}</Muted></legend>
          {ag.addons.map((a, i) => <Checkbox key={a.id} label={a.name} priceDeltaCents={a.price_cents}
            disabled={!a.is_available && !invalid} disabledReason={a.is_available ? undefined : 'Out of stock'}
            checked={extras.includes(a.id)} onCheckedChange={() => setExtras(x => x.includes(a.id) ? x.filter(y => y !== a.id) : [...x, a.id])}
            error={invalid && i === ag.addons.length - 1 ? 'Choose at most ' + ag.max_select + ' extras.' : undefined} />)}
        </fieldset>
      )}
      <Input label="Special request" placeholder="e.g. no onions" helperText="The kitchen sees this. Not for allergy guarantees." maxLength={140} characterCount />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, borderTop: '1px solid var(--border-decorative)' }}>
        <span style={{ fontSize: 'var(--type-label-lg-size)', fontWeight: 600 }}>Quantity</span>
        <GapStepper value={qty} onChange={setQty} />
      </div>
    </div>
  );
  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <div style={{ height: '100%', overflow: 'hidden' }}><RestaurantBody state="populated" variant="OPEN" go={go} /></div>
      <Sheet open contained title={m.name} onClose={() => go('restaurant')} maxHeight="88%"
        footer={state === 'populated' ? <Button fullWidth size="lg" disabled={invalid}>Add to cart</Button> : null}>
        <Stateful state={state} loading={<GapSkeleton rows={2} height={60} />}
          error={<GapErrorState title="Couldn't add this item" body="It may have just sold out. The menu has been refreshed." retry="Back to menu" onRetry={() => go('restaurant')} />}>
          {content}
        </Stateful>
      </Sheet>
    </div>
  );
}

/* Certificate viewer: the presigned URL is short-lived (<= 300 s). */
function CertificateScreen({ state, variant, go }) {
  const header = <AppBar tone="cream" onBack={() => go('restaurant')} backLabel="Back to Zaytoun Grill" title="Halal certificate" subtitle={CERT_PANEL.certifying_body_name} />;
  let body;
  if (variant === 'expired-url') {
    body = <GapErrorState title="This view has expired" body="For privacy, certificate links last five minutes. Open it again to get a fresh one." retry="Open again" />;
  } else if (variant === 'not-viewable') {
    body = <GapEmptyState icon="lock" title="Certificate not available to view" body="HalalGoes checked this certificate; the restaurant has not made the image public. The details on the listing are what we verified." action="Back to restaurant" onAction={() => go('restaurant')} />;
  } else {
    body = (
      <Stateful state={state} loading={<div style={{ display: 'grid', gap: 10 }}><GapSkeleton rows={1} height={420} /><Muted style={{ textAlign: 'center' }}>Getting a secure link…</Muted></div>}
        error={<GapErrorState title="Couldn't open the certificate" body="Try again. The listing's verified details are unchanged." />}>
        <div style={{ display: 'grid', gap: 12 }}>
          <Gap name="DocumentViewer" style={{ height: 440, display: 'grid', placeItems: 'center', background: 'var(--surface-raised)', border: '1px solid var(--border-decorative)', borderRadius: 'var(--radius-lg)', color: 'var(--text-tertiary)' }}>
            <span style={{ display: 'grid', justifyItems: 'center', gap: 8, fontSize: 'var(--type-body-sm-size)' }}>Certificate image (presigned URL)</span>
          </Gap>
          <Muted>Link expires in 4:52. {CERT_PANEL.disclaimer}</Muted>
        </div>
      </Stateful>
    );
  }
  return <Screen header={header}>{body}</Screen>;
}

Object.assign(window, { RestaurantScreen, ItemSheet, CertificateScreen });
