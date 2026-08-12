/**
 * Section 04 — Tier 3, content and data display.
 *
 * `RestaurantCard` carries this section: it is the surface where the design doc's placement
 * argument is either true or false, so the seal-between-hero-and-name specimens come first and
 * everything is populated from `contracts/fixtures/catalogue/*`.
 */
import * as React from 'react';
import { Text, View } from 'react-native';
import { cents } from '@hg/api-client';
import {
  Card,
  MenuItemCard,
  MenuItemCardSkeleton,
  OrderCard,
  OrderCardSkeleton,
  Price,
  QuantityStepper,
  Rating,
  RestaurantCard,
  RestaurantCardSkeleton,
  restaurantCardAccessibleName,
  formatDistance,
  formatEta,
  summariseCuisines,
} from '@hg/ui-native';

import { Case, Claim, Column, Mono, Note, Section, Shelf, Subsection, useChrome } from '../chrome';
import type { SectionMeta } from '../chrome';
import {
  SOURCE,
  availability,
  dispatch,
  menuItems,
  orders,
  quote,
  restaurants,
  restaurantsLongNames,
  restaurantsMissingImages,
  withHalalState,
  withoutHalal,
} from '../fixtures';

export const meta: SectionMeta = {
  id: '04-content',
  title: 'Content and data display',
  blurb:
    'Card, RestaurantCard, MenuItemCard, OrderCard, Price, Rating, QuantityStepper. Every restaurant, dish, price and order below is a real fixture from contracts/fixtures — nothing here is invented.',
};

const [karachi, alNoor, bismillah, expiringCard] = restaurants;

/* ----------------------------------------------------------------- restaurant cards */

