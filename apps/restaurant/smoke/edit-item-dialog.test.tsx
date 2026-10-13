import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { installDomShims } from '@hg/ui-web/testing';
import type { EditableMenuItem } from '../src/components/EditItemDialog';

import ownedMenu from '../../../contracts/fixtures/catalogue/owned_menu_with_pending_version.json';
import manyVariants from '../../../contracts/fixtures/catalogue/menu_item_many_variants_and_addons.json';

/**
 * Editing a menu item. The owner types a price in dollars; the contract takes `price_cents`, an
 * integer between 50 and 50000 (`MenuItemUpdateInput`, AGENTS.md invariant #3: money is integer
 * minor units). So: the dollars → cents conversion is exact (no float drift reaches the wire),
 * out-of-range or unparseable prices never leave the browser, and `HALAL_CERTIFIED` — a
 * platform-derived claim — is neither offered nor sent (invariant #8: no optimistic halal claim).
 */

// Beef Nihari: HALAL_CERTIFIED + SPICY, WHEAT_TRITICALE, $21.45, 18 min.
// (Fixture JSON widens enums to `string`; the shapes are the contract's.)
const nihari = ownedMenu.payload.categories[0]!.items.find((i) => i.name === 'Beef Nihari')! as unknown as EditableMenuItem;
const PRICE_LABEL = 'Price (CAD)';

interface Patch {
  path: string;
  body: Record<string, unknown>;
}

/** Records every PATCH and answers it with `reply` (default: the saved item). */
function stubPatch(reply: () => Response = () => new Response(JSON.stringify({ data: nihari }), { status: 200, headers: { 'Content-Type': 'application/json' } })) {
  const patches: Patch[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(String(input));
      if (request.method !== 'PATCH') throw new Error(`unexpected fetch: ${request.method} ${request.url}`);
      patches.push({ path: new URL(request.url).pathname, body: JSON.parse(await request.clone().text()) });
      return reply();
    }),
  );
  return patches;
}

async function openDialog(item: EditableMenuItem = nihari) {
  const { EditItemDialog } = await import('../src/components/EditItemDialog');
  const props = { onClose: vi.fn(), onSaved: vi.fn(), onLocked: vi.fn() };
  const view = render(<EditItemDialog item={item} {...props} />);
  return { ...props, view };
}

const priceInput = () => screen.getByLabelText(PRICE_LABEL, { exact: false }) as HTMLInputElement;
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

describe('restaurant menu — edit item', () => {
  beforeAll(installDomShims);

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('converts the typed dollar price to exact integer cents', async () => {
    const patches = stubPatch();
    const cases: [typed: string, cents: number][] = [
      ['12.50', 1250],
      ['19.99', 1999], // 19.99 * 100 = 1998.9999999999998 in floating point
      ['4.35', 435], //   4.35 * 100 =  434.99999999999994
      ['0.50', 50], //    the contract minimum
      ['500', 50000], //  the contract maximum
      ['7', 700],
    ];

    for (const [typed, cents] of cases) {
      const { onSaved } = await openDialog();
      fireEvent.change(priceInput(), { target: { value: typed } });
      save();
      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
      const sent = patches.at(-1)!.body['price_cents'];
      expect(sent, `"${typed}"`).toBe(cents);
      expect(Number.isInteger(sent)).toBe(true);
      cleanup();
    }
    expect(patches[0]!.path).toBe(`/v1/restaurant/menu/items/${nihari.id}`);
  });

  it('pre-fills the price from cents and refuses an out-of-range or unparseable price without calling the API', async () => {
    const patches = stubPatch();
    const { onSaved } = await openDialog();
    expect(priceInput().value).toBe('21.45');

    for (const typed of ['0.49', '500.01', 'abc', '12,50', '-5']) {
      fireEvent.change(priceInput(), { target: { value: typed } });
      save();
      expect((await screen.findByRole('alert')).textContent, `"${typed}"`).toBe('Price must be between $0.50 and $500.00.');
    }
    expect(patches).toEqual([]);
    expect(onSaved).not.toHaveBeenCalled();

    // An empty price (or name) cannot be submitted at all.
    fireEvent.change(priceInput(), { target: { value: '' } });
    const button = screen.getByRole('button', { name: 'Save changes' });
    expect(button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('never offers or sends HALAL_CERTIFIED, and sends the owner-chosen tags as declared', async () => {
    const patches = stubPatch();
    const { onSaved } = await openDialog();

    // The halal claim is platform-derived: no chip for it, even though the item carries it.
    expect(screen.queryByRole('button', { name: /halal/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'SPICY' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'WHEAT TRITICALE' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'SPICY' })); // off
    fireEvent.click(screen.getByRole('button', { name: 'VEGETARIAN' })); // on
    fireEvent.click(screen.getByRole('button', { name: 'MILK' })); // allergen on
    fireEvent.change(screen.getByLabelText('Prep time (min)', { exact: false }), { target: { value: '30' } });
    save();

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const body = patches[0]!.body;
    expect(body['dietary_tags']).toEqual(['VEGETARIAN']);
    expect(body['allergen_tags']).toEqual(['WHEAT_TRITICALE', 'MILK']);
    expect(body['allergens_declared']).toBe(true);
    expect(body['prep_minutes']).toBe(30);
    expect(body['price_cents']).toBe(2145);
    expect(JSON.stringify(body)).not.toContain('HALAL');
  });

  it('hands a 403 MENU_LOCKED to the page as a lock, and shows any other refusal inline', async () => {
    stubPatch(
      () =>
        new Response(
          JSON.stringify({ error: { code: 'MENU_LOCKED', message: 'Menu locked.', request_id: 'r-1', details: { account_state: 'BANNED' } } }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const locked = await openDialog();
    save();
    await waitFor(() => expect(locked.onLocked).toHaveBeenCalledWith('BANNED'));
    expect(locked.onSaved).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();

    vi.resetModules();
    stubPatch(
      () =>
        new Response(JSON.stringify({ error: { code: 'VALIDATION_FAILED', message: 'Name is too long.', request_id: 'r-2' } }), {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const refused = await openDialog();
    save();
    expect((await screen.findByRole('alert')).textContent).toBe('Name is too long.');
    expect(refused.onSaved).not.toHaveBeenCalled();
    expect(refused.onLocked).not.toHaveBeenCalled();
  });

  it('closes without saving', async () => {
    const patches = stubPatch();
    const { onClose, onSaved } = await openDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(patches).toEqual([]);
  });

  it('shows variants read-only with their prices converted from cents', async () => {
    stubPatch();
    await openDialog({ ...nihari, variant_groups: manyVariants.payload.variant_groups as EditableMenuItem['variant_groups'] });

    expect(screen.getByText('Variants (read-only)')).not.toBeNull();
    // ABSOLUTE: the variant's own price; DELTA: the surcharge on the base price.
    expect(screen.getByText('For two (42.99)')).not.toBeNull();
    expect(screen.getByText('Kabuli pulao (+3.00)')).not.toBeNull();
  });
});
