/**
 * The one structural assertion the customer catalogue depends on: the halal seal is above
 * the rating row, in both the drawn order and the spoken order.
 *
 * If this ever goes green with the seal below the metadata, the product has quietly become
 * "a yellow food app with a compliance footnote" (divergence D1).
 */
import { render } from '@testing-library/react-native';
import type { Schema } from '@hg/api-client';

import { ThemeProvider } from '../../tokens';
import { RestaurantCard, accessibleName } from '../RestaurantCard';

const restaurant: Schema['RestaurantCard'] = {
  id: '0192f2ea-0000-7000-8000-000000000001',
  name: 'Zaytoun Grill',
  cuisines: ['Lebanese', 'Grill', 'Shawarma'],
  halal: { display_state: 'CERTIFIED', certifying_body_name: 'Halal Monitoring Authority' },
  rating_avg: 4.6,
  rating_count: 312,
  price_band: '$$',
  availability: {
    state: 'OPEN',
    distance_m: 2430,
    eta_min_minutes: 25,
    eta_max_minutes: 35,
  },
};

/** Rendered order, depth-first — the order both the eye and the AT tree follow. */
function testIdsInOrder(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) testIdsInOrder(child, out);
    return out;
  }
  const element = node as { props?: Record<string, unknown>; children?: unknown };
  const testID = element.props?.['testID'];
  if (typeof testID === 'string') out.push(testID);
  testIdsInOrder(element.children, out);
  return out;
}

describe('RestaurantCard — the seal outranks the metadata', () => {
  it('draws the halal badge between the hero and the name, above the rating row', () => {
    const tree = render(
      <ThemeProvider theme="customer" scheme="light">
        <RestaurantCard restaurant={restaurant} />
      </ThemeProvider>,
    ).toJSON();

    const order = testIdsInOrder(tree);
    const hero = order.indexOf('RestaurantCard-hero');
    const seal = order.indexOf('RestaurantCard-halal');
    const name = order.indexOf('RestaurantCard-name');
    const meta = order.indexOf('RestaurantCard-metaRow');

    expect(seal).toBeGreaterThanOrEqual(0);
    expect(meta).toBeGreaterThanOrEqual(0);
    if (hero >= 0) expect(hero).toBeLessThan(seal);
    expect(seal).toBeLessThan(name);
    expect(name).toBeLessThan(meta);
  });

  it('speaks the halal state second, immediately after the name', () => {
    const spoken = accessibleName({
      restaurant,
      state: restaurant.availability,
      cuisines: 'Lebanese · Grill +1',
      distance: '2.4 km',
      eta: '25–35 min',
    });

    // 04-accessibility.md §3.4 — before rating, before distance. A screen-reader user hears
    // the certification in the first two seconds of every card.
    expect(spoken.startsWith('Zaytoun Grill. Halal certified.')).toBe(true);
    expect(spoken.indexOf('Halal certified')).toBeLessThan(spoken.indexOf('stars'));
    expect(spoken.indexOf('Halal certified')).toBeLessThan(spoken.indexOf('kilometres'));
  });
});
