/* Discover (GET /v1/feed -> FeedSection[]) and Search (GET /v1/search).
   A card shows RestaurantCard fields only: name, image, cuisines, rating_avg/rating_count,
   price_band, halal, availability (state + server ETA window). No per-card fee or promo:
   the contract's fee on the card is indicative only, and there is no promo field. */
const { AppBar, IconButton, Card, Badge, Rating, Icon, Input, Button, Price } = window.HalalGoesDesignSystem_d11a47;

function RestaurantCard({ r, onOpen }) {
  const a = r.availability;
  const open = a.state === 'OPEN';
  return (
    <Card padding="0" radius="lg" onPress={onOpen} accessibilityLabel={r.name + (open ? '' : ', not taking orders')} style={{ opacity: open ? 1 : .85 }}>
      <Photo src={r.hero_image_url} alt={r.name} height={128} radius="lg" style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }} />
      <div style={{ padding: 'var(--space-4)', display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 'var(--type-heading-md-size)', fontWeight: 600, letterSpacing: '-.01em' }}>{r.name}</h3>
          <Rating value={r.rating_avg} count={r.rating_count} size="sm" />
        </div>
        <Halal halal={r.halal} restaurantId={r.id} size="md" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', color: 'var(--text-tertiary)', fontSize: 'var(--type-body-sm-size)' }}>
          <span>{r.cuisines.join(' · ')}</span><span>·</span><span>{r.price_band}</span><span>·</span>
          {open
            ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="clock" size="sm" />{a.eta_min_minutes}–{a.eta_max_minutes} min</span>
            : <Badge variant="neutral" size="sm" icon="clock">{a.state === 'CLOSED_HOURS' ? 'Closed · opens ' + a.opens_at : 'Not taking orders'}</Badge>}
        </div>
      </div>
    </Card>
  );
}

function HomeScreen({ state, variant, go }) {
  const noAddress = variant === 'no-address';
  const header = (
    <AppBar tone="cream" title={<GapWordmark size={20} />}
      subtitle={noAddress ? 'No delivery address yet' : 'Deliver to · ' + ADDRESSES[0].label + ', ' + ADDRESSES[0].line1}
      actions={<IconButton icon="cart" accessibilityLabel="Cart" badge={CART.item_count} badgeNoun="items" onPress={() => go('cart')} />} />
  );
  return (
    <Screen header={header} footer={<Tabs value="home" go={go} />}>
      <div style={{ display: 'grid', gap: 14 }}>
        <div onClick={() => go('search')}><Input label="Search" variant="search" placeholder="Restaurants or dishes" readOnly /></div>
        {/* K-19: a link to the seven checks, not a halal-tinted claim banner */}
        <Card radius="md" variant="outlined" padding="12px" onPress={() => {}} accessibilityLabel="How we verify: each listing names its certifier and the date we checked it">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 'var(--type-body-sm-size)', color: 'var(--text-secondary)' }}>
            <Icon name="info" size="md" color="var(--text-tertiary)" />
            <span style={{ flex: 1 }}>Each listing names its certifier and the date we checked it.</span>
            <span style={{ color: 'var(--text-link)', fontWeight: 600, whiteSpace: 'nowrap' }}>How we verify</span>
          </div>
        </Card>
        {noAddress && state === 'populated' && (
          <GapBanner tone="info" icon="map" title="Add a delivery address" action={<Button size="sm" variant="secondary" onPress={() => go('address-form')}>Add</Button>}>
            Restaurants show what they can deliver to you once we know where you are.
          </GapBanner>
        )}
        <Stateful state={state}
          loading={<GapSkeleton rows={3} media />}
          empty={<GapEmptyState icon="map" title="No verified restaurants deliver here yet"
            body="We are launching in Ontario one area at a time. Try another saved address." action="Change address" onAction={() => go('addresses')} />}
          error={<GapErrorState title="Couldn't load restaurants" body="Check your connection. Nothing is wrong with your account." />}>
          {FEED.map(sec => (
            <section key={sec.key} style={{ display: 'grid', gap: 12 }}>
              <H2 style={{ margin: '6px 0 0' }}>{sec.title}</H2>
              {sec.restaurants.map(r => <RestaurantCard key={r.id} r={r} onOpen={() => go('restaurant')} />)}
            </section>
          ))}
          <Muted style={{ textAlign: 'center', padding: '4px 0 8px' }}>Bait Al Mandi's payload has no halal field in this sample, so no badge renders.</Muted>
        </Stateful>
      </div>
    </Screen>
  );
}

function SearchScreen({ state, variant, go }) {
  const q = state === 'empty' ? '' : variant === 'none' ? 'sushi' : 'shawarma';
  const header = (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px var(--space-4)' }}>
      <IconButton icon="back" accessibilityLabel="Back to Discover" onPress={() => go('home')} />
      <div style={{ flex: 1 }}><Input label="Search" variant="search" value={q} onChange={() => {}} placeholder="Restaurants or dishes"
        suffix={q ? <IconButton icon="close" accessibilityLabel="Clear search" size="sm" /> : null} /></div>
    </div>
  );
  return (
    <Screen header={header} footer={<Tabs value="home" go={go} />}>
      <Stateful state={state}
        loading={<GapSkeleton rows={3} height={56} />}
        empty={<GapEmptyState icon="search" title="Search verified restaurants" body="Type a restaurant, a dish or a cuisine." />}
        error={<GapErrorState title="Search is unavailable" body="Try again in a moment." />}>
        {variant === 'none'
          ? <GapEmptyState icon="search" title={'No results for “' + q + '”'} body="Only verified restaurants appear here. Try a dish name or a cuisine." action="Clear search" />
          : (
            <div>
              <Muted style={{ marginBottom: 6 }}>2 restaurants</Muted>
              {[R_ZAYTOUN, R_NOHALAL].map(r => (
                <GapListRow key={r.id} title={r.name} onClick={() => go('restaurant')}
                  sub={r.cuisines.join(' · ') + ' · ' + r.availability.eta_min_minutes + '–' + r.availability.eta_max_minutes + ' min'}
                  right={<Halal halal={r.halal} restaurantId={r.id} size="sm" />} />
              ))}
              <Muted style={{ margin: '14px 0 6px' }}>Dishes</Muted>
              <GapListRow title="Chicken shawarma wrap" sub="Zaytoun Grill" right={<Price cents={1249} size="sm" />} onClick={() => go('restaurant')} />
            </div>
          )}
      </Stateful>
    </Screen>
  );
}
Object.assign(window, { HomeScreen, SearchScreen, RestaurantCard });
