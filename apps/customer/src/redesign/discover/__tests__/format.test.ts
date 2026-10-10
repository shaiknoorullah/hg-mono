/**
 * The card rules (WP2 DONE): the halal rule on a card (all three fields → badge; any missing → no
 * badge and "Certificate details unavailable"; EXPIRING_SOON carries its date), the composed
 * accessible name, and the meta lines ported from #634 `components/discover/format.ts`.
 */
import { presentHalal } from '../../lib/halal';
import {
  addressOptionDescription,
  addressOptionLabel,
  addressTitle,
  cuisineLine,
  etaDistance,
  expiresLabel,
  opensPhrase,
  restaurantCardLabel,
  spokenHalal,
  unavailableLabel,
  type Address,
  type RestaurantCard,
} from '../format';
import { resolveDeliveryAddress } from '../deliveryAddress';
import { payloadOf } from '../../test/mockApi';

const NOW = Date.parse('2026-10-09T22:00:00Z'); // 6:00 pm in Toronto, Friday

const zaytoun: RestaurantCard = {
  id: 'r1',
  name: 'Zaytoun Grill',
  cuisines: ['Levantine', 'Grill', 'Halal'],
  price_band: '$$',
  rating_count: 0,
  halal: { display_state: 'CERTIFIED', certifying_body_name: 'Halal Monitoring Authority (HMA Canada)', expires_on: '2027-03-09' },
  availability: {
    state: 'OPEN',
    eta_min_minutes: 25,
    eta_max_minutes: 35,
    distance_m: 1800,
    indicative_delivery_fee_cents: 299 as never,
    minimum_order_cents: 1500 as never,
  },
};

describe('the card halal rule (presentHalal on a card)', () => {
  it('shows the badge only when display_state, certifying_body_name and expires_on are all present', () => {
    const p = presentHalal(zaytoun.halal);
    expect(p).toMatchObject({ kind: 'badge', state: 'CERTIFIED', certifyingBody: 'Halal Monitoring Authority (HMA Canada)' });
    expect(expiresLabel(p)).toBeNull();
  });

  it.each([
    ['the halal field is missing', undefined],
    ['the certifying body is missing', { ...zaytoun.halal, certifying_body_name: null }],
    ['the expiry is missing', { ...zaytoun.halal, expires_on: null }],
    ['the state is missing', { certifying_body_name: 'HMA', expires_on: '2027-01-01' }],
  ])('renders no badge and the neutral line when %s', (_, halal) => {
    const p = presentHalal(halal as never);
    expect(p).toEqual({ kind: 'unavailable', line: 'Certificate details unavailable' });
    const label = restaurantCardLabel({ ...zaytoun, halal: halal as never }, p, NOW);
    expect(label).toContain('Certificate details unavailable.');
    expect(label).not.toContain('Halal certified');
  });

  it('dates an EXPIRING_SOON badge: "Halal certified · expires 20 Oct"', () => {
    const p = presentHalal({ ...zaytoun.halal, display_state: 'EXPIRING_SOON', expires_on: '2026-10-20' });
    expect(p).toMatchObject({ kind: 'badge', label: 'Halal certified · expires 20 Oct' });
    expect(expiresLabel(p)).toBe('expires 20 Oct');
    expect(spokenHalal(p)).toBe('Halal certified by Halal Monitoring Authority (HMA Canada), certificate expires 20 October.');
  });

  it('says why offline when the cache is past 15 minutes', () => {
    const p = presentHalal(zaytoun.halal, { online: false, asOf: NOW, now: NOW + 16 * 60_000 });
    expect(p.kind).toBe('stale');
    expect(restaurantCardLabel(zaytoun, p, NOW)).toContain('Certification cannot be checked while offline.');
  });
});

