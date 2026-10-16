import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { fixture, fixtureMeta, mockApi, renderRedesign, resetSession } from '../../testing';
import MenuItemRoute from '../MenuItemRoute';
import MenuReviewsRoute from '../MenuReviewsRoute';
import type { Version } from '../model';

afterEach(() => {
  cleanup();
  resetSession();
  vi.unstubAllGlobals();
});

const QUEUE = 'menu_review_queue';

function renderQueue(route = '/menu-reviews') {
  return renderRedesign(
    <Routes>
      <Route path="/menu-reviews" element={<MenuReviewsRoute />} />
      <Route path="/menu-reviews/:versionId" element={<MenuReviewsRoute />} />
    </Routes>,
    { route, principal: 'ADMIN' },
  );
}

const first = () => fixture<Version[]>(QUEUE)[0]!;

describe('Menu reviews: the queue', () => {
  it('lists what waits, with the restaurant id (the name is not in the contract)', async () => {
    mockApi({ listMenuReviewQueue: QUEUE });
    renderQueue();
    const grid = await screen.findByRole('grid');
    expect(within(grid).getByText(first().name!)).toBeTruthy();
    expect(within(grid).getAllByRole('row').length).toBeGreaterThan(1);
  });

  it('draws loading, empty and error', async () => {
    mockApi({ listMenuReviewQueue: { pending: true } });
    renderQueue();
    expect(await screen.findByText('Loading menu versions')).toBeTruthy();
    cleanup();
    mockApi({ listMenuReviewQueue: 'menu_review_queue_empty' });
    renderQueue();
    expect(await screen.findByText('Nothing waiting for review')).toBeTruthy();
    cleanup();
    mockApi({ listMenuReviewQueue: { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'x', request_id: 'r' } } } });
    renderQueue();
    expect(await screen.findByText('Menu reviews didn’t load')).toBeTruthy();
  });

  it('says a version is not waiting when the link names one that is not in the queue', async () => {
    mockApi({ listMenuReviewQueue: QUEUE });
    renderQueue('/menu-reviews/00000000-0000-4000-8000-000000000000');
    expect(await screen.findByText('This version isn’t waiting for review')).toBeTruthy();
  });
});