function RestaurantCards() {
  const c = useChrome();
  const [fav, setFav] = React.useState(false);
  return (
    <Subsection title="RestaurantCard — where the seal sits">
      <Claim>
        The seal is the first thing in the card body: <Text style={{ fontWeight: '700' }}>hero
        image, then seal, then name</Text>, with rating and distance below it. Three rules converge
        there — the seal outranks the brand colour (D1), it is never composited on a photograph
        (foundations §12), and the accessible name puts the halal state second, straight after the
        name (04-accessibility §3.4). Read the accessible name printed under the first card.
      </Claim>
      <Shelf>
        <Column width={360}>
          <Case label="RestaurantCard — feed, CERTIFIED" code={SOURCE.restaurants} fill>
            <RestaurantCard restaurant={karachi} onPress={() => undefined} />
          </Case>
          <View
            style={{ borderWidth: 1, borderColor: c.line, borderRadius: 6, padding: 10, backgroundColor: c.panel }}
          >
            <Mono size={10} color={c.ink}>
              accessible name
            </Mono>
            <Mono size={10}>
              {restaurantCardAccessibleName({
                restaurant: karachi,
                state: karachi.availability,
                cuisines: summariseCuisines(karachi.cuisines),
                distance: formatDistance(karachi.availability.distance_m),
                eta: formatEta(
                  karachi.availability.eta_min_minutes,
                  karachi.availability.eta_max_minutes,
                ),
              })}
            </Mono>
          </View>
        </Column>
        <Column width={360}>
          <Case
            label="RestaurantCard — feed, EXPIRING_SOON"
            code="fixture index 3 — the card badge is identical to CERTIFIED by design"
            fill
          >
            <RestaurantCard restaurant={expiringCard} onPress={() => undefined} />
          </Case>
          <Case label="RestaurantCard — with favourite" code="onFavourite — a second, adjacent target" fill>
            <RestaurantCard
              restaurant={alNoor}
              onPress={() => undefined}
              favourited={fav}
              onFavourite={() => setFav((f) => !f)}
            />
          </Case>
        </Column>
        <Column width={360}>
          <Case label="RestaurantCard — compact" code='variant="compact"' fill>
            <RestaurantCard restaurant={bismillah} variant="compact" onPress={() => undefined} />
          </Case>
          <Case label="RestaurantCard — carousel" code='variant="carousel" — fixed 280 width' fill>
            <RestaurantCard restaurant={karachi} variant="carousel" onPress={() => undefined} />
          </Case>
        </Column>
      </Shelf>

      <Note>
        Availability is a scrim over the hero, never a disabled card — browsing a closed
        restaurant&apos;s menu is legitimate, so the card stays pressable and it is the add controls
        inside the menu that disable.
      </Note>
      <Shelf>
        <Column width={360}>
          <Case label="RestaurantCard — closed" code="availability=restaurant_availability_closed_hours" fill>
            <RestaurantCard restaurant={karachi} availability={availability.closed} onPress={() => undefined} />
          </Case>
        </Column>
        <Column width={360}>
          <Case label="RestaurantCard — paused" code="availability=restaurant_availability_paused" fill>
            <RestaurantCard restaurant={alNoor} availability={availability.paused} onPress={() => undefined} />
          </Case>
        </Column>
        <Column width={360}>
          <Case
            label="RestaurantCard — out of range"
            code="availability=restaurant_availability_out_of_range"
            fill
          >
            <RestaurantCard
              restaurant={bismillah}
              availability={availability.outOfRange}
              onPress={() => undefined}
            />
          </Case>
        </Column>
      </Shelf>

      <Shelf>
        <Column width={360}>
          <Case label="RestaurantCard — loading" code="loading → RestaurantCardSkeleton" fill>
            <RestaurantCard restaurant={karachi} loading />
          </Case>
        </Column>
        <Column width={360}>
          <Case label="RestaurantCardSkeleton — compact" code='variant="compact"' fill>
            <RestaurantCardSkeleton variant="compact" />
          </Case>
        </Column>
        <Column width={360}>
          <Case label="RestaurantCard — no hero image" code={SOURCE.restaurantsMissingImages} fill>
            <RestaurantCard restaurant={restaurantsMissingImages[0]} onPress={() => undefined} />
          </Case>
        </Column>
        <Column width={360}>
          <Case label="RestaurantCard — long name" code={SOURCE.restaurantsLongNames} fill>
            <RestaurantCard restaurant={restaurantsLongNames[0]} onPress={() => undefined} />
          </Case>
        </Column>
        <Column width={360}>
          <Case label="RestaurantCard — showDistance={false}" code="showDistance={false}" fill>
            <RestaurantCard restaurant={karachi} showDistance={false} onPress={() => undefined} />
          </Case>
        </Column>
      </Shelf>

      <Claim>
        The two halal states below <Text style={{ fontWeight: '700' }}>cannot occur</Text> on a real
        customer list — C-12 R1 removes uncertified and expired kitchens from customer read paths
        entirely, which is why no fixture contains one. They are forced here so the reviewer can
        confirm the card does the right thing if one ever leaked through: EXPIRED draws a hollow,
        ringless seal, and UNVERIFIED draws nothing at all rather than a gap with a label.
      </Claim>
      <Shelf>
        <Column width={360}>
          <Case
            label="RestaurantCard — EXPIRED"
            code="halal.display_state overridden on a real fixture card"
            forced="cannot occur on a customer list"
            fill
          >
            <RestaurantCard restaurant={withHalalState(karachi, 'EXPIRED')} onPress={() => undefined} />
          </Case>
        </Column>
        <Column width={360}>
          <Case
            label="RestaurantCard — UNVERIFIED"
            code="the seal slot is simply empty; the name moves up"
            forced="cannot occur on a customer list"
            fill
          >
            <RestaurantCard restaurant={withHalalState(karachi, 'UNVERIFIED')} onPress={() => undefined} />
          </Case>
        </Column>
        <Column width={360}>
          <Case
            label="RestaurantCard — halal field absent"
            code="delete restaurant.halal → badge null + client error reported"
            forced="C-12 R4 path"
            fill
          >
            <RestaurantCard restaurant={withoutHalal(karachi)} onPress={() => undefined} />
          </Case>
        </Column>
      </Shelf>
    </Subsection>
  );
}

/* ----------------------------------------------------------------------------- card */

