/**
 * Test data for the Menu screen: an `OwnedMenu` covering every row state, built from the
 * contract's own fixtures and patched (the "OwnedMenu covering every row state" fixture is
 * requested in #676; contract fixtures are generated, so it is not hand-written there).
 */
import { fixture } from '../test/fakeApi';

let seq = 0;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixtures are JSON; tests patch them freely
type Json = any;

/** An approved, available item named `name` (from `menu_item_marked_out_of_stock_until`). */
export function item(name: string, categoryId: string, patch: Json = {}): Json {
  const base = fixture('menu_item_marked_out_of_stock_until');
  const id = uuid(1000 + ++seq);
  const live = { ...base.live_version, id: uuid(5000 + seq), menu_item_id: id, name, dietary_tags: ['SPICY'], allergen_tags: ['WHEAT_TRITICALE'] };
  return {
    ...base,
    id,
    name,
    category_id: categoryId,
    availability_state: 'AVAILABLE',
    out_of_stock_until: null,
    dietary_tags: ['SPICY'],
    variant_groups: [],
    addon_groups: [],
    live_version: live,
    pending_version: null,
    sort_order: seq,
    ...patch,
  };
}

export function version(name: string, patch: Json = {}): Json {
  const base = fixture('menu_item_marked_out_of_stock_until').live_version;
  return { ...base, id: uuid(7000 + ++seq), name, review_status: 'PENDING_REVIEW', submitted_at: '2026-09-27T18:05:00.000Z', reviewed_at: null, ...patch };
}

export function category(name: string, items: Json[], patch: Json = {}): Json {
  const c = fixture('menu_category_created');
  return { ...c, name, items, is_active: true, ...patch };
}

export const IDS = {
  mains: uuid(1),
  drinks: uuid(2),
  catering: uuid(3),
  desserts: uuid(4),
  wraps: uuid(5),
};

/** Every row state the grid draws. Future ends are relative to `now`. */
export function richMenu(now = Date.now()): Json {
  seq = 0;
  const inAnHour = new Date(now + 60 * 60 * 1000).toISOString();
  const groups = fixture('menu_item_many_variants_and_addons');
  const mains = [
    item('Beef kofta plate', IDS.mains, { price_cents: 1895, variant_groups: groups.variant_groups.slice(0, 1), addon_groups: groups.addon_groups.slice(0, 1) }),
    item('Chicken shawarma', IDS.mains, { pending_version: version('Chicken shawarma wrap') }),
    item('Lamb mandi', IDS.mains, { availability_state: 'OUT_OF_STOCK', out_of_stock_until: inAnHour }),
    item('Mixed grill', IDS.mains, { availability_state: 'OUT_OF_STOCK', out_of_stock_until: null }),
    item('Falafel plate', IDS.mains, { availability_state: 'BLOCKED' }),
    item('Fish curry', IDS.mains, {
      pending_version: version('Fish curry', {
        review_status: 'REJECTED',
        rejection_reason_code: 'UNSUBSTANTIATED_HALAL_CLAIM',
        review_note: 'Remove “zabiha certified” from the description.',
        reviewed_at: '2026-09-26T15:00:00.000Z',
        description: 'Zabiha certified fish curry.',
      }),
    }),
  ];
  const drinks = [
    item('Mango lassi', IDS.drinks, { availability_state: 'OUT_OF_STOCK', out_of_stock_until: null }),
    item('Mint lemonade', IDS.drinks, { availability_state: 'OUT_OF_STOCK', out_of_stock_until: inAnHour }),
  ];
  const catering = [item('Party tray', IDS.catering, { availability_state: 'HIDDEN' })];
  const wraps = [item('Halloumi wrap', IDS.wraps, { live_version: null, pending_version: version('Halloumi wrap') })];
  return {
    restaurant_id: fixture('restaurant_profile').id,
    categories: [
      category('Mains', mains, { id: IDS.mains, sort_order: 1 }),
      category('Drinks', drinks, { id: IDS.drinks, sort_order: 2 }),
      category('Catering', catering, { id: IDS.catering, sort_order: 3, is_active: false }),
      category('Desserts', [], { id: IDS.desserts, sort_order: 4 }),
      category('Wraps', wraps, { id: IDS.wraps, sort_order: 5 }),
    ],
  };
}

/** Find an item by name in a menu built by `richMenu`. */
export function byName(menu: Json, name: string): Json {
  for (const c of menu.categories) for (const i of c.items) if (i.name === name) return i;
  throw new Error(`no item ${name}`);
}
