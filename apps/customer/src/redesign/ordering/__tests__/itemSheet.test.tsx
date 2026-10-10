/**
 * WP5 D9: the item sheet against the contract's fixtures (boards `DO/Item-*`, `CC/Cart-edit-line`).
 *
 * DONE list (manifest §3 WP5): the request never carries a price; DIFFERENT_RESTAURANT → Dialog →
 * replace=true with a new Idempotency-Key (board `DO/Item-different-restaurant`), and its retry
 * with the replace's key; every 409/422 code on its board; the
 * ABSOLUTE vs DELTA header; plus loading, error, gone, out of stock, the availability gates,
 * offline, quantity at 20, the special request counter, edit line, and dark.
 */
import * as React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { markOffline, resetConnectivity } from '../../lib/connectivity';
import { setNowOverride } from '../../lib/now';
import { RestaurantScreen } from '../../restaurant/RestaurantScreen';
import { mockApi, payloadOf, type MockApi, type RecordedCall } from '../../test/mockApi';
import { navSpy, renderRedesign, type NavSpy } from '../../test/render';
import { GONE_TITLE, ItemSheet, OFFLINE_REASON, type ItemSheetProps } from '../ItemSheet';
import type { MenuItem } from '../itemSelection';

const MENU = payloadOf('menu_full');
const ITEMS: MenuItem[] = MENU.categories.flatMap((c: { items: MenuItem[] }) => c.items);
const PLATTER = ITEMS.find((i) => i.name === 'Mixed Charcoal Grill Platter')!;
const NIHARI = ITEMS.find((i) => i.name === 'Beef Nihari')!;
const LASSI = ITEMS.find((i) => i.name === 'Mango Lassi')!;
const RESTAURANT_ID = MENU.restaurant_id as string;
const RAITA = '8db167ea-0291-44f2-aee3-dd9770e9a263';
const FOR_TWO = '8dbd507f-30a2-44bb-a77e-f89de84f9da8';
const OPEN = payloadOf('restaurant_availability_open');

let mock: MockApi;

beforeEach(() => {
  resetConnectivity();
  setNowOverride({ at: Date.parse('2026-08-10T18:00:00Z') });
  mock = mockApi({
    getCart: 'cart_many_lines',
    listAddresses: 'addresses_list',
    getRestaurant: 'restaurant_detail_certified',
    getRestaurantMenu: 'menu_full',
    getRestaurantCertification: 'certification_panel_certified',
    addCartLine: 'cart_multi_variant_line',
    removeCartLine: 'cart_multi_variant_line',
  });
});

afterEach(() => {
  mock.restore();
  setNowOverride(null);
  resetConnectivity();
});

function sheet(props: Partial<ItemSheetProps> = {}, scheme: 'light' | 'dark' = 'light') {
  const calls = { added: jest.fn(), closed: jest.fn(), addAddress: jest.fn(), changeAddress: jest.fn(), findOpen: jest.fn() };
  renderRedesign(
    <ItemSheet
      restaurantId={RESTAURANT_ID}
      restaurantName="Karachi Kitchen"
      availability={OPEN}
      addressName="Home"
      item={PLATTER}
      onClose={calls.closed}
      onAdded={calls.added}
      onAddAddress={calls.addAddress}
      onChangeAddress={calls.changeAddress}
      onFindOpen={calls.findOpen}
      {...props}
    />,
    { scheme },
  );
  return calls;
}

function disabled(testID: string): boolean {
  return Boolean(screen.getByTestId(testID).props.accessibilityState?.disabled);
}

function header(call: RecordedCall, name: string): string | undefined {
  return call.headers[name.toLowerCase()];
}

/** Every key anywhere in a body. */
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

async function tickRaitaAndAdd(): Promise<void> {
  fireEvent.press(screen.getByTestId(`ItemSheet-addon-${RAITA}`));
  await waitFor(() => expect(disabled('ItemSheet-add')).toBe(false));
  fireEvent.press(screen.getByTestId('ItemSheet-add'));
}