function Cards() {
  return (
    <Subsection title="Card">
      <Shelf>
        {(['elevated', 'outlined', 'filled', 'interactive'] as const).map((variant) => (
          <Case key={variant} label={`Card — ${variant}`} code={`variant="${variant}"`}>
            <View style={{ width: 260 }}>
              <Card
                variant={variant}
                onPress={variant === 'interactive' ? () => undefined : undefined}
                accessibilityLabel={variant === 'interactive' ? 'Open order HG-4K2M-9T' : undefined}
              >
                <Text>Order HG-4K2M-9T</Text>
              </Card>
            </View>
          </Case>
        ))}
        <Case label="Card — header / footer" code="header + footer slots">
          <View style={{ width: 260 }}>
            <Card
              variant="outlined"
              header={<Text style={{ fontWeight: '700' }}>Today</Text>}
              footer={<Text>3 orders</Text>}
            >
              <Text>Karachi Kitchen · Al-Noor · Bismillah</Text>
            </Card>
          </View>
        </Case>
        <Case label="Card — disabled" code="disabled" forced="forced prop">
          <View style={{ width: 260 }}>
            <Card variant="interactive" disabled onPress={() => undefined} accessibilityLabel="Unavailable">
              <Text>Unavailable</Text>
            </Card>
          </View>
        </Case>
      </Shelf>
      <Note>
        Dark mode is where `Card` earns its keep: the elevated variant swaps a shadow for a surface
        step, because a black shadow on a near-black surface is invisible. Flip the SCHEME control
        and compare `elevated` with `outlined`.
      </Note>
    </Subsection>
  );
}

/* ---------------------------------------------------------------------------- price */

function Prices() {
  return (
    <Subsection title="Price">
      <Claim>
        The only component in the system permitted to render money, and it takes branded `Cents` —
        a bare `number` will not compile. There is no `toDollars()` anywhere in the money module, so
        a float cannot enter the path and `0.1 + 0.2` cannot happen.
      </Claim>
      <Shelf align="flex-end">
        {(['sm', 'md', 'lg', 'xl'] as const).map((size) => (
          <Case key={size} label={`Price — ${size}`} code={`size="${size}" cents={1695}`}>
            <Price cents={cents(1695)} size={size} />
          </Case>
        ))}
        <Case label="Price — zero as label" code='cents={0} free="Free delivery"'>
          <Price cents={cents(0)} free="Free delivery" />
        </Case>
        <Case label="Price — zero without label" code="cents={0} — never blank">
          <Price cents={cents(0)} />
        </Case>
        <Case label="Price — strikethrough" code="strikethrough — reads as “was” in speech">
          <Price cents={cents(2499)} strikethrough />
        </Case>
        <Case label="Price — signed" code='sign="always" — ledger and earnings deltas'>
          <Price cents={cents(700)} sign="always" />
        </Case>
        <Case label="Price — negative" code="cents={-1250} — a refund line">
          <Price cents={cents(-1250)} sign="always" />
        </Case>
        <Case label="Price — currency code" code="showCode — required on receipts">
          <Price cents={cents(10684)} showCode size="lg" />
        </Case>
        <Case label="Price — loading" code="loading — glyph width frozen" forced="forced prop">
          <Price cents={cents(10684)} loading size="lg" />
        </Case>
        <Case label="Price — quote total from fixture" code={SOURCE.quote}>
          <Price cents={cents(quote.total_cents ?? 0)} size="xl" showCode />
        </Case>
      </Shelf>
    </Subsection>
  );
}

/* --------------------------------------------------------------------------- rating */

function Ratings() {
  const [value, setValue] = React.useState(4);
  return (
    <Subsection title="Rating">
      <Shelf align="center">
        {(['sm', 'md', 'lg'] as const).map((size) => (
          <Case key={size} label={`Rating — display ${size}`} code={`size="${size}"`}>
            <Rating value={4.8} count={412} size={size} />
          </Case>
        ))}
        <Case label="Rating — stars" code='variant="stars"'>
          <Rating value={4.4} count={96} variant="stars" />
        </Case>
        <Case label="Rating — no count" code="showCount={false}">
          <Rating value={4.6} count={1183} showCount={false} />
        </Case>
        <Case label="Rating — new restaurant" code="value={null} → “New”">
          <Rating value={null} count={0} />
        </Case>
        <Case label="Rating — loading" code="loading" forced="forced prop">
          <Rating value={4.8} count={412} loading />
        </Case>
        <Case label="Rating — input" code='variant="input" — a radiogroup under the hood'>
          <Rating
            value={value}
            variant="input"
            onChange={setValue}
            subject="your order from Karachi Kitchen"
          />
        </Case>
      </Shelf>
    </Subsection>
  );
}

