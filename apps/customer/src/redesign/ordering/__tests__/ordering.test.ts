/**
 * WP5 rules without UI (ported from #634/#649 `itemSelection`/`addErrors` and #639 `lines`):
 * what the add request carries, the header price rule, the add-error map, line options from
 * `variants[]`, and which board the cart is on.
 */
import { HgApiError } from '@hg/api-client';

import { payloadOf } from '../../test/mockApi';
import { classifyAddError, differentRestaurantCopy, failureCopy, replaceFailedCopy } from '../addErrors';
import {
  addonLegend,
  blockReason,
  chooseVariant,
  headerPrice,
  initialSelection,
  lineToCartLineInput,
  sameLine,
  selectionFromLine,
  setQuantity,
  toCartLineInput,
  toggleAddon,
  type MenuItem,
} from '../itemSelection';
import { blockedLinesNotice, canQuote, cartHalal, cartState, closedUntil, lineOptions, priceChange } from '../lines';

const MENU = payloadOf('menu_full');
const items: MenuItem[] = MENU.categories.flatMap((c: { items: MenuItem[] }) => c.items);
const PLATTER = items.find((i) => i.name === 'Mixed Charcoal Grill Platter')!;
const NIHARI = items.find((i) => i.name === 'Beef Nihari')!;

/** Every key anywhere in a value, to prove no money field rides along. */
function keysOf(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysOf(v, out);
    }
  }
  return out;
}

const MONEY = /price|cents|total|amount|subtotal|fee|tax/i;

function apiError(status: number, code: string, details?: unknown): HgApiError {
  return new HgApiError(status, { error: { code, message: code, request_id: 'T', details } } as never);
}

describe('the add request never carries a price', () => {
  it('sends ids, quantities and the note only, one variant per group', () => {
    let sel = initialSelection(PLATTER);
    sel = toggleAddon(sel, PLATTER.addon_groups![1]!, '8db167ea-0291-44f2-aee3-dd9770e9a263');
    sel = setQuantity(sel, 3);
    sel = { ...sel, specialRequest: '  no coriander  ' };
    const input = toCartLineInput(PLATTER, sel);
    expect(keysOf(input).filter((k) => MONEY.test(k))).toEqual([]);
    expect(input).toEqual({
      menu_item_id: PLATTER.id,
      quantity: 3,
      variant_ids: [
        'da43f4c3-9c6d-484a-a7f2-9c67b3ef436d',
        'e2356a21-bfc9-4205-afcd-794d251b9e48',
        'f0a8c100-0dd8-43f8-a6cb-5a4583f24b03',
      ],
      addons: [{ addon_id: '8db167ea-0291-44f2-aee3-dd9770e9a263', quantity: 1 }],
      special_request: 'no coriander',
    });
  });

  it('Undo re-adds a line by ids only', () => {
    const line = payloadOf('cart_many_lines').lines[0];
    const input = lineToCartLineInput(line);
    expect(keysOf(input).filter((k) => MONEY.test(k))).toEqual([]);
    expect(input.variant_ids).toHaveLength(3);
    expect(input.addons).toEqual([
      { addon_id: expect.any(String), quantity: 4 },
      { addon_id: expect.any(String), quantity: 2 },
      { addon_id: expect.any(String), quantity: 1 },
    ]);
  });
});

describe('selection', () => {
  it('pre-selects only an available default, never an add-on', () => {
    const sel = initialSelection(PLATTER);
    expect(Object.values(sel.variants)).toEqual([
      'da43f4c3-9c6d-484a-a7f2-9c67b3ef436d',
      'e2356a21-bfc9-4205-afcd-794d251b9e48',
      'f0a8c100-0dd8-43f8-a6cb-5a4583f24b03',
    ]);
    expect(Object.values(sel.addons).flat()).toEqual([]);
    const noDefault = { ...NIHARI, variant_groups: [{ ...NIHARI.variant_groups![0]!, variants: NIHARI.variant_groups![0]!.variants.map((v) => ({ ...v, is_default: false })) }] };
    expect(Object.values(initialSelection(noDefault).variants)).toEqual([null]);
  });

  it('refuses an add-on past max_select and keeps quantity in 1–20', () => {
    const meal = PLATTER.addon_groups!.find((g) => g.name === 'Make it a meal')!;
    let sel = initialSelection(PLATTER);
    for (const a of meal.addons) sel = toggleAddon(sel, meal, a.id);
    expect(sel.addons[meal.id]).toHaveLength(2);
    expect(setQuantity(sel, 25).quantity).toBe(20);
    expect(setQuantity(sel, 0).quantity).toBe(1);
  });

  it('reads a cart line back for the edit sheet', () => {
    const line = payloadOf('cart_multi_variant_line').lines[0];
    const sel = selectionFromLine(PLATTER, line);
    expect(sameLine(toCartLineInput(PLATTER, sel), lineToCartLineInput(line))).toBe(true);
  });
});