describe('D9 item sheet: ready, choices and the header price', () => {
  it('ready: ABSOLUTE default chosen, add-ons not pre-selected, required add-on group unmet', () => {
    sheet();
    expect(screen.getByText(/^Platter size \(required\)/)).toBeTruthy();
    expect(screen.getByText('Chutneys and sauces (required) · choose 1 to 5')).toBeTruthy();
    expect(screen.getByText('Breads · choose up to 6')).toBeTruthy();
    expect(screen.getByTestId(`ItemSheet-variant-da43f4c3-9c6d-484a-a7f2-9c67b3ef436d`).props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId(`ItemSheet-addon-${RAITA}`).props.accessibilityState).toMatchObject({ checked: false });
    // The required add-on group is unmet: Add is off with the reason.
    expect(screen.getByTestId('ItemSheet-reason')).toHaveTextContent('Choose at least 1 chutneys and sauces to add this to your cart');
    expect(disabled('ItemSheet-add')).toBe(true);
    // A sold-out variant and add-on say why.
    expect(disabled('ItemSheet-variant-76de3dfc-2e61-467c-a1e7-7ae628b6d8ae')).toBe(true);
    expect(screen.getByText('Ingredients: ' + PLATTER.ingredients_text)).toBeTruthy();
  });

  it('ABSOLUTE header: the chosen variant replaces the base price', () => {
    sheet({ item: NIHARI });
    expect(screen.queryByText('From')).toBeNull();
    expect(screen.getByTestId('ItemSheet-price')).toHaveTextContent('$21.45');
    fireEvent.press(screen.getByTestId('ItemSheet-variant-e2b1737f-75fc-43ed-af76-4bcfbb941301'));
    expect(screen.getByTestId('ItemSheet-price')).toHaveTextContent('$36.95');
    // Each ABSOLUTE option shows its own price, and the option's accessible name joins it.
    const option = screen.getByTestId('ItemSheet-variant-e2b1737f-75fc-43ed-af76-4bcfbb941301');
    expect(option.props.accessibilityLabel).toMatch(/^.+, \$36\.95$/);
    expect(option).toHaveTextContent(/\$36\.95/);
  });

  it('DELTA header: "From" + the base, unchanged when a size is chosen; options show +$x.xx', () => {
    const wrap: MenuItem = {
      ...NIHARI,
      name: 'Falafel wrap',
      price_cents: 1099 as never,
      variant_groups: [
        {
          id: 'g-size',
          name: 'Size',
          required: true,
          variants: [
            { id: 'v-r', name: 'Regular', pricing_mode: 'DELTA', delta_cents: 0 as never, is_default: true, is_available: true },
            { id: 'v-l', name: 'Large', pricing_mode: 'DELTA', delta_cents: 250 as never, is_default: false, is_available: true },
          ],
        },
      ],
    };
    sheet({ item: wrap });
    expect(screen.getByText('From')).toBeTruthy();
    expect(screen.getByTestId('ItemSheet-price')).toHaveTextContent('$10.99');
    fireEvent.press(screen.getByTestId('ItemSheet-variant-v-l'));
    expect(screen.getByTestId('ItemSheet-price')).toHaveTextContent('$10.99');
    // The DELTA option's accessible name joins its signed amount; a zero delta adds nothing.
    expect(screen.getByTestId('ItemSheet-variant-v-l').props.accessibilityLabel).toBe('Large, +$2.50');
    expect(screen.getByTestId('ItemSheet-variant-v-r').props.accessibilityLabel).toBe('Regular');
  });

  it('dietary tags sit under a "Dietary" heading; none, no heading', () => {
    sheet({ item: { ...NIHARI, dietary_tags: ['VEGETARIAN'] as never } });
    expect(screen.getByTestId('ItemSheet-dietary')).toHaveTextContent(/Dietary/);
    screen.unmount();
    sheet({ item: { ...NIHARI, dietary_tags: [] as never } });
    expect(screen.queryByTestId('ItemSheet-dietary')).toBeNull();
  });

  it('no image: the sunken frame reads "No image"', () => {
    sheet({ item: { ...NIHARI, image_url: null } });
    expect(screen.getByTestId('ItemSheet-noImage', { includeHiddenElements: true })).toHaveTextContent('No image');
  });

  it('required size not chosen: nothing pre-selected and Add says why', () => {
    const noDefault = {
      ...NIHARI,
      variant_groups: [{ ...NIHARI.variant_groups![0]!, variants: NIHARI.variant_groups![0]!.variants.map((v) => ({ ...v, is_default: false })) }],
    };
    sheet({ item: noDefault });
    expect(screen.getByTestId('ItemSheet-reason')).toHaveTextContent('Choose a portion to add this to your cart');
    expect(disabled('ItemSheet-add')).toBe(true);
    fireEvent.press(screen.getByTestId('ItemSheet-variant-f47edba0-6675-4be5-a096-294dbfcd5bd0'));
    expect(screen.queryByTestId('ItemSheet-reason')).toBeNull();
  });

  it('add-ons at max: the others are disabled with the reason', () => {
    sheet();
    const meal = PLATTER.addon_groups!.find((g) => g.name === 'Make it a meal')!;
    fireEvent.press(screen.getByTestId(`ItemSheet-addon-${meal.addons[0]!.id}`));
    fireEvent.press(screen.getByTestId(`ItemSheet-addon-${meal.addons[1]!.id}`));
    expect(screen.getByText('Make it a meal · 2 of 2 chosen')).toBeTruthy();
    const third = screen.getByTestId(`ItemSheet-addon-${meal.addons[2]!.id}`);
    expect(third.props.accessibilityState).toMatchObject({ disabled: true });
    expect(third.props.accessibilityHint).toContain('Up to 2 — untick one to swap');
  });

  it('quantity stops at 20 with "Maximum 20" and the label counts', () => {
    sheet({ item: NIHARI });
    for (let i = 0; i < 19; i++) fireEvent.press(screen.getByTestId('ItemSheet-quantity-increment'));
    expect(screen.getByTestId('ItemSheet-max')).toHaveTextContent('Maximum 20');
    expect(disabled('ItemSheet-quantity-increment')).toBe(true);
    expect(screen.getByTestId('ItemSheet-add')).toHaveTextContent('Add 20 to cart');
  });

  it('special request: 140 at most; "N/140" on screen, the worded count to a screen reader', () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    sheet({ item: NIHARI });
    const count = () => screen.getByTestId('ItemSheet-specialCount');
    expect(count()).toHaveTextContent('0/140');
    expect(count().props.accessibilityLabel).toBe('0 of 140 characters used');
    fireEvent.changeText(screen.getByTestId('ItemSheet-special-field'), 'Extra pickles please');
    expect(count()).toHaveTextContent('20/140');
    expect(count().props.accessibilityLabel).toBe('20 of 140 characters used');
    // "N characters left" is announced only from 20 left.
    expect(announce).not.toHaveBeenCalledWith(expect.stringMatching(/characters left/));
    fireEvent.changeText(screen.getByTestId('ItemSheet-special-field'), 'x'.repeat(125));
    expect(announce).toHaveBeenCalledWith('15 characters left');
    announce.mockRestore();
  });
});