/* ------------------------------------------------------------------ quantity stepper */

function Steppers() {
  const [q, setQ] = React.useState(2);
  return (
    <Subsection title="QuantityStepper">
      <Note>
        Cart mutations are server-authoritative, so `loading` freezes the value and blocks both
        buttons — an optimistic stepper that reverts is worse than a 200 ms wait.
      </Note>
      <Shelf align="center">
        {(['sm', 'md', 'lg'] as const).map((size) => (
          <Case key={size} label={`QuantityStepper — ${size}`} code={`size="${size}"`}>
            <QuantityStepper value={q} onChange={setQ} size={size} itemName="Chicken Biryani" />
          </Case>
        ))}
        <Case label="QuantityStepper — at min" code="value={1} min={1} — “−” disabled">
          <QuantityStepper value={1} min={1} onChange={() => undefined} itemName="Chicken Biryani" />
        </Case>
        <Case
          label="QuantityStepper — at max"
          code='value={4} max={4} maxReason="Only 4 left today"'
          forced="forced prop"
        >
          <QuantityStepper
            value={4}
            max={4}
            onChange={() => undefined}
            itemName="Chicken Biryani"
            maxReason="Only 4 left today"
          />
        </Case>
        <Case label="QuantityStepper — removeAtZero" code="removeAtZero — “−” becomes a trash glyph at 1">
          <QuantityStepper value={1} onChange={() => undefined} removeAtZero itemName="Chicken Biryani" />
        </Case>
        <Case label="QuantityStepper — loading" code="loading" forced="forced prop">
          <QuantityStepper value={2} onChange={() => undefined} loading itemName="Chicken Biryani" />
        </Case>
        <Case label="QuantityStepper — disabled" code="disabled" forced="forced prop">
          <QuantityStepper value={2} onChange={() => undefined} disabled itemName="Chicken Biryani" />
        </Case>
      </Shelf>
    </Subsection>
  );
}

/* ------------------------------------------------------------------- menu item cards */

function MenuItems() {
  const [qty, setQty] = React.useState(1);
  return (
    <Subsection title="MenuItemCard">
      <Note>
        At V1 unavailable items are <Text style={{ fontWeight: '700' }}>omitted</Text> from the
        customer menu, not greyed — C-13 R1. The unavailable specimen below exists for the
        restaurant-side menu editor, and is labelled accordingly.
      </Note>
      <Shelf>
        <Column width={380}>
          <Case label="MenuItemCard — row" code={SOURCE.menu} fill>
            <MenuItemCard item={menuItems.available} onAdd={() => undefined} onPress={() => undefined} />
          </Case>
          <Case label="MenuItemCard — in cart" code="quantityInCart={2} → stepper replaces add" fill>
            <MenuItemCard
              item={menuItems.available}
              quantityInCart={qty}
              onChangeQuantity={setQty}
              onPress={() => undefined}
            />
          </Case>
          <Case label="MenuItemCard — highlighted" code="highlighted — C-13 R3 in-menu search wash" fill>
            <MenuItemCard item={menuItems.available} highlighted onPress={() => undefined} />
          </Case>
        </Column>
        <Column width={380}>
          <Case label="MenuItemCard — grid" code='variant="grid"' fill>
            <MenuItemCard item={menuItems.manyVariants} variant="grid" onAdd={() => undefined} />
          </Case>
          <Case label="MenuItemCard — long name, no image" code="menu_item_long_name_no_image" fill>
            <MenuItemCard item={menuItems.longNameNoImage} onAdd={() => undefined} />
          </Case>
        </Column>
        <Column width={380}>
          <Case
            label="MenuItemCard — out of stock"
            code="menu_item_out_of_stock + disabledReason"
            forced="restaurant-side editor state"
            fill
          >
            <MenuItemCard
              item={menuItems.outOfStock}
              disabled
              disabledReason="Out of stock until 6:00 PM"
            />
          </Case>
          <Case label="MenuItemCard — loading" code="loading" fill>
            <MenuItemCard item={menuItems.available} loading />
          </Case>
          <Case label="MenuItemCardSkeleton — grid" code='variant="grid"' fill>
            <MenuItemCardSkeleton variant="grid" />
          </Case>
        </Column>
      </Shelf>
    </Subsection>
  );
}

