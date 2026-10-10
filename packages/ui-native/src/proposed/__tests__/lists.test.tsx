/**
 * The N6 cards and rider composites on React Native Reusables, on the real stylesheet (the lib
 * harness compiles `lib/`, `ds/` and `proposed/`), customer and rider × light and dark.
 *
 * What must never regress: a card is one press target with one accessible name; a missing halal
 * field renders no badge (invariant 8) and a partial record says so instead; the seal green
 * appears only inside a CERTIFIED `HalalBadge`; every amount is a `/ds` `Price`; out-of-stock
 * says why; loading is a skeleton hidden from assistive technology; targets are measured.
 */
import * as path from 'node:path';
import * as React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';
import type { Schema } from '@hg/api-client';

import { themes } from '../../tokens';
import { SCHEMES, SEAL_GREEN, cssVar, dangerSet, flat, hex, loadThemeCssFor, paintedColours, renderNw, sealGreen } from '../../lib/ui/__tests__/harness';
import {
  ActionList,
  ActiveDeliveryBar,
  ActiveJobBar,
  FoodStatusPanel,
  MenuItemCard,
  MessagePreview,
  OrderCard,
  QueuedStepRow,
  RestaurantCardCompact,
  RestaurantRail,
} from '..';

const SRC = path.resolve(__dirname, '../..');
beforeAll(() => loadThemeCssFor([`${SRC}/lib/**/*.tsx`, `${SRC}/ds/**/*.tsx`, `${SRC}/proposed/**/*.tsx`]), 180_000);

type R = Schema['RestaurantCard'];
const OPEN: R['availability'] = {
  state: 'OPEN',
  distance_m: 1200,
  eta_min_minutes: 25,
  eta_max_minutes: 35,
  indicative_delivery_fee_cents: 299 as never,
};
const restaurant = (over: Partial<R> = {}): R =>
  ({
    id: 'r-1',
    name: 'Zaytoun Grill',
    cuisines: ['Lebanese', 'Grill'],
    availability: OPEN,
    halal: { display_state: 'CERTIFIED', certifying_body_name: 'HMA Canada', expires_on: '2027-03-14' },
    ...over,
  }) as R;

const item = (over: Partial<Schema['MenuItem']> = {}): Schema['MenuItem'] =>
  ({
    id: 'm-1',
    name: 'Chicken shawarma plate',
    description: 'Garlic sauce, pickles, rice.',
    price_cents: 1599,
    currency: 'CAD',
    availability_state: 'AVAILABLE',
    tax_category: 'PREPARED_FOOD',
    allergen_tags: ['SESAME'],
    dietary_tags: [],
    ...over,
  }) as Schema['MenuItem'];

/** Colours painted outside any `-halal` subtree (the seal is allowed its own green). */
function paintedOutsideSeal(tree: unknown): string[] {
  const strip = (node: unknown): unknown => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(strip);
    const n = node as { props?: { testID?: string }; children?: unknown };
    if (n.props?.testID?.endsWith('-halal')) return null;
    return { ...n, children: strip(n.children) };
  };
  return paintedColours(strip(tree));
}