describe('Menu reviews: deciding', () => {
  async function open(extra: Parameters<typeof mockApi>[0] = {}) {
    const api = mockApi({ listMenuReviewQueue: QUEUE, ...extra });
    renderQueue(`/menu-reviews/${first().id}`);
    const panel = await screen.findByTestId('VersionPanel');
    return { api, panel };
  }

  it('never draws the halal tag as a halal badge', async () => {
    const { panel } = await open();
    expect(within(panel).getByText(/Halal certified \(a tag, not checked here\)/)).toBeTruthy();
    expect(within(panel).getByText(/never from a menu item/)).toBeTruthy();
  });

  it('approves with a keyed request and takes the version off the queue', async () => {
    const { api, panel } = await open({ decideMenuVersion: { data: { ...first(), review_status: 'APPROVED' } } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.callsTo('decideMenuVersion')).toHaveLength(1));
    const sent = api.callsTo('decideMenuVersion')[0]!;
    expect(sent.body).toEqual({ decision: 'APPROVE' });
    expect(sent.headers['idempotency-key']).toBeTruthy();
    expect(await screen.findByText(/It is live now/)).toBeTruthy();
  });

  it('sends nothing for Other with a short note, then rejects with the reason and the note', async () => {
    const { api, panel } = await open({ decideMenuVersion: { data: { ...first(), review_status: 'REJECTED' } } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Reject…' }));
    const reject = await screen.findByRole('region', { name: /Reject version/ });
    fireEvent.change(within(reject).getByLabelText(/Reason/), { target: { value: 'OTHER' } });
    fireEvent.change(within(reject).getByLabelText(/Note to the restaurant/), { target: { value: 'too short' } });
    fireEvent.click(within(reject).getByRole('button', { name: 'Reject version' }));
    expect(await within(reject).findByText(/\d+ more\./)).toBeTruthy();
    expect(api.callsTo('decideMenuVersion')).toHaveLength(0);
    // Approve and Reject are off while the panel is open: the panel replaces them.
    expect(within(panel).queryByRole('button', { name: 'Approve' })).toBeNull();

    const note = 'Please remove the zabiha claim; the certificate covers the kitchen only.';
    fireEvent.change(within(reject).getByLabelText(/Note to the restaurant/), { target: { value: note } });
    fireEvent.click(within(reject).getByRole('button', { name: 'Reject version' }));
    await waitFor(() => expect(api.callsTo('decideMenuVersion')).toHaveLength(1));
    expect(api.callsTo('decideMenuVersion')[0]!.body).toEqual({ decision: 'REJECT', reason_code: 'OTHER', review_note: note });
  });

  it('names a decision someone else made first, and offers the way back', async () => {
    const { panel } = await open({ decideMenuVersion: 'error_menu_version_already_decided' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Someone else decided this version first')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to the queue' })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Approve' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('refuses a locked menu in slate words naming the account state, and keeps the version', async () => {
    const { panel } = await open({ decideMenuVersion: 'error_menu_locked' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Approve' }));
    const alert = await screen.findByText('This restaurant’s menu is locked');
    expect(alert).toBeTruthy();
    expect(screen.getByText(/suspended/)).toBeTruthy();
  });
});

describe('Edit a menu item on behalf of a restaurant', () => {
  const R = '3b8f7c52-2d0e-4a53-9a58-1c1f5f6c7a01';
  const I = '9d7a3e10-5b44-4d2c-8f6e-2a9c4b7d1e02';
  const path = `/restaurants/${R}/menu/items/${I}`;
  function renderItem() {
    return renderRedesign(<Route path="/restaurants/:restaurantId/menu/items/:itemId" element={<MenuItemRoute />} />, { route: path, principal: 'ADMIN' });
  }
  const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));

  it('sends only what was filled in, the price as integer cents, and shows the server’s answer', async () => {
    const saved = fixture<Record<string, unknown>>('menu_item_edited_by_admin');
    const api = mockApi({ updateMenuItemOnBehalf: { data: saved } });
    renderItem();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Chicken shawarma plate' } });
    fireEvent.change(screen.getByLabelText(/^Price/, { selector: 'input[type="text"]' }), { target: { value: '18.50' } });
    save();
    await waitFor(() => expect(api.callsTo('updateMenuItemOnBehalf')).toHaveLength(1));
    const sent = api.callsTo('updateMenuItemOnBehalf')[0]!;
    expect(sent.params).toEqual({ restaurantId: R, itemId: I });
    expect(sent.body).toEqual({ name: 'Chicken shawarma plate', price_cents: 1850 });
    expect(await screen.findByText('Saved and live')).toBeTruthy();
  });

  it('sends nothing when nothing changed', async () => {
    const api = mockApi({});
    renderItem();
    save();
    expect(await screen.findByText('Nothing to save')).toBeTruthy();
    expect(api.callsTo('updateMenuItemOnBehalf')).toHaveLength(0);
  });

  it('refuses a locked menu, with nothing written', async () => {
    mockApi({ updateMenuItemOnBehalf: 'error_menu_locked' });
    renderItem();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Chicken shawarma plate' } });
    save();
    expect(await screen.findByText('This restaurant’s menu is locked')).toBeTruthy();
  });

  it('sends the admin to menu review when the restaurant has an edit waiting', async () => {
    mockApi({ updateMenuItemOnBehalf: 'error_menu_version_pending' });
    renderItem();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Chicken shawarma plate' } });
    save();
    expect(await screen.findByText('The restaurant has an edit waiting for review')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open menu reviews' })).toBeTruthy();
  });

  it('puts a price the server refused on the price field and moves focus there', async () => {
    mockApi({ updateMenuItemOnBehalf: 'error_price_out_of_range' });
    renderItem();
    fireEvent.change(screen.getByLabelText(/^Price/, { selector: 'input[type="text"]' }), { target: { value: '18.50' } });
    save();
    await screen.findByText('1 field needs fixing. Nothing was saved.');
    await waitFor(() => expect(document.activeElement?.id).toBe('obh-price'));
  });

  it('removes the item from a panel in the page, and says it is removed', async () => {
    const api = mockApi({ deleteMenuItemOnBehalf: { status: 204 } });
    renderItem();
    fireEvent.click(screen.getByRole('button', { name: 'Remove this item…' }));
    const panel = await screen.findByRole('region', { name: /Remove this item/ });
    expect(api.callsTo('deleteMenuItemOnBehalf')).toHaveLength(0);
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Item removed')).toBeTruthy();
    expect(api.callsTo('deleteMenuItemOnBehalf')).toHaveLength(1);
  });

  it('refuses to remove from a locked menu and leaves the item', async () => {
    mockApi({ deleteMenuItemOnBehalf: 'error_menu_locked' });
    renderItem();
    fireEvent.click(screen.getByRole('button', { name: 'Remove this item…' }));
    const panel = await screen.findByRole('region', { name: /Remove this item/ });
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove' }));
    expect(await within(panel).findByText('This restaurant’s menu is locked')).toBeTruthy();
    expect(screen.queryByText('Item removed')).toBeNull();
  });
});