/* ----------------------------------------------------------------------- order cards */

function OrderCards() {
  return (
    <Subsection title="OrderCard — one component, four audiences">
      <Claim>
        The variant selects the audience&apos;s payload type, not a different component: `customer`
        takes `OrderSummary`, `restaurant` takes `OrderRestaurantView`, `rider` takes `Assignment`,
        `admin` takes `OrderAdminView`. `urgent` and `late` are never colour-only — each also adds a
        text badge.
      </Claim>
      <Shelf>
        <Column width={380}>
          <Case label="OrderCard — customer" code="orders/order_list_active.json" fill>
            <OrderCard order={orders.active[0]} onPress={() => undefined} />
          </Case>
          <Case label="OrderCard — customer, past" code="orders/order_list_past.json (COMPLETED)" fill>
            <OrderCard order={orders.past[0]} onPress={() => undefined} />
          </Case>
          <Case label="OrderCard — customer, cancelled" code="orders/order_list_past.json (CANCELLED)" fill>
            <OrderCard order={orders.past[1]} onPress={() => undefined} />
          </Case>
        </Column>
        <Column width={380}>
          <Case label="OrderCard — restaurant" code="orders/restaurant_order_restaurant_pending.json" fill>
            <OrderCard variant="restaurant" order={orders.restaurantPending} onPress={() => undefined} />
          </Case>
          <Case label="OrderCard — restaurant, urgent" code="urgent — 2px border + an “Urgent” badge" fill forced="forced prop">
            <OrderCard variant="restaurant" order={orders.restaurantPending} urgent onPress={() => undefined} />
          </Case>
          <Case label="OrderCard — restaurant, late" code="late — R-23 R6, promised_ready_at passed" fill forced="forced prop">
            <OrderCard variant="restaurant" order={orders.restaurantPreparing} late onPress={() => undefined} />
          </Case>
          <Case label="OrderCard — restaurant, stale" code="stale — socket silent > 45 s" fill forced="forced prop">
            <OrderCard variant="restaurant" order={orders.restaurantPreparing} stale onPress={() => undefined} />
          </Case>
        </Column>
        <Column width={380}>
          <Case label="OrderCard — rider" code="dispatch/assignment_picked_up.json" fill>
            <OrderCard variant="rider" order={dispatch.assignment} onPress={() => undefined} />
          </Case>
          <Case label="OrderCard — admin" code="orders/order_admin_view_completed.json" fill>
            <OrderCard variant="admin" order={orders.adminCompleted} onPress={() => undefined} />
          </Case>
          <Case label="OrderCard — admin, disputed" code="orders/order_admin_view_disputed.json" fill>
            <OrderCard variant="admin" order={orders.adminDisputed} onPress={() => undefined} />
          </Case>
          <Case label="OrderCard — loading" code="loading → OrderCardSkeleton" fill>
            <OrderCardSkeleton />
          </Case>
        </Column>
      </Shelf>
    </Subsection>
  );
}

export function ContentSection({ onLayoutY }: { onLayoutY?: (id: string, y: number) => void }) {
  return (
    <Section meta={meta} onLayoutY={onLayoutY}>
      <RestaurantCards />
      <Cards />
      <Prices />
      <Ratings />
      <Steppers />
      <MenuItems />
      <OrderCards />
    </Section>
  );
}