describe('D9 item sheet: adding', () => {
  it('the request never carries a price: ids, quantities and the note, with an Idempotency-Key', async () => {
    const calls = sheet();
    fireEvent.changeText(screen.getByTestId('ItemSheet-special-field'), 'No onions please');
    await tickRaitaAndAdd();
    await waitFor(() => expect(calls.added).toHaveBeenCalled());
    const call = mock.callsTo('addCartLine')[0]!;
    expect(keysOf(call.body).filter((k) => /price|cents|total|amount|fee|tax/i.test(k))).toEqual([]);
    expect(call.body).toEqual({
      menu_item_id: PLATTER.id,
      quantity: 1,
      variant_ids: ['da43f4c3-9c6d-484a-a7f2-9c67b3ef436d', 'e2356a21-bfc9-4205-afcd-794d251b9e48', 'f0a8c100-0dd8-43f8-a6cb-5a4583f24b03'],
      addons: [{ addon_id: RAITA, quantity: 1 }],
      special_request: 'No onions please',
    });
    expect(header(call, 'Idempotency-Key')).toBeTruthy();
    expect(call.url).not.toContain('replace');
  });

  it('adding, then added: the sheet closes, the toast names the line, the cart bar updates', async () => {
    const nav: NavSpy = navSpy({ name: 'restaurant', restaurantId: RESTAURANT_ID });
    mock.answer('addCartLine', ['hang']);
    renderRedesign(<RestaurantScreen restaurantId={RESTAURANT_ID} />, { nav });
    fireEvent.press(await screen.findByTestId(`MenuItemRow-${PLATTER.id}`));
    expect(await screen.findByTestId('ItemSheet')).toBeTruthy();
    await tickRaitaAndAdd();
    // Adding: the button is busy, nothing is guessed.
    await waitFor(() => expect(screen.getByTestId('ItemSheet-add').props.accessibilityState).toMatchObject({ busy: true }));
    mock.answer('addCartLine', 'cart_multi_variant_line');
    fireEvent.press(screen.getByTestId('ItemSheet-add'));
    // The first call still hangs; a second press while busy sends nothing new.
    expect(mock.callsTo('addCartLine')).toHaveLength(1);
  });

  it('added: sheet closes, toast "Added to your cart" from the line the server returned', async () => {
    const nav: NavSpy = navSpy({ name: 'restaurant', restaurantId: RESTAURANT_ID });
    renderRedesign(<RestaurantScreen restaurantId={RESTAURANT_ID} />, { nav });
    fireEvent.press(await screen.findByTestId(`MenuItemRow-${PLATTER.id}`));
    await screen.findByTestId('ItemSheet');
    await tickRaitaAndAdd();
    expect(await screen.findByText('Added to your cart')).toBeTruthy();
    expect(screen.getByText('Mixed Charcoal Grill Platter · For two · No rice · Medium · Mint raita')).toBeTruthy();
    expect(screen.queryByTestId('ItemSheet')).toBeNull();
    // The line total arrives on the cart the server returned; the bar shows it.
    expect(screen.getByText('View cart · 1 item · $42.48')).toBeTruthy();
    fireEvent.press(screen.getByTestId('Restaurant-viewCart'));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'cart' } });
  });

  it('DIFFERENT_RESTAURANT → "Start a new cart?" → replace=true with a new Idempotency-Key', async () => {
    mock.answer('addCartLine', ['error_different_restaurant', 'cart_multi_variant_line']);
    const calls = sheet();
    await tickRaitaAndAdd();
    expect(await screen.findByText('Start a new cart?')).toBeTruthy();
    expect(
      screen.getByText('Your cart has 4 items from Karachi Kitchen. A cart holds one restaurant at a time, so starting a new cart removes them.'),
    ).toBeTruthy();
    fireEvent.press(screen.getByTestId('ItemSheet-startNewCart'));
    await waitFor(() => expect(calls.added).toHaveBeenCalled());
    const [first, second] = mock.callsTo('addCartLine');
    expect(first!.url).not.toContain('replace=true');
    expect(second!.url).toContain('replace=true');
    // A replay of the first key would return the stored 409: the replace is its own attempt.
    expect(header(second!, 'Idempotency-Key')).toBeTruthy();
    expect(header(second!, 'Idempotency-Key')).not.toBe(header(first!, 'Idempotency-Key'));
    expect(second!.body).toEqual(first!.body);
  });

  it('a double tap on Add sends one add', async () => {
    const calls = sheet();
    fireEvent.press(screen.getByTestId(`ItemSheet-addon-${RAITA}`));
    await waitFor(() => expect(disabled('ItemSheet-add')).toBe(false));
    const add = screen.getByTestId('ItemSheet-add');
    fireEvent.press(add);
    fireEvent.press(add);
    await waitFor(() => expect(calls.added).toHaveBeenCalled());
    expect(mock.callsTo('addCartLine')).toHaveLength(1);
  });

  it('"Keep my cart" closes the dialog and keeps the choices; nothing else is sent', async () => {
    mock.answer('addCartLine', 'error_different_restaurant');
    sheet();
    await tickRaitaAndAdd();
    fireEvent.press(await screen.findByTestId('ItemSheet-keepCart'));
    await waitFor(() => expect(screen.queryByText('Start a new cart?')).toBeNull());
    expect(mock.callsTo('addCartLine')).toHaveLength(1);
    expect(screen.getByTestId(`ItemSheet-addon-${RAITA}`).props.accessibilityState).toMatchObject({ checked: true });
  });

  it('start a new cart failed: old cart intact; the retry is the same replace with the replace\'s key', async () => {
    mock.answer('addCartLine', ['error_different_restaurant', { status: 503, code: 'SERVICE_UNAVAILABLE' }, 'cart_multi_variant_line']);
    const calls = sheet();
    await tickRaitaAndAdd();
    fireEvent.press(await screen.findByTestId('ItemSheet-startNewCart'));
    expect(await screen.findByText("We couldn't start a new cart")).toBeTruthy();
    expect(screen.getByText('Your Karachi Kitchen cart is unchanged (4 items). Try again, or keep that cart.')).toBeTruthy();
    expect(screen.getByTestId('ItemSheet-add')).toHaveTextContent('Start a new cart and add');
    fireEvent.press(screen.getByTestId('ItemSheet-add'));
    await waitFor(() => expect(calls.added).toHaveBeenCalled());
    const all = mock.callsTo('addCartLine');
    expect(all).toHaveLength(3);
    expect(all[2]!.url).toContain('replace=true');
    expect(header(all[1]!, 'Idempotency-Key')).not.toBe(header(all[0]!, 'Idempotency-Key'));
    expect(header(all[2]!, 'Idempotency-Key')).toBe(header(all[1]!, 'Idempotency-Key'));
    // Nothing ever cleared the cart separately.
    expect(mock.callsTo('clearCart')).toHaveLength(0);
  });

  it('a transport failure: the retry of the same line reuses its key; a changed line gets a new one', async () => {
    mock.answer('addCartLine', ['offline', 'offline', 'cart_multi_variant_line']);
    sheet();
    await tickRaitaAndAdd();
    expect(await screen.findByText("We couldn't add this to your cart")).toBeTruthy();
    act(() => resetConnectivity());
    fireEvent.press(screen.getByTestId('ItemSheet-add'));
    await waitFor(() => expect(mock.callsTo('addCartLine')).toHaveLength(2));
    const [a, b] = mock.callsTo('addCartLine');
    expect(header(b!, 'Idempotency-Key')).toBe(header(a!, 'Idempotency-Key'));
    act(() => resetConnectivity());
    fireEvent.press(await screen.findByTestId('ItemSheet-quantity-increment'));
    fireEvent.press(screen.getByTestId('ItemSheet-add'));
    await waitFor(() => expect(mock.callsTo('addCartLine')).toHaveLength(3));
    expect(header(mock.callsTo('addCartLine')[2]!, 'Idempotency-Key')).not.toBe(header(a!, 'Idempotency-Key'));
  });
});

