/**
 * WP4 rules without UI: the menu item's accessible name, dietary badges, hours and the
 * availability verdicts.
 */
import { formatWallClock, formatWallClockRange } from '../../lib/time';
import { payloadOf } from '../../test/mockApi';
import {
  availabilityBanner,
  dietaryBadges,
  hoursRows,
  hoursSummary,
  isUnlisted,
  menuItemAccessibleName,
  opensPhrase,
  selectedAddress,
  visibleCategories,
  type MenuItem,
} from '../restaurant';

const item = (patch: Partial<MenuItem>): MenuItem => ({
  ...(payloadOf('menu_full').categories[0].items[0] as MenuItem),
  ...patch,
});

describe('menu rows', () => {
  it('names a dish the way the board does', () => {
    expect(
      menuItemAccessibleName(
        item({ name: 'Mixed charcoal grill', price_cents: 2499 as never, dietary_tags: ['HALAL_CERTIFIED'], allergen_tags: ['WHEAT_TRITICALE', 'SESAME', 'EGGS'] }),
      ),
    ).toBe('Mixed charcoal grill, 24 dollars and 99 cents. Contains wheat, sesame, eggs.');
  });

  it('never makes HALAL_CERTIFIED a dietary badge', () => {
    expect(dietaryBadges(['HALAL_CERTIFIED'])).toEqual([]);
    expect(dietaryBadges(['VEGETARIAN', 'HALAL_CERTIFIED', 'VEGAN'])).toEqual(['Vegetarian', 'Vegan']);
  });

  it('lists AVAILABLE and OUT_OF_STOCK only, and drops empty categories', () => {
    const menu = payloadOf('menu_full');
    const hiddenOnly = { ...menu.categories[0], id: 'c-hidden', items: [{ ...menu.categories[0].items[0], availability_state: 'HIDDEN' }] };
    const blocked = { ...menu.categories[1], items: menu.categories[1].items.map((i: MenuItem) => ({ ...i, availability_state: 'BLOCKED' })) };
    const out = visibleCategories({ ...menu, categories: [hiddenOnly, blocked, menu.categories[2]] });
    expect(out.map((c) => c.name)).toEqual(['Desserts']);
    expect(out[0]!.items.map((i) => i.availability_state)).toEqual(['AVAILABLE', 'AVAILABLE', 'OUT_OF_STOCK']);
  });
});

describe('hours', () => {
  it('formats wall-clock times as written', () => {
    expect(formatWallClock('00:30')).toBe('12:30 am');
    expect(formatWallClock('12:00')).toBe('12:00 pm');
    expect(formatWallClockRange('11:00', '22:00')).toBe('11:00 am–10:00 pm');
    expect(formatWallClockRange('11:00', '01:00')).toBe('11:00 am–1:00 am');
  });

  it('marks today in the restaurant zone and lists Monday first', () => {
    const detail = payloadOf('restaurant_detail_certified');
    // Monday 10 Aug 2026, 11:30 pm in Toronto (already Tuesday in UTC).
    const now = Date.parse('2026-08-11T03:30:00Z');
    expect(hoursSummary(detail, now)).toBe('Opening hours · today 11:00 am–10:00 pm');
    const rows = hoursRows(detail, now);
    expect(rows[0]).toEqual({ day: 1, label: 'Monday (today)', range: '11:00 am–10:00 pm', today: true });
    expect(rows[6]!.label).toBe('Sunday');
  });
});

describe('availability', () => {
  const now = Date.parse('2026-08-10T18:00:00Z');

  it('says when a closed kitchen opens', () => {
    expect(opensPhrase('2026-08-10T22:00:00Z', now)).toBe('opens at 6:00 pm');
    expect(opensPhrase('2026-08-11T15:00:00Z', now)).toBe('opens tomorrow at 11:00 am');
    expect(opensPhrase('2026-08-14T17:00:00Z', now)).toBe('opens Friday at 1:00 pm');
  });

  it('has no banner when OPEN, and treats an unknown verdict as not open', () => {
    const detail = payloadOf('restaurant_detail_certified');
    expect(availabilityBanner(detail, null, now)).toBeNull();
    const unknown = { ...detail, availability: { ...detail.availability, state: 'SOMETHING_NEW' } };
    expect(availabilityBanner(unknown, null, now)?.title).toBe('Not taking orders right now');
  });

  it('judges against the cart\'s selected address, else the default, never the first', () => {
    const addresses = payloadOf('addresses_list');
    expect(selectedAddress({ delivery_address_id: addresses[1].id } as never, addresses)?.label).toBe('Work');
    expect(selectedAddress(null, addresses)?.label).toBe('Home');
    expect(selectedAddress(null, addresses.map((a: { is_default: boolean }) => ({ ...a, is_default: false })))).toBeNull();
  });
});

describe('listing', () => {
  it('treats EXPIRED and UNVERIFIED as not listed', () => {
    expect(isUnlisted(payloadOf('restaurant_detail_certified'))).toBe(false);
    expect(isUnlisted(payloadOf('restaurant_detail_expiring_soon'))).toBe(false);
    expect(isUnlisted(payloadOf('restaurant_detail_expired'))).toBe(true);
    expect(isUnlisted(payloadOf('restaurant_detail_unverified'))).toBe(true);
  });
});