describe('RestaurantCardCompact', () => {
  it.each(SCHEMES)('%s %s: one press target, one name; seal, certifier and fee through Price', (theme, scheme) => {
    const onPress = jest.fn();
    renderNw(<RestaurantCardCompact restaurant={restaurant()} onPress={onPress} />, { theme, scheme });
    const card = screen.getByRole('button');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(card.props.accessibilityLabel).toBe(
      'Zaytoun Grill. Halal certified, by HMA Canada. Lebanese, Grill, 1.2 kilometres, 25 to 35 min. Delivery 2 dollars and 99 cents.',
    );
    expect(screen.getByTestId('RestaurantCardCompact-halal')).toBeTruthy();
    expect(screen.getByText('Certified by HMA Canada')).toBeTruthy();
    expect(screen.getByTestId('RestaurantCardCompact-fee').props.children).toBe('$2.99');
    fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
    // The seal green lives only inside the CERTIFIED seal.
    expect(paintedColours(screen.toJSON())).toContain(sealGreen(scheme));
    expect(paintedOutsideSeal(screen.toJSON())).not.toContain(sealGreen(scheme));
    expect(paintedOutsideSeal(screen.toJSON())).not.toContain(SEAL_GREEN);
    const danger = dangerSet(theme, scheme);
    expect(paintedColours(screen.toJSON()).filter((c) => danger.has(c))).toEqual([]);
  });

  it('a missing halal field renders no badge; a partial record says so; unverified shows nothing', () => {
    renderNw(<RestaurantCardCompact restaurant={restaurant({ halal: undefined as never })} />);
    expect(screen.queryByTestId('RestaurantCardCompact-halal')).toBeNull();
    expect(screen.queryByText('Certificate details unavailable')).toBeNull();
    expect(paintedColours(screen.toJSON())).not.toContain(SEAL_GREEN);
    renderNw(<RestaurantCardCompact restaurant={restaurant({ halal: { display_state: 'CERTIFIED' } })} />);
    expect(screen.queryByTestId('RestaurantCardCompact-halal')).toBeNull();
    expect(screen.getByText('Certificate details unavailable')).toBeTruthy();
    expect(paintedColours(screen.toJSON())).not.toContain(SEAL_GREEN);
    renderNw(<RestaurantCardCompact restaurant={restaurant({ halal: { display_state: 'UNVERIFIED' } })} />);
    expect(screen.queryByTestId('RestaurantCardCompact-halal')).toBeNull();
    expect(screen.queryByText('Certificate details unavailable')).toBeNull();
  });

  it.each(SCHEMES)('%s %s: expiring carries its date; expired is slate, never the seal green or danger', (theme, scheme) => {
    renderNw(
      <RestaurantCardCompact
        restaurant={restaurant({ halal: { display_state: 'EXPIRING_SOON', certifying_body_name: 'HMA Canada', expires_on: '2026-10-20' } })}
        onPress={jest.fn()}
      />,
      { theme, scheme },
    );
    expect(screen.getByText('expires 20 Oct')).toBeTruthy();
    expect(screen.getByRole('button').props.accessibilityLabel).toContain('Halal certified, expires 20 Oct, by HMA Canada.');
    renderNw(
      <RestaurantCardCompact
        restaurant={restaurant({ halal: { display_state: 'EXPIRED', certifying_body_name: 'HMA Canada', expires_on: '2026-09-01' } })}
      />,
      { theme, scheme },
    );
    const painted = paintedColours(screen.toJSON());
    expect(painted).not.toContain(SEAL_GREEN);
    expect(painted).not.toContain(sealGreen(scheme));
    const danger = dangerSet(theme, scheme);
    expect(painted.filter((c) => danger.has(c))).toEqual([]);
  });

  it('no photo is a "No image" frame; closed says when it opens; free delivery is a Price; loading is a hidden skeleton', () => {
    renderNw(
      <RestaurantCardCompact
        restaurant={restaurant({
          availability: { ...OPEN, state: 'PAUSED', indicative_delivery_fee_cents: 0 as never },
        })}
      />,
    );
    expect(screen.getByText('No image', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('Not accepting orders')).toBeTruthy();
    expect(screen.getByTestId('RestaurantCardCompact-fee').props.children).toBe('Free delivery');
    renderNw(<RestaurantCardCompact restaurant={restaurant()} loading />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('RestaurantCardCompact-skeleton', { includeHiddenElements: true })).toBeTruthy();
  });
});

describe('RestaurantRail', () => {
  it.each([
    ['customer', 44],
    ['rider', 56],
  ] as const)('%s: heading, a %ipt See all link, one card per restaurant', (theme, min) => {
    const onSeeAll = jest.fn();
    renderNw(
      <RestaurantRail
        title="Open now near you"
        restaurants={[restaurant(), restaurant({ id: 'r-2', name: 'Lahore Tikka' })]}
        onSeeAll={onSeeAll}
        onPressRestaurant={jest.fn()}
      />,
      { theme },
    );
    expect(screen.getByRole('header')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'See all: Open now near you' });
    expect(flat(link).minHeight).toBeGreaterThanOrEqual(min);
    fireEvent.press(link);
    expect(onSeeAll).toHaveBeenCalled();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /^Lahore Tikka\./ })).toBeTruthy();
  });

  it('loading is one named busy region of hidden skeletons; empty renders nothing or its text', () => {
    renderNw(<RestaurantRail title="Open now" restaurants={[]} loading />);
    expect(screen.getByLabelText('Loading Open now')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    const empty = renderNw(<RestaurantRail title="Open now" restaurants={[]} />);
    expect(empty.toJSON()).toBeNull();
    renderNw(<RestaurantRail title="Open now" restaurants={[]} emptyText="Nothing open near you right now." />);
    expect(screen.getByText('Nothing open near you right now.')).toBeTruthy();
  });
});