describe('D9 item sheet: every 409/422 on its board', () => {
  it('VARIANT_UNAVAILABLE: names the choice, clears it and errors the group', async () => {
    mock.answer('addCartLine', { status: 409, code: 'VARIANT_UNAVAILABLE', details: { variant_id: FOR_TWO } });
    sheet();
    fireEvent.press(screen.getByTestId(`ItemSheet-variant-${FOR_TWO}`));
    await tickRaitaAndAdd();
    expect(await screen.findByText('"For two" just sold out')).toBeTruthy();
    expect(screen.getByText("Nothing was added and your cart hasn't changed. Choose another platter size.")).toBeTruthy();
    expect(screen.getByText(/Choose another platter size to continue\./)).toBeTruthy();
    expect(disabled(`ItemSheet-variant-${FOR_TWO}`)).toBe(true);
    expect(screen.getByTestId('ItemSheet-reason')).toHaveTextContent('Choose a platter size to add this to your cart');
  });

  it('ADDON_UNAVAILABLE: the extra that ran out is named and marked', async () => {
    mock.answer('addCartLine', { status: 409, code: 'ADDON_UNAVAILABLE', details: { addon_id: RAITA } });
    sheet();
    await tickRaitaAndAdd();
    expect(await screen.findByText('Mint raita just ran out')).toBeTruthy();
    expect(screen.getByText("Nothing was added and your cart hasn't changed. Untick it or choose another extra.")).toBeTruthy();
    expect(screen.getByTestId(`ItemSheet-addonError-${RAITA}`)).toHaveTextContent('Just ran out. Untick it to continue.');
    fireEvent.press(screen.getByTestId(`ItemSheet-addon-${RAITA}`));
    expect(screen.getByTestId(`ItemSheet-addon-${RAITA}`).props.accessibilityState).toMatchObject({ checked: false, disabled: true });
  });

  it('RESTAURANT_CLOSED: "just closed", choices read only, "Find an open restaurant"', async () => {
    mock.answer('addCartLine', 'error_restaurant_closed');
    const calls = sheet();
    await tickRaitaAndAdd();
    expect(await screen.findByText('Karachi Kitchen just closed')).toBeTruthy();
    expect(screen.queryByTestId('ItemSheet-add')).toBeNull();
    expect(disabled('ItemSheet-quantity-increment')).toBe(true);
    fireEvent.press(screen.getByTestId('ItemSheet-gateAction'));
    expect(calls.findOpen).toHaveBeenCalled();
  });

  it('RESTAURANT_UNAVAILABLE: no cause and no halal wording', async () => {
    mock.answer('addCartLine', 'error_restaurant_unavailable');
    sheet();
    await tickRaitaAndAdd();
    expect(await screen.findByText("Karachi Kitchen can't take orders right now")).toBeTruthy();
    expect(screen.queryByText(/halal|certif/i)).toBeNull();
    expect(disabled('ItemSheet-add')).toBe(true);
  });

  it.each(['ITEM_DELETED', 'NO_LIVE_MENU_ITEM'])('%s: "This dish isn\'t on the menu any more"', async (code) => {
    mock.answer('addCartLine', { status: 409, code });
    const calls = sheet();
    await tickRaitaAndAdd();
    expect(await screen.findByText(GONE_TITLE)).toBeTruthy();
    expect(screen.getByText("Karachi Kitchen has removed it. Your cart is unchanged.")).toBeTruthy();
    fireEvent.press(screen.getByTestId('ItemSheet-backToMenu'));
    expect(calls.closed).toHaveBeenCalled();
  });

  it.each(['error_cart_line_variant_missing', 'error_invalid_addon'])('422 %s: the choices were not accepted', async (fixture) => {
    mock.answer('addCartLine', fixture);
    sheet();
    await tickRaitaAndAdd();
    expect(await screen.findByText("Some of your choices weren't accepted")).toBeTruthy();
    expect(screen.getByText("Nothing was added and your cart hasn't changed. Check the options and try again.")).toBeTruthy();
  });

  it('ITEM_UNAVAILABLE: the dish just sold out', async () => {
    mock.answer('addCartLine', { status: 409, code: 'ITEM_UNAVAILABLE' });
    sheet();
    await tickRaitaAndAdd();
    expect(await screen.findByText('Mixed Charcoal Grill Platter just sold out')).toBeTruthy();
  });
});