describe('the composed accessible name (DO/Main)', () => {
  it('reads the way the board draws it', () => {
    expect(restaurantCardLabel(zaytoun, presentHalal(zaytoun.halal), NOW)).toBe(
      'Zaytoun Grill. Halal certified by Halal Monitoring Authority (HMA Canada). Levantine, Grill. Moderately priced. ' +
        '25 to 35 minutes, 1.8 kilometres. Delivery about 2 dollars and 99 cents, estimate. Minimum order 15 dollars.',
    );
  });

  it('asks for an address instead of a time and fee with NO_ADDRESS', () => {
    const r = { ...zaytoun, availability: { state: 'NO_ADDRESS' as const, distance_m: null } };
    expect(restaurantCardLabel(r, presentHalal(r.halal), NOW)).toBe(
      'Zaytoun Grill. Halal certified by Halal Monitoring Authority (HMA Canada). Levantine, Grill. Moderately priced. ' +
        'Add an address to see delivery time and fee.',
    );
  });

  it('says a closed restaurant opens tomorrow, in Toronto time', () => {
    const r = {
      ...zaytoun,
      availability: { state: 'CLOSED_HOURS' as const, distance_m: 1800, opens_at: '2026-10-10T15:00:00Z' },
    };
    expect(unavailableLabel(r.availability, NOW)).toBe('Closed · opens tomorrow at 11:00 am');
    expect(restaurantCardLabel(r, presentHalal(r.halal), NOW)).toContain('Closed, opens tomorrow at 11:00 am.');
  });
});

describe('meta lines (ported from #634)', () => {
  it('drops a cuisine named Halal and adds the price band', () => {
    expect(cuisineLine(zaytoun)).toBe('Levantine · Grill · $$');
    expect(cuisineLine({ cuisines: [], price_band: null })).toBeNull();
  });

  it('joins whichever of time and distance the server sent', () => {
    expect(etaDistance(zaytoun.availability)).toBe('25–35 min · 1.8 km');
    expect(etaDistance({ state: 'OPEN', distance_m: null, eta_min_minutes: 20, eta_max_minutes: 20 })).toBe('20 min');
    expect(etaDistance({ state: 'OPEN', distance_m: null })).toBeNull();
  });

  it('phrases the next opening today, tomorrow, or on a weekday', () => {
    expect(opensPhrase('2026-10-09T23:30:00Z', NOW)).toBe('opens at 7:30 pm');
    expect(opensPhrase('2026-10-10T15:00:00Z', NOW)).toBe('opens tomorrow at 11:00 am');
    expect(opensPhrase('2026-10-12T15:00:00Z', NOW)).toBe('opens Monday at 11:00 am');
    expect(opensPhrase(null, NOW)).toBeNull();
  });

  it('never renders an unknown or paused verdict as open', () => {
    expect(unavailableLabel({ state: 'PAUSED', distance_m: null }, NOW)).toBe('Not taking orders right now');
    expect(unavailableLabel({ state: 'SOMETHING' as never, distance_m: null }, NOW)).toBe('Not taking orders right now');
    expect(unavailableLabel({ state: 'OPEN', distance_m: null }, NOW)).toBeNull();
  });
});

describe('addresses', () => {
  const addresses = payloadOf<Address[]>('addresses_list');

  it('titles and labels addresses the way the switcher draws them', () => {
    expect(addressTitle(addresses[0]!)).toBe('Home · 88 Harbour Street');
    expect(addressTitle(addresses[2]!)).toBe('2 Bloor Street West');
    expect(addressOptionLabel(addresses[0]!)).toBe('Home (default) · 88 Harbour Street');
    expect(addressOptionDescription(addresses[0]!)).toBe('Unit 4211, Toronto, ON M5J 0C3');
    expect(addressOptionDescription({ ...addresses[0]!, unit: '402' })).toBe('Unit 402, Toronto, ON M5J 0C3');
    expect(addressOptionDescription(addresses[2]!)).toBe('Toronto, ON M4W 3E2');
  });

  it("resolves the session's choice, then the default, never the first in the list", () => {
    expect(resolveDeliveryAddress(addresses, null, null)?.label).toBe('Home');
    expect(resolveDeliveryAddress(addresses, null, addresses[1]!.id)?.label).toBe('Work');
    expect(resolveDeliveryAddress(addresses, null, 'gone')?.label).toBe('Home');
    const noDefault = addresses.map((a) => ({ ...a, is_default: false }));
    expect(resolveDeliveryAddress(noDefault, addresses[2]!.id, null)?.line1).toBe('2 Bloor Street West');
    expect(resolveDeliveryAddress(noDefault, null, null)).toBeNull();
  });
});