describe('header price: ABSOLUTE vs DELTA', () => {
  it('ABSOLUTE: the chosen variant replaces the base, no "From"', () => {
    let sel = initialSelection(NIHARI);
    expect(headerPrice(NIHARI, sel)).toEqual({ cents: 2145, from: false });
    sel = chooseVariant(sel, NIHARI.variant_groups![0]!.id, 'e2b1737f-75fc-43ed-af76-4bcfbb941301');
    expect(headerPrice(NIHARI, sel)).toEqual({ cents: 3695, from: false });
  });

  it('DELTA: "From" + the base, unchanged when an option is chosen (never base + delta)', () => {
    const wrap: MenuItem = {
      ...NIHARI,
      price_cents: 1099 as never,
      variant_groups: [
        {
          id: 'g',
          name: 'Size',
          required: true,
          variants: [
            { id: 'r', name: 'Regular', pricing_mode: 'DELTA', delta_cents: 0 as never, is_default: true, is_available: true },
            { id: 'l', name: 'Large', pricing_mode: 'DELTA', delta_cents: 250 as never, is_default: false, is_available: true },
          ],
        },
      ],
    };
    let sel = initialSelection(wrap);
    expect(headerPrice(wrap, sel)).toEqual({ cents: 1099, from: true });
    sel = chooseVariant(sel, 'g', 'l');
    expect(headerPrice(wrap, sel)).toEqual({ cents: 1099, from: true });
  });
});

describe('why Add is off', () => {
  it('names the first gap in the order the controls are met', () => {
    const noDefault = { ...NIHARI, variant_groups: [{ ...NIHARI.variant_groups![0]!, variants: NIHARI.variant_groups![0]!.variants.map((v) => ({ ...v, is_default: false })) }] };
    expect(blockReason(noDefault, initialSelection(noDefault))).toBe('Choose a portion to add this to your cart');
    expect(blockReason(PLATTER, initialSelection(PLATTER))).toBe('Choose at least 1 chutneys and sauces to add this to your cart');
    const lassi = items.find((i) => i.availability_state === 'OUT_OF_STOCK')!;
    expect(blockReason(lassi, initialSelection(lassi))).toBe('Mango Lassi is out of stock.');
    expect(blockReason(lassi, initialSelection(lassi), '7:30 pm')).toBe("Mango Lassi is out of stock. It's back at 7:30 pm.");
  });

  it('legends follow the boards', () => {
    const extras = { id: 'x', name: 'Extras', min_select: 0, max_select: 2, addons: [] };
    expect(addonLegend(extras, 0)).toBe('Extras · choose up to 2');
    expect(addonLegend(extras, 2)).toBe('Extras · 2 of 2 chosen');
    expect(addonLegend({ ...extras, name: 'Sauce', min_select: 1 }, 0)).toBe('Sauce (required) · choose 1 or 2');
  });
});