describe('MenuItemCard', () => {
  it.each(SCHEMES)('%s %s: the row is one target with one name; Add is the adjacent second; price via Price', (theme, scheme) => {
    const onPress = jest.fn();
    const onAdd = jest.fn();
    renderNw(<MenuItemCard item={item()} onPress={onPress} onAdd={onAdd} />, { theme, scheme });
    const row = screen.getByRole('button', {
      name: 'Chicken shawarma plate. Garlic sauce, pickles, rice.. 15 dollars and 99 cents. Contains: sesame.',
    });
    expect(screen.getByTestId('MenuItemCard-price').props.children).toBe('$15.99');
    expect(screen.getByTestId('MenuItemCard-price').props.accessibilityLabel).toBe('15 dollars and 99 cents');
    const add = screen.getByRole('button', { name: 'Add Chicken shawarma plate' });
    expect(flat(add).minHeight).toBe(theme === 'rider' ? 56 : 44);
    fireEvent.press(row);
    fireEvent.press(add);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledTimes(1);
    const painted = paintedColours(screen.toJSON());
    expect(painted).not.toContain(SEAL_GREEN);
    const danger = dangerSet(theme, scheme);
    expect(painted.filter((c) => danger.has(c))).toEqual([]);
  });

  it('out of stock names its reason, disables Add with it, and keeps the row readable', () => {
    const onAdd = jest.fn();
    const until = new Date(2026, 9, 10, 18, 0, 0).toISOString();
    renderNw(<MenuItemCard item={item({ availability_state: 'OUT_OF_STOCK', out_of_stock_until: until })} onPress={jest.fn()} onAdd={onAdd} />);
    expect(screen.getByText('Out of stock')).toBeTruthy();
    const reason = screen.getByTestId('MenuItemCard-reason').props.children as string;
    expect(reason).toMatch(/^Out of stock until 6:00\s?p\.m\.$/);
    const add = screen.getByRole('button', { name: 'Add Chicken shawarma plate' });
    expect(add.props.accessibilityState).toMatchObject({ disabled: true });
    expect(add.props.accessibilityHint).toBe(reason);
    fireEvent.press(add);
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByTestId('MenuItemCard').props.accessibilityLabel.endsWith(`${reason}.`)).toBe(true);
    // With no time, the badge says it once; the words are not repeated beside it.
    renderNw(<MenuItemCard item={item({ availability_state: 'OUT_OF_STOCK' })} onPress={jest.fn()} />);
    expect(screen.getAllByText('Out of stock')).toHaveLength(1);
    expect(screen.queryByTestId('MenuItemCard-reason')).toBeNull();
  });

  it('highlighted is the selected fill; loading is a hidden skeleton; no image is the placeholder', () => {
    renderNw(<MenuItemCard item={item()} highlighted onPress={jest.fn()} />);
    expect(hex(flat(screen.getByTestId('MenuItemCard')).backgroundColor)).toBe(hex(themes.customer.light.color.state.selectedTint));
    expect(screen.getByText('No image', { includeHiddenElements: true })).toBeTruthy();
    renderNw(<MenuItemCard item={item()} loading />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByTestId('MenuItemCard-skeleton', { includeHiddenElements: true })).toBeTruthy();
  });
});

