import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import ownedMenu from '../../../contracts/fixtures/catalogue/owned_menu_with_pending_version.json';
import profileFixture from '../../../contracts/fixtures/onboarding/restaurant_profile.json';
import { installDomShims } from '@hg/ui-web/testing';

/**
 * The menu lock (issue #256): a suspended restaurant reads its menu but can change nothing on
 * it. The app learns that from `account_state` on the profile, before any save — so the menu
 * renders, every edit control is disabled, and one notice says why and what to do, instead of
 * the screen failing or the first save bouncing off `403 MENU_LOCKED`.
 */

function stubOk(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('restaurant menu — suspended restaurant', () => {
  beforeAll(installDomShims);

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('shows the menu read-only with the locked-menu notice', async () => {
    const writes: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (method !== 'GET') writes.push(`${method} ${url}`);
      if (url.endsWith('/v1/restaurant/menu')) return stubOk({ data: ownedMenu.payload });
      if (url.endsWith('/v1/restaurant/profile')) {
        return stubOk({ data: { ...profileFixture.payload, account_state: 'SUSPENDED' } });
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });

    const { MenuPage } = await import('../src/routes/MenuPage');
    render(<MenuPage />);

    // The menu still reads normally.
    const firstItem = ownedMenu.payload.categories[0]!.items[0]!;
    expect(await screen.findByText(firstItem.name)).toBeTruthy();

    // One notice, plain about why and what to do — and never the red "problem" banner.
    const notices = screen.getAllByTestId('menu-locked');
    expect(notices).toHaveLength(1);
    expect(notices[0]!.getAttribute('data-variant')).not.toBe('danger');
    expect(notices[0]!.textContent).toMatch(/locked while this restaurant is suspended/);
    expect(notices[0]!.textContent).toMatch(/Contact Halal Goes support/);

    // Every edit control is disabled.
    const addItem = screen.getByRole('button', { name: /Add item/ });
    expect(addItem.hasAttribute('disabled') || addItem.getAttribute('aria-disabled') === 'true').toBe(true);
    const edit = screen.getByRole('button', { name: `Edit ${firstItem.name}` });
    expect(edit.hasAttribute('disabled') || edit.getAttribute('aria-disabled') === 'true').toBe(true);
    for (const toggle of screen.getAllByRole('switch')) expect(toggle.hasAttribute('disabled')).toBe(true);

    expect(writes).toEqual([]);
  });
});