describe('every add error maps to its board', () => {
  const ctx = { itemName: 'Mixed charcoal grill', restaurantName: 'Zaytoun Grill' };
  it.each([
    ['DIFFERENT_RESTAURANT', 409, 'differentRestaurant'],
    ['VARIANT_UNAVAILABLE', 409, 'variantUnavailable'],
    ['ADDON_UNAVAILABLE', 409, 'addonUnavailable'],
    ['RESTAURANT_CLOSED', 409, 'restaurantClosed'],
    ['RESTAURANT_UNAVAILABLE', 409, 'restaurantUnavailable'],
    ['ITEM_UNAVAILABLE', 409, 'itemUnavailable'],
    ['ITEM_DELETED', 409, 'gone'],
    ['NO_LIVE_MENU_ITEM', 409, 'gone'],
    ['ITEM_BLOCKED_BY_ADMIN', 409, 'gone'],
    ['VALIDATION_FAILED', 422, 'invalid'],
    ['INVALID_ADDON', 422, 'invalid'],
    ['UNKNOWN_FIELD', 422, 'invalid'],
    ['ORDERING_PAUSED', 409, 'orderingPaused'],
    ['INTERNAL_ERROR', 500, 'other'],
  ])('%s (%i) → %s', (code, status, kind) => {
    expect(classifyAddError(apiError(status, code)).kind).toBe(kind);
  });

  it('a transport failure is offline', () => {
    expect(classifyAddError(new TypeError('Network request failed')).kind).toBe('offline');
  });

  it('copy: never a halal cause for an unavailable restaurant; variant and add-on named', () => {
    expect(failureCopy({ kind: 'restaurantUnavailable' }, ctx)).toEqual({
      icon: 'info',
      title: "Zaytoun Grill can't take orders right now",
      body: "Nothing was added and your cart hasn't changed.",
    });
    expect(failureCopy({ kind: 'variantUnavailable', variantId: 'v' }, { ...ctx, groupName: 'Size', variantName: 'For two' })).toEqual({
      icon: 'warning',
      title: '"For two" just sold out',
      body: "Nothing was added and your cart hasn't changed. Choose another size.",
    });
    expect(failureCopy({ kind: 'addonUnavailable', addonId: 'a' }, { ...ctx, addonName: 'Extra garlic sauce' }).title).toBe(
      'Extra garlic sauce just ran out',
    );
    expect(failureCopy({ kind: 'restaurantClosed' }, { ...ctx, opensSentence: 'It opens tomorrow at 11:00 am.' })).toEqual({
      icon: 'clock',
      title: 'Zaytoun Grill just closed',
      body: "Nothing was added and your cart hasn't changed. It opens tomorrow at 11:00 am.",
    });
  });

  it('DIFFERENT_RESTAURANT reads the restaurant and item count from details', () => {
    const f = classifyAddError(apiError(409, 'DIFFERENT_RESTAURANT', payloadOf('error_different_restaurant').error.details));
    expect(f).toEqual({ kind: 'differentRestaurant', restaurantName: 'Karachi Kitchen', itemCount: 4 });
    expect(differentRestaurantCopy({ name: 'Karahi House', count: 2 })).toBe(
      'Your cart has 2 items from Karahi House. A cart holds one restaurant at a time, so starting a new cart removes them.',
    );
    expect(replaceFailedCopy({ name: 'Karahi House', count: 2 })).toBe('Your Karahi House cart is unchanged (2 items). Try again, or keep that cart.');
  });
});

describe('cart lines and states', () => {
  it('lines render variants[] as "group: variant" joined with " · "', () => {
    const line = payloadOf('cart_multi_variant_line').lines[0];
    expect(lineOptions(line)).toBe('Platter size: For two · Rice: No rice · Heat level: Medium · Mint raita × 1');
  });

  it('was/now only from two server values', () => {
    const karahi = payloadOf('cart_has_unavailable_items').lines[2];
    expect(priceChange(karahi)).toEqual({ was: 1899, now: 2099, up: true });
    expect(priceChange(payloadOf('cart_has_unavailable_items').lines[0])).toBeNull();
  });

  it('a lapsed certificate (EXPIRED) is its own state; a missing restaurant is "unavailable" with no cause', () => {
    const lapsed = payloadOf('cart_restaurant_unavailable');
    expect(cartHalal(lapsed)).toBe('lapsed');
    expect(cartState(lapsed, null)).toEqual({ kind: 'certLapsed' });
    expect(cartState({ ...lapsed, restaurant: null }, null)).toEqual({ kind: 'restaurantUnavailable' });
  });

  it('below the minimum comes only from blocking_reasons, never a comparison', () => {
    const below = payloadOf('cart_single_line');
    expect(cartState(below, null)).toEqual({ kind: 'belowMinimum' });
    // A subtotal under the minimum with no BELOW_MINIMUM_ORDER is not "below the minimum".
    const quiet = { ...below, blocking_reasons: [], is_quotable: true, indicative_subtotal_cents: 100 };
    expect(cartState(quiet, null)).toEqual({ kind: 'ready' });
    expect(canQuote(quiet, cartState(quiet, null))).toBe(true);
  });

  it('unavailable lines: remove first, then a sold-out size, then an extra', () => {
    const cart = payloadOf('cart_has_unavailable_items');
    const s = cartState(cart, null);
    if (s.kind !== 'linesBlocked') throw new Error(`expected linesBlocked, got ${s.kind}`);
    expect(s.lines.map((l) => l.name)).toEqual(['Beef Nihari']);
    expect(blockedLinesNotice(s.lines)).toEqual({
      title: '1 item is out of stock',
      description: "Remove it to continue — we don't change your cart without asking.",
      footer: 'Beef Nihari is out of stock. Remove it to check out.',
      action: 'Remove Beef Nihari',
    });
  });

  it('"closed until" from the opening phrase', () => {
    expect(closedUntil('opens tomorrow at 11:00 am')).toBe("It's closed until tomorrow at 11:00 am.");
    expect(closedUntil('opens at 6:00 pm')).toBe("It's closed until 6:00 pm.");
    expect(closedUntil(null)).toBeNull();
  });
});