describe('OrderCard', () => {
  const summary = {
    id: 'o-1',
    code: 'HG-1042',
    currency: 'CAD',
    state: 'PREPARING',
    placed_at: '2026-10-10T18:00:00Z',
    total_cents: 3250,
    first_item_names: ['Shawarma plate', 'Fries', 'Ayran'],
    item_count: 3,
    restaurant: { id: 'r-1', name: 'Zaytoun Grill', halal: { display_state: 'CERTIFIED' } },
  } as unknown as Schema['OrderSummary'];

  it.each(SCHEMES)('%s %s: status is icon + word; one target with one name; total through Price', (theme, scheme) => {
    const onPress = jest.fn();
    renderNw(<OrderCard order={summary} onPress={onPress} urgent />, { theme, scheme });
    const card = screen.getByRole('button', { name: 'Order from Zaytoun Grill. Preparing. Urgent.' });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByText('Preparing')).toBeTruthy();
    expect(screen.getByText('Urgent')).toBeTruthy();
    expect(screen.getByTestId('OrderCard-total').props.children).toBe('$32.50');
    fireEvent.press(card);
    expect(onPress).toHaveBeenCalled();
    // Urgent is a word in a badge, never a coloured edge.
    expect(flat(card).borderWidth).toBe(1);
    const painted = paintedColours(screen.toJSON());
    expect(paintedOutsideSeal(screen.toJSON())).not.toContain(SEAL_GREEN);
    const danger = dangerSet(theme, scheme);
    expect(painted.filter((c) => danger.has(c))).toEqual([]);
  });

  it('a missing halal field on the order renders no badge; the rider card has no basket value', () => {
    renderNw(<OrderCard order={{ ...summary, restaurant: { id: 'r-1', name: 'Zaytoun Grill' } } as never} />);
    expect(screen.queryByTestId('OrderCard-halal')).toBeNull();
    const assignment = {
      id: 'a-1',
      order_id: 'o-1',
      state: 'EN_ROUTE_TO_PICKUP',
      pickup: { restaurant_name: 'Zaytoun Grill', address: '12 Queen St' },
      dropoff: { address: '88 Brimley Rd' },
      items: [{}, {}],
      earnings: { estimated_total_cents: 950 },
    } as unknown as Schema['Assignment'];
    renderNw(<OrderCard variant="rider" order={assignment} />, { theme: 'rider' });
    expect(screen.getByText('Going to pickup')).toBeTruthy();
    expect(screen.queryByTestId('OrderCard-total')).toBeNull();
    expect(screen.getByTestId('OrderCard-earnings').props.children).toBe('$9.50');
  });

  it('with actions the card is not pressable; loading is a hidden skeleton', () => {
    renderNw(<OrderCard order={summary} onPress={jest.fn()} actions={<></>} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    renderNw(<OrderCard order={summary} loading />);
    expect(screen.getByTestId('OrderCard-skeleton', { includeHiddenElements: true })).toBeTruthy();
  });
});