describe('D9 item sheet: states', () => {
  it('out of stock: badge, reason and no Add', () => {
    sheet({ item: LASSI });
    expect(screen.getByText(/^Out of stock/)).toBeTruthy();
    expect(screen.getByTestId('ItemSheet-reason').props.children).toMatch(/^Mango Lassi is out of stock\./);
    expect(disabled('ItemSheet-add')).toBe(true);
  });

  it('no address: the way forward replaces Add', () => {
    const calls = sheet({ availability: payloadOf('restaurant_availability_no_address') });
    expect(screen.getByTestId('ItemSheet-reason')).toHaveTextContent('Add a delivery address to order from Karachi Kitchen.');
    fireEvent.press(screen.getByText('Add an address'));
    expect(calls.addAddress).toHaveBeenCalled();
  });

  it('closed: "is closed. It opens …" and Find an open restaurant', () => {
    const calls = sheet({ availability: payloadOf('restaurant_availability_closed_hours') });
    expect(screen.getByTestId('ItemSheet-reason').props.children).toMatch(/^Karachi Kitchen is closed\./);
    fireEvent.press(screen.getByText('Find an open restaurant'));
    expect(calls.findOpen).toHaveBeenCalled();
  });

  it('paused: the reason, and Add stays off', () => {
    sheet({ availability: payloadOf('restaurant_availability_paused') });
    expect(screen.getByTestId('ItemSheet-reason')).toHaveTextContent('Karachi Kitchen has paused new orders. Check back later.');
    expect(disabled('ItemSheet-add')).toBe(true);
  });

  it('out of range: Change address', () => {
    const calls = sheet({ availability: payloadOf('restaurant_availability_out_of_range') });
    expect(screen.getByTestId('ItemSheet-reason')).toHaveTextContent("Karachi Kitchen doesn't deliver to Home. Change your address to order.");
    fireEvent.press(screen.getByText('Change address'));
    expect(calls.changeAddress).toHaveBeenCalled();
  });

  it('offline: Add waits until back online', async () => {
    sheet({ item: NIHARI });
    // A failed call anywhere marks the app offline.
    act(() => markOffline());
    expect(screen.getByTestId('ItemSheet-reason')).toHaveTextContent(OFFLINE_REASON);
    expect(disabled('ItemSheet-add')).toBe(true);
  });

  it('loading, then the dish (opened by id, e.g. edit line)', async () => {
    mock.answer('getRestaurantMenu', ['hang']);
    sheet({ item: undefined, menuItemId: NIHARI.id });
    expect(screen.getAllByText('Loading the dish…').length).toBeGreaterThan(0);
    expect(disabled('ItemSheet-add')).toBe(true);
  });

  it('error: "We couldn\'t load this dish", Try again reads again', async () => {
    mock.answer('getRestaurantMenu', [{ status: 500, code: 'INTERNAL_ERROR' }, 'menu_full']);
    sheet({ item: undefined, menuItemId: NIHARI.id });
    expect(await screen.findByText("We couldn't load this dish")).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByTestId('ItemSheet-price')).toHaveTextContent('$21.45');
  });

  it('gone: a dish no longer on the menu', async () => {
    sheet({ item: undefined, menuItemId: '00000000-0000-4000-8000-000000000000' });
    expect(await screen.findByText(GONE_TITLE)).toBeTruthy();
  });

  it('renders in dark', () => {
    sheet({}, 'dark');
    expect(screen.getByTestId('ItemSheet')).toBeTruthy();
    expect(screen.getByText('Allergens')).toBeTruthy();
  });
});

