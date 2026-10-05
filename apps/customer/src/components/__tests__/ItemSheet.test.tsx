/**
 * The item sheet's three load-bearing rules, against the real fetch → render wiring:
 *
 *  1. `409 DIFFERENT_RESTAURANT` is a decision, not an error: "Start a new cart" sends the
 *     same line again with `replace=true` — one call, never clear-then-add (C-20).
 *  2. A required add-on group blocks Add, with the reason shown, until it is satisfied (C-16).
 *  3. The add request never carries a price: ids, quantities and the note only (G-3).
 */
import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import menuFull from '../../../../../contracts/fixtures/catalogue/menu_full.json';
import cartSingleLine from '../../../../../contracts/fixtures/cart/cart_single_line.json';

jest.mock('react-native-safe-area-context', () => {
  const mod = require('react-native-safe-area-context/jest/mock');
  return mod.default ?? mod;
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// See DiscoveryScreen.test.tsx: one persistent spy, installed before the client is imported.
const fetchSpy = jest.spyOn(globalThis, 'fetch');
afterAll(() => fetchSpy.mockRestore());

const { ItemSheet } = require('../ItemSheet') as typeof import('../ItemSheet');
const { ThemeProvider } = require('@hg/ui-native') as typeof import('@hg/ui-native');

type Item = import('../../ordering/itemSelection').MenuItem;
const items = menuFull.payload.categories.flatMap((c) => c.items) as unknown as Item[];
const byName = (n: string): Item => items.find((i) => i.name === n)!;

const OPEN = {
  state: 'OPEN',
  distance_m: 1200,
  eta_min_minutes: 25,
  eta_max_minutes: 40,
} as const;

interface Sent {
  url: string;
  body: Record<string, unknown>;
}

/** Records every POST to /v1/cart/lines and answers with `respond`. */
function stubCart(respond: (s: Sent, n: number) => Response): Sent[] {
  const sent: Sent[] = [];
  fetchSpy.mockImplementation(async (input) => {
    const req = input as Request;
    if (req.method === 'POST' && req.url.includes('/v1/cart/lines')) {
      const s = { url: req.url, body: JSON.parse(await req.clone().text()) };
      sent.push(s);
      return respond(s, sent.length);
    }
    throw new Error(`unexpected fetch: ${req.method} ${req.url}`);
  });
  return sent;
}

function renderSheet(item: Item, onAdded = jest.fn()) {
  render(
    <ThemeProvider theme="customer" scheme="light">
      <ItemSheet
        item={item}
        restaurant={{ name: 'Karachi Kitchen', availability: OPEN as never }}
        onClose={jest.fn()}
        onAdded={onAdded}
        onAddAddress={jest.fn()}
        onChangeAddress={jest.fn()}
        onFindOpen={jest.fn()}
      />
    </ThemeProvider>,
  );
  return onAdded;
}

/** Every key anywhere in the request, so a price nested in an add-on is caught too. */
function keysOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(keysOf);
  if (v && typeof v === 'object') {
    return Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]);
  }
  return [];
}

describe('ItemSheet', () => {
  it('offers "Start a new cart" on DIFFERENT_RESTAURANT and replaces in one call with replace=true', async () => {
    const sent = stubCart((_s, n) =>
      n === 1
        ? json(409, {
            error: {
              code: 'DIFFERENT_RESTAURANT',
              message: 'different',
              request_id: '01JABCDEFGHJKMNPQRSTVWXYZ0',
              details: {
                current_restaurant_id: '0192a000-0000-7000-8000-000000000001',
                current_restaurant_name: 'Al-Noor Shawarma House',
                current_line_count: 2,
              },
            },
          })
        : json(200, { data: cartSingleLine.payload }),
    );
    const onAdded = renderSheet(byName('Seekh Kebab (4 pc)'));

    fireEvent.press(screen.getByTestId('ItemSheet-add'));

    expect(
      await screen.findByText(/Your cart has 2 items from Al-Noor Shawarma House/),
    ).toBeTruthy();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).not.toContain('replace=true');

    fireEvent.press(screen.getByTestId('ItemSheet-startNewCart'));

    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    expect(sent).toHaveLength(2);
    expect(sent[1]!.url).toContain('replace=true');
    // The same line, not a cleared cart followed by a second add.
    expect(sent[1]!.body).toEqual(sent[0]!.body);
  });

  it('keeps Add disabled, with the reason shown, until a required add-on is chosen', async () => {
    const sent = stubCart(() => json(200, { data: cartSingleLine.payload }));
    const platter = byName('Lamb Shawarma Platter');
    const required: Item = {
      ...platter,
      addon_groups: platter.addon_groups!.map((g) => ({ ...g, min_select: 1 })),
    };
    const onAdded = renderSheet(required);

    expect(screen.getByTestId('ItemSheet-reason').props.children).toBe(
      'Choose at least 1 from extras to add this to your cart',
    );
    fireEvent.press(screen.getByTestId('ItemSheet-add'));
    expect(sent).toHaveLength(0);

    fireEvent.press(screen.getByText('Garlic toum'));
    expect(screen.queryByTestId('ItemSheet-reason')).toBeNull();

    fireEvent.press(screen.getByTestId('ItemSheet-add'));
    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    const addon = platter.addon_groups![0]!.addons.find((a) => a.name === 'Garlic toum')!;
    expect(sent[0]!.body.addons).toEqual([{ addon_id: addon.id, quantity: 1 }]);
  });

  it('never sends a price: the request is ids, quantities and the note only', async () => {
    const sent = stubCart(() => json(200, { data: cartSingleLine.payload }));
    const onAdded = renderSheet(byName('Beef Nihari'));

    fireEvent.press(screen.getByText('Full'));
    fireEvent.changeText(screen.getByTestId('ItemSheet-special-field'), 'No coriander');
    fireEvent.press(screen.getByTestId('ItemSheet-add'));

    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    const keys = keysOf(sent[0]!.body);
    expect(keys.filter((k) => /price|cents|total|amount/i.test(k))).toEqual([]);
    expect(new Set(keys)).toEqual(
      new Set(['menu_item_id', 'quantity', 'variant_id', 'special_request']),
    );
    expect(sent[0]!.body.special_request).toBe('No coriander');
  });
});