describe('rider composites', () => {
  it.each(SCHEMES)('%s %s: ActiveDeliveryBar has one xl primary target, 60pt', (theme, scheme) => {
    const onResume = jest.fn();
    renderNw(<ActiveDeliveryBar label="Go to Zaytoun Grill" onResume={onResume} />, { theme, scheme });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    const resume = screen.getByRole('button', { name: 'Resume: Go to Zaytoun Grill' });
    expect(flat(resume).minHeight).toBe(60);
    expect(hex(flat(resume).backgroundColor)).toBe(hex(themes[theme][scheme].color.action.primary));
    fireEvent.press(resume);
    expect(onResume).toHaveBeenCalled();
    expect(ActiveJobBar).toBe(ActiveDeliveryBar);
    const painted = paintedColours(screen.toJSON());
    expect(painted).not.toContain(SEAL_GREEN);
    const danger = dangerSet(theme, scheme);
    expect(painted.filter((c) => danger.has(c))).toEqual([]);
  });

  it('QueuedStepRow is a static 56pt row with no live region', () => {
    renderNw(<QueuedStepRow step="On my way" time="9:31 pm" />, { theme: 'rider' });
    const row = screen.getByLabelText('On my way, 9:31 pm, Not sent yet');
    expect(flat(row).minHeight).toBe(56);
    expect(row.props.accessibilityLiveRegion).toBeUndefined();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('MessagePreview is hidden without a message; with one, a ghost See all', () => {
    const empty = renderNw(<MessagePreview from="Zaytoun Grill" time="9:41 pm" body={null} />, { theme: 'rider' });
    expect(empty.toJSON()).toBeNull();
    const onSeeAll = jest.fn();
    renderNw(
      <MessagePreview from="Zaytoun Grill" time="9:41 pm" body="Two more minutes on the grill." onSeeAll={onSeeAll} />,
      { theme: 'rider' },
    );
    expect(screen.getByLabelText('From Zaytoun Grill · 9:41 pm. Two more minutes on the grill.')).toBeTruthy();
    const see = screen.getByRole('button', { name: 'See all messages' });
    expect(flat(see).minHeight).toBe(56);
    fireEvent.press(see);
    expect(onSeeAll).toHaveBeenCalled();
  });

  it.each(SCHEMES)('%s %s: ActionList is critical 72pt buttons, 8pt apart, never danger', (theme, scheme) => {
    const picked = jest.fn();
    renderNw(
      <ActionList
        label="Why are you declining?"
        actions={[
          { key: 'far', label: 'Too far', onPress: () => picked('far') },
          { key: 'busy', label: 'Too busy', onPress: () => picked('busy'), disabled: true },
        ]}
        testID="al"
      />,
      { theme, scheme },
    );
    expect(screen.getByLabelText('Why are you declining?')).toBeTruthy();
    expect(flat(screen.getByTestId('al')).rowGap).toBe(8);
    for (const name of ['Too far', 'Too busy']) expect(flat(screen.getByRole('button', { name })).minHeight).toBe(72);
    fireEvent.press(screen.getByRole('button', { name: 'Too busy' }));
    fireEvent.press(screen.getByRole('button', { name: 'Too far' }));
    expect(picked).toHaveBeenCalledTimes(1);
    const danger = dangerSet(theme, scheme);
    expect(paintedColours(screen.toJSON()).filter((c) => danger.has(c))).toEqual([]);
  });

  it.each(SCHEMES)('%s %s: FoodStatusPanel is the neutral (or info) InlineAlert, never danger', (theme, scheme) => {
    renderNw(<FoodStatusPanel status="Preparing" detail="You've waited 21 min" testID="f" />, { theme, scheme });
    expect(screen.getByText('Food: Preparing')).toBeTruthy();
    expect(hex(flat(screen.getByTestId('f')).backgroundColor)).toBe(cssVar(theme, scheme, '--hg-feedback-neutral-tint'));
    renderNw(<FoodStatusPanel status="Ready for pickup" tone="info" testID="g" />, { theme, scheme });
    expect(hex(flat(screen.getByTestId('g')).backgroundColor)).toBe(cssVar(theme, scheme, '--hg-feedback-info-tint'));
    const danger = dangerSet(theme, scheme);
    expect(paintedColours(screen.toJSON()).filter((c) => danger.has(c))).toEqual([]);
  });
});