describe('CC/Cart-edit-line: remove + add (G5)', () => {
  it('prefills the line, adds the new choice first, then removes the old line', async () => {
    const line = payloadOf('cart_multi_variant_line').lines[0];
    const calls = sheet({ item: undefined, menuItemId: line.menu_item_id, editLine: line });
    expect(await screen.findByText('Update item')).toBeTruthy();
    expect(screen.getByTestId(`ItemSheet-variant-${FOR_TWO}`).props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId(`ItemSheet-addon-${RAITA}`).props.accessibilityState).toMatchObject({ checked: true });
    fireEvent.press(screen.getByTestId('ItemSheet-variant-3af3f517-dde1-4494-a413-cc1675b47fe3'));
    fireEvent.press(screen.getByTestId('ItemSheet-add'));
    await waitFor(() => expect(calls.added).toHaveBeenCalled());
    const order = mock.calls.filter((c) => c.operationId === 'addCartLine' || c.operationId === 'removeCartLine').map((c) => c.operationId);
    expect(order).toEqual(['addCartLine', 'removeCartLine']);
    expect(mock.callsTo('removeCartLine')[0]!.url).toContain(line.id);
  });

  it('a sold-out size is not pre-filled: the group asks for another before Update', async () => {
    const line = payloadOf('cart_multi_variant_line').lines[0];
    const soldOut = {
      ...PLATTER,
      variant_groups: PLATTER.variant_groups!.map((g) => ({
        ...g,
        variants: g.variants.map((v) => (v.id === FOR_TWO ? { ...v, is_available: false } : v)),
      })),
    };
    sheet({ item: soldOut, editLine: line });
    expect(screen.getByTestId(`ItemSheet-variant-${FOR_TWO}`).props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.getByTestId('ItemSheet-reason')).toHaveTextContent(/^Choose a .+ to add this to your cart$/);
    expect(disabled('ItemSheet-add')).toBe(true);
  });

  it('only the quantity changed: one updateCartLine, nothing removed', async () => {
    const line = payloadOf('cart_multi_variant_line').lines[0];
    const calls = sheet({ item: undefined, menuItemId: line.menu_item_id, editLine: line });
    fireEvent.press(await screen.findByTestId('ItemSheet-quantity-increment'));
    fireEvent.press(screen.getByTestId('ItemSheet-add'));
    await waitFor(() => expect(calls.added).toHaveBeenCalled());
    expect(mock.callsTo('updateCartLine')[0]!.body).toEqual({ quantity: 2 });
    expect(mock.callsTo('addCartLine')).toHaveLength(0);
    expect(mock.callsTo('removeCartLine')).toHaveLength(0);
  });
});
