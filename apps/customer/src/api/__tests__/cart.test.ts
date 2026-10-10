/**
 * The add-to-cart request, over the wire (G-3, #628). A line is identifiers and quantities only:
 * the item, a quantity, one chosen variant per variant group as `variant_ids`, and add-ons by id.
 * Never a price, and never the deprecated single `variant_id` (sending both is a 422). Reorder
 * replays a past order's chosen variants and add-ons the same way, without the prices the order
 * line carries.
 */
import orderCompleted from '../../../../../contracts/fixtures/orders/order_completed.json';
import cartSingleLine from '../../../../../contracts/fixtures/cart/cart_single_line.json';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const urlOf = (input: RequestInfo | URL) => (input instanceof Request ? input.url : String(input));

// The api client reads `globalThis.fetch` once, when client.ts is first imported, so the spy is
// installed before that require and kept for the whole file (see client.test.ts).
const fetchSpy = jest.spyOn(globalThis, 'fetch');
const { addToCart } = require('../cart') as typeof import('../cart');
const { reorder } = require('../orders') as typeof import('../orders');

const ALLOWED_LINE_KEYS = ['menu_item_id', 'quantity', 'variant_ids', 'addons', 'special_request'];

/** Every `POST /v1/cart/lines` body sent, parsed. */
async function postedLines(): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (const [input] of fetchSpy.mock.calls) {
    if (
      input instanceof Request &&
      input.method === 'POST' &&
      urlOf(input).endsWith('/v1/cart/lines')
    ) {
      out.push(JSON.parse(await input.clone().text()) as Record<string, unknown>);
    }
  }
  return out;
}

function expectNoPrice(body: Record<string, unknown>): void {
  expect(Object.keys(body).every((k) => ALLOWED_LINE_KEYS.includes(k))).toBe(true);
  expect(JSON.stringify(body)).not.toMatch(/price|cents|total/i);
  expect(body).not.toHaveProperty('variant_id');
}

afterEach(() => fetchSpy.mockReset());
afterAll(() => fetchSpy.mockRestore());

test('addToCart sends variant_ids and add-on ids, never a price, even if the caller holds one', async () => {
  fetchSpy.mockImplementation(async () => json(200, { data: cartSingleLine.payload }));

  // A caller that carelessly passes extra fields cannot smuggle them into the request.
  const careless = {
    menu_item_id: 'e3723319-f51b-42f0-a693-8c9eb954bb0f',
    quantity: 2,
    variant_ids: ['da43f4c3-9c6d-484a-a7f2-9c67b3ef436d', 'e2356a21-bfc9-4205-afcd-794d251b9e48'],
    addons: [{ addon_id: '3bc085fa-3dfa-44c5-a514-e2237fd764fe', quantity: 1, price_cents: 199 }],
    unit_price_cents: 1,
  } as unknown as Parameters<typeof addToCart>[0];
  await addToCart(careless);

  const [body] = await postedLines();
  expect(body).toEqual({
    menu_item_id: 'e3723319-f51b-42f0-a693-8c9eb954bb0f',
    quantity: 2,
    variant_ids: ['da43f4c3-9c6d-484a-a7f2-9c67b3ef436d', 'e2356a21-bfc9-4205-afcd-794d251b9e48'],
    addons: [{ addon_id: '3bc085fa-3dfa-44c5-a514-e2237fd764fe', quantity: 1 }],
  });
  expectNoPrice(body!);
});

test('a dish with no choices goes as the item id and a quantity alone', async () => {
  fetchSpy.mockImplementation(async () => json(200, { data: cartSingleLine.payload }));
  await addToCart({ menu_item_id: 'e3723319-f51b-42f0-a693-8c9eb954bb0f', quantity: 1 });
  const [body] = await postedLines();
  expect(body).toEqual({ menu_item_id: 'e3723319-f51b-42f0-a693-8c9eb954bb0f', quantity: 1 });
});

test('reorder replays each line’s variants and add-ons by id, without the order’s prices', async () => {
  fetchSpy.mockImplementation(async (input) => {
    const url = urlOf(input as RequestInfo);
    if (url.includes('/v1/orders/')) return json(200, { data: orderCompleted.payload });
    if (url.endsWith('/v1/cart/lines')) return json(200, { data: cartSingleLine.payload });
    throw new Error(`unexpected fetch: ${url}`);
  });

  const { failedLines } = await reorder(orderCompleted.payload.id);
  expect(failedLines).toEqual([]);

  const bodies = await postedLines();
  expect(bodies).toEqual([
    { menu_item_id: 'e3723319-f51b-42f0-a693-8c9eb954bb0f', quantity: 1 },
    {
      menu_item_id: '260778de-cee3-4a79-ad10-f79f5e9ab98e',
      quantity: 1,
      variant_ids: ['e2b1737f-75fc-43ed-af76-4bcfbb941301'],
    },
    {
      menu_item_id: '456616ee-e1fc-4a94-aa83-3b1c726ff23d',
      quantity: 1,
      addons: [{ addon_id: '8e05bcf1-8b4f-4578-ac6d-92f90d1cdf6f', quantity: 2 }],
    },
  ]);
  bodies.forEach(expectNoPrice);
});
