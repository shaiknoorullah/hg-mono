/**
 * Tier 3 — content and data display. Seven components, all fed from
 * `contracts/fixtures/`.
 */
import { useState } from 'react';
import { cents } from '@hg/api-client';
import {
  Button,
  Card,
  MenuItemCard,
  OrderCard,
  Price,
  QuantityStepper,
  Rating,
  RestaurantCard,
  StatusTimeline,
  type CardVariant,
} from '@hg/ui-web';

import {
  ComponentBlock,
  Note,
  Row,
  Section,
  Specimen,
  SpecimenGrid,
  Stack,
} from '../gallery/kit';
import {
  availability,
  catalogueFixtures,
  cite,
  copy,
  menuItems,
  orderFixtures,
  orders,
  restaurantCards,
  restaurantCardsLongNames,
  transitionsFor,
} from '../lib/fixtures';

const CARD_VARIANTS: readonly CardVariant[] = ['elevated', 'outlined', 'filled', 'interactive'];

const AVAILABILITY_ORDER = ['OPEN', 'CLOSED_HOURS', 'PAUSED', 'OUT_OF_RANGE', 'NO_ADDRESS'] as const;

export function ContentSection() {
  const [quantity, setQuantity] = useState(2);
  const [rating, setRating] = useState(4);

  const firstRestaurant = restaurantCards[0]!;
  const expiredRestaurant = withHalalState(firstRestaurant, 'EXPIRED');
  const unverifiedRestaurant = withHalalState(firstRestaurant, 'UNVERIFIED');

  return (
    <Section
      id="content"
      title="Tier 3 — Content"
      blurb="Cards, money, ratings and quantities. Every card here renders the halal seal through HalalBadge rather than its own markup, so the four states have exactly one implementation in the system."
      source="packages/ui-web/src/content/"
    >
      <Note>
        Fixture images point at <code>cdn.halalgoes.ca</code>, which does not resolve with no
        backend running, so every hero and thumbnail below is an <strong>empty plate</strong> —
        which is exactly what the components document as the failed-load behaviour (“every image
        sits on a plate, so a failed load is an empty plate, not a collapse”). The layout you see
        is the real layout.
      </Note>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="Card"
        purpose="The generic surface everything else composes from. An interactive card is one tab stop with one accessible name — nested links inside a pressable card are forbidden."
        declaredStates={['elevated', 'outlined', 'filled', 'interactive (hover / pressed / focus-visible)']}
        notes={
          <>
            In dark mode, elevation is not a shadow: the theme resolves it to a surface step plus
            a hairline. Flip the scheme control and watch the <code>elevated</code> card change
            technique rather than colour.
          </>
        }
      >
        <SpecimenGrid min="18rem">
          {CARD_VARIANTS.map((variant) => (
            <Specimen key={variant} label={variant}>
              <Card
                variant={variant}
                {...(variant === 'interactive'
                  ? { onPress: () => undefined, accessibilityLabel: 'Interactive card specimen' }
                  : {})}
                header={<p className="text-heading-sm text-fg-primary">Karachi Kitchen</p>}
                footer={<p className="text-caption text-fg-tertiary">Radius md · density padding</p>}
              >
                <p className="text-body-md text-fg-secondary">
                  Cards take their padding from <code>density.cardPadding</code>. Change the
                  density control and this box changes with it.
                </p>
              </Card>
            </Specimen>
          ))}
          <Specimen label="Radii — md · lg · xl">
            <Stack>
              {(['md', 'lg', 'xl'] as const).map((radius) => (
                <Card key={radius} variant="outlined" radius={radius}>
                  <p className="text-body-sm text-fg-secondary">radius {radius}</p>
                </Card>
              ))}
            </Stack>
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="Price"
        purpose="The only component in the system permitted to render money. It takes the branded Cents from @hg/api-client, so lint L-5 (“no float money”) is discharged by the type system rather than by review."
        declaredStates={['static', 'loading', 'zero → free label', 'strikethrough', 'signed', 'with currency code']}
        notes={
          <>
            <code>&lt;Price cents={'{'}1250{'}'} /&gt;</code> is a type error — a bare number is
            not money, and a float certainly is not. The only two ways to obtain a{' '}
            <code>Cents</code> are “it came from the server” and “it passed an integer check”.
            Rounding never happens here; the division by 100 occurs exactly once, at the last step
            before rendering.
          </>
        }
      >
        <SpecimenGrid min="18rem">
          <Specimen label="Sizes — sm · md · lg · xl" fixture={cite(catalogueFixtures.menuItemAvailable)}>
            <Row gap="1.5rem" align="baseline">
              <Price cents={cents(menuItems.available.price_cents)} size="sm" />
              <Price cents={cents(menuItems.available.price_cents)} size="md" />
              <Price cents={cents(menuItems.available.price_cents)} size="lg" />
              <Price cents={cents(menuItems.available.price_cents)} size="xl" />
            </Row>
          </Specimen>
          <Specimen
            label="Was / now"
            caption="strikethrough implies “was”; announceAs='now' on the live price beside it makes the pair read as a comparison rather than as two unrelated amounts."
          >
            <Row align="baseline">
              <Price cents={cents(2195)} strikethrough size="md" />
              <Price cents={cents(1695)} announceAs="now" size="lg" />
            </Row>
          </Specimen>
          <Specimen label="Zero → a real label, never a blank">
            <Row align="baseline">
              <Price cents={cents(0)} free="Free delivery" />
              <Price cents={cents(0)} />
            </Row>
          </Specimen>
          <Specimen label="Signed — ledger and earnings deltas">
            <Row align="baseline">
              <Price cents={cents(1250)} sign="always" />
              <Price cents={cents(-450)} sign="auto" />
              <Price cents={cents(450)} sign="never" />
            </Row>
          </Specimen>
          <Specimen label="With currency code" caption="Required on receipts and refund records.">
            <Price cents={cents(orders.customerPreparing.money.total_cents)} showCode size="lg" />
          </Specimen>
          <Specimen
            label="Loading"
            forced
            caption="A skeleton at the exact glyph width, so a total does not jump while a quote refreshes."
          >
            <Price cents={cents(10684)} loading size="lg" />
          </Specimen>
          <Specimen label="A real order’s money" fixture={cite(orderFixtures.customerPreparing)}>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
              {(
                [
                  ['Subtotal', orders.customerPreparing.money.subtotal_cents],
                  ['Delivery', orders.customerPreparing.money.delivery_fee_cents],
                  ['Service', orders.customerPreparing.money.service_fee_cents],
                  ['HST', orders.customerPreparing.money.tax_total_cents],
                  ['Tip', orders.customerPreparing.money.tip_cents],
                  ['Total', orders.customerPreparing.money.total_cents],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-label-md text-fg-secondary">{label}</dt>
                  <dd className="text-end">
                    <Price cents={cents(value)} size={label === 'Total' ? 'lg' : 'md'} />
                  </dd>
                </div>
              ))}
            </dl>
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="Rating"
        purpose="A restaurant score. null is a legitimate value — the server withholds the average below five reviews rather than publishing a number it does not trust."
        declaredStates={['display', 'stars', 'input', 'withheld (null)', 'no count']}
      >
        <SpecimenGrid min="18rem">
          <Specimen label="display — the default" fixture={cite(catalogueFixtures.restaurantList)}>
            <Stack>
              <Rating value={firstRestaurant.rating_avg} count={firstRestaurant.rating_count} size="sm" />
              <Rating value={firstRestaurant.rating_avg} count={firstRestaurant.rating_count} size="md" />
              <Rating value={firstRestaurant.rating_avg} count={firstRestaurant.rating_count} size="lg" />
            </Stack>
          </Specimen>
          <Specimen label="stars">
            <Rating variant="stars" value={4.6} count={1183} />
          </Specimen>
          <Specimen label="Withheld" forced caption="value={null} — fewer than five reviews. It says so; it does not render zero stars.">
            <Rating value={null} count={2} />
          </Specimen>
          <Specimen label="input — a radiogroup under the hood">
            <Rating variant="input" value={rating} onChange={setRating} label="Rate this order" />
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="QuantityStepper"
        purpose="Cart quantity. Server-authoritative: the value freezes while a mutation is in flight, because an optimistic stepper that reverts is worse than a 200 ms wait."
        declaredStates={['default', 'at min bound', 'at max bound', 'removeAtZero', 'loading', 'disabled']}
      >
        <SpecimenGrid min="18rem">
          <Specimen label="Default">
            <QuantityStepper value={quantity} onChange={setQuantity} itemName="Chicken Biryani" />
          </Specimen>
          <Specimen label="Sizes">
            <Row>
              <QuantityStepper value={1} size="sm" onChange={() => undefined} />
              <QuantityStepper value={1} size="md" onChange={() => undefined} />
              <QuantityStepper value={1} size="lg" onChange={() => undefined} />
            </Row>
          </Specimen>
          <Specimen
            label="At the maximum, with the reason"
            forced
            caption="A disabled bound that will not say why teaches people the system is arbitrary."
          >
            <QuantityStepper
              value={10}
              max={10}
              maxReason="Maximum 10 per order"
              onChange={() => undefined}
              itemName="Chicken Biryani"
            />
          </Specimen>
          <Specimen
            label="removeAtZero"
            forced
            caption="At 1 the decrement becomes “Remove Chicken Biryani” and announces as such."
          >
            <QuantityStepper
              value={1}
              removeAtZero
              itemName="Chicken Biryani"
              onChange={() => undefined}
            />
          </Specimen>
          <Specimen label="Loading and disabled" forced>
            <Row>
              <QuantityStepper value={2} loading onChange={() => undefined} />
              <QuantityStepper value={2} disabled onChange={() => undefined} />
            </Row>
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="RestaurantCard"
        purpose="The feed unit. The seal sits above the name and is the highest-contrast element on the card — on a catalogue where every listing is certified, the badge’s job is to prove the platform’s single claim on every impression, not to differentiate listings from each other."
        declaredStates={[
          'feed / compact / carousel',
          'OPEN',
          'CLOSED_HOURS',
          'PAUSED',
          'OUT_OF_RANGE',
          'NO_ADDRESS',
          'loading',
          'halal EXPIRED / UNVERIFIED',
        ]}
      >
        <Specimen label="Three variants" wide fixture={cite(catalogueFixtures.restaurantList)}>
          <Row align="start" gap="1.5rem">
            <div className="w-72">
              <RestaurantCard restaurant={firstRestaurant} variant="feed" onPress={() => undefined} />
            </div>
            <div className="w-80">
              <RestaurantCard
                restaurant={restaurantCards[1]!}
                variant="compact"
                onPress={() => undefined}
              />
            </div>
            <RestaurantCard restaurant={restaurantCards[2]!} variant="carousel" onPress={() => undefined} />
          </Row>
        </Specimen>

        <Specimen
          label="Five availability states"
          wide
          fixture="contracts/fixtures/catalogue/restaurant_availability_*.json"
          caption="Availability is the server-computed C-14 object; the client never recomputes opening hours. A closed restaurant’s card stays pressable — browsing a closed menu is legitimate — and it is the add controls inside that disable."
        >
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(17rem, 100%), 1fr))' }}>
            {AVAILABILITY_ORDER.map((state) => (
              <Stack key={state} gap="0.5rem">
                <code className="font-mono text-mono-sm text-fg-tertiary">{state}</code>
                <RestaurantCard
                  restaurant={firstRestaurant}
                  availability={availability[state]}
                  onPress={() => undefined}
                />
              </Stack>
            ))}
          </div>
        </Specimen>

        <SpecimenGrid min="19rem">
          <Specimen
            label="Halal EXPIRED"
            forced
            caption="Derived from the fixture by setting halal.display_state — the seal is the card’s only change, and it is cool slate with an outline shield. No red."
          >
            <RestaurantCard restaurant={expiredRestaurant} onPress={() => undefined} />
          </Specimen>
          <Specimen
            label="Halal UNVERIFIED"
            forced
            caption="On a customer card the seal renders nothing at all — an uncertified kitchen is invisible, not de-emphasised."
          >
            <RestaurantCard restaurant={unverifiedRestaurant} onPress={() => undefined} />
          </Specimen>
          <Specimen label="Loading" forced caption="Skeleton in the exact card geometry, seal slot reserved.">
            <RestaurantCard restaurant={firstRestaurant} loading />
          </Specimen>
          <Specimen
            label="Favourite"
            caption="A separate IconButton with its own label and its own hit area, positioned so it does not overlap the card’s target."
          >
            <RestaurantCard
              restaurant={firstRestaurant}
              onPress={() => undefined}
              onFavourite={() => undefined}
              isFavourite
            />
          </Specimen>
          <Specimen
            label="A very long name"
            fixture={cite(catalogueFixtures.restaurantListLongNames)}
            caption="Clamped to two lines. The halal label never truncates — it is the one string on the card that must be read in full."
          >
            <RestaurantCard restaurant={restaurantCardsLongNames[0]!} onPress={() => undefined} />
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="MenuItemCard"
        purpose="A row in a restaurant menu. An empty allergen list renders “Allergen information not provided”, never “No allergens” — the difference is a medical one."
        declaredStates={['row', 'grid', 'default', 'highlighted', 'unavailable', 'in cart', 'loading', 'quantity loading', 'disabled']}
      >
        <SpecimenGrid min="22rem">
          <Specimen label="row — available" fixture={cite(catalogueFixtures.menuItemAvailable)}>
            <MenuItemCard item={menuItems.available} onAdd={() => undefined} />
          </Specimen>
          <Specimen label="grid" fixture={cite(catalogueFixtures.menuItemAvailable)}>
            <MenuItemCard item={menuItems.available} variant="grid" onAdd={() => undefined} />
          </Specimen>
          <Specimen
            label="In the cart"
            caption="The add button becomes a QuantityStepper once the line exists."
          >
            <MenuItemCard
              item={menuItems.available}
              quantityInCart={quantity}
              onChangeQuantity={setQuantity}
            />
          </Specimen>
          <Specimen
            label="highlighted"
            forced
            caption="C-13 R3 — the in-menu search result washes briefly and scrolls to. It must not open an alert."
          >
            <MenuItemCard item={menuItems.available} highlighted onAdd={() => undefined} />
          </Specimen>
          <Specimen
            label="Out of stock"
            fixture={cite(catalogueFixtures.menuItemOutOfStock)}
            caption="At V1 unavailable items are omitted from the customer menu, not greyed — this state exists for the restaurant-side editor."
          >
            <MenuItemCard
              item={menuItems.outOfStock}
              disabled
              disabledReason="Out of stock until 22:42"
            />
          </Specimen>
          <Specimen label="Variants and add-ons" fixture={cite(catalogueFixtures.menuItemVariants)}>
            <MenuItemCard item={menuItems.variants} onAdd={() => undefined} onPress={() => undefined} />
          </Specimen>
          <Specimen label="Long name, no image" fixture={cite(catalogueFixtures.menuItemLongName)}>
            <MenuItemCard item={menuItems.longName} onAdd={() => undefined} />
          </Specimen>
          <Specimen label="Loading and quantity-loading" forced>
            <Stack>
              <MenuItemCard item={menuItems.available} loading />
              <MenuItemCard item={menuItems.available} quantityInCart={2} quantityLoading />
            </Stack>
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>

      {/* ---------------------------------------------------------------- */}
      <ComponentBlock
        name="OrderCard"
        purpose="One order, in four audiences’ words. The variant selects the payload type, so a customer view cannot be handed to the restaurant queue by accident."
        declaredStates={['customer', 'restaurant', 'rider', 'admin', 'urgent', 'late', 'stale', 'loading', 'with timeline']}
      >
        <SpecimenGrid min="24rem">
          <Specimen label="customer" fixture={cite(orderFixtures.customerPreparing)}>
            <OrderCard
              variant="customer"
              order={orders.customerPreparing}
              onPress={() => undefined}
            />
          </Specimen>
          <Specimen label="restaurant" fixture={cite(orderFixtures.restaurantPending)}>
            <OrderCard
              variant="restaurant"
              order={orders.restaurantPending}
              actions={
                <Row>
                  <Button onPress={() => undefined}>Accept order</Button>
                  <Button variant="tertiary" onPress={() => undefined}>
                    Reject
                  </Button>
                </Row>
              }
            />
          </Specimen>
          <Specimen label="rider" fixture={cite(orderFixtures.riderAssignment)}>
            <OrderCard variant="rider" order={orders.riderAssignment} onPress={() => undefined} />
          </Specimen>
          <Specimen label="admin" fixture={cite(orderFixtures.adminCompleted)}>
            <OrderCard variant="admin" order={orders.adminCompleted} onPress={() => undefined} />
          </Specimen>
          <Specimen
            label="urgent"
            forced
            caption="Deadline inside its last quarter: a 2px danger border and a word. Never the border alone."
          >
            <OrderCard variant="restaurant" order={orders.restaurantPending} urgent />
          </Specimen>
          <Specimen
            label="late"
            forced
            caption="promised_ready_at has passed while still PREPARING (R-23 R6): a warning left border and a “Late” marker."
          >
            <OrderCard variant="restaurant" order={orders.restaurantPreparing} late />
          </Specimen>
          <Specimen
            label="stale"
            forced
            caption="Socket silent for more than 45 s. A stale queue must announce itself — the card dims and says so rather than quietly showing old data."
          >
            <OrderCard variant="restaurant" order={orders.restaurantPreparing} stale />
          </Specimen>
          <Specimen label="loading" forced>
            <OrderCard variant="customer" order={orders.customerPreparing} loading />
          </Specimen>
          <Specimen
            label="With a timeline slot"
            fixture={cite(orderFixtures.customerPreparing)}
            caption="OrderCard never times anything itself; the countdown and the timeline are passed in from the feedback tier."
          >
            <OrderCard
              variant="customer"
              order={orders.customerPreparing}
              timeline={
                <StatusTimeline
                  state="PREPARING"
                  audience="customer"
                  orientation="compact"
                  transitions={transitionsFor('PREPARING')}
                  label={`Order ${orders.customerPreparing.code} progress`}
                />
              }
            />
          </Specimen>
        </SpecimenGrid>
      </ComponentBlock>
    </Section>
  );
}

type RestaurantCardData = (typeof restaurantCards)[number];

/** Derives a halal state onto a fixture card without mutating the fixture. */
function withHalalState(
  card: RestaurantCardData,
  state: 'CERTIFIED' | 'EXPIRING_SOON' | 'EXPIRED' | 'UNVERIFIED',
): RestaurantCardData {
  const next = copy(card);
  if (next.halal) next.halal.display_state = state;
  return next;
}
