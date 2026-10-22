/**
 * What's new in the restaurant console (settings boards `WhatsNew-*`; issue 101): the panel that
 * opens once after an update, its lists and states, the account menu's marker, and the Settings
 * section. The release notes are a lazily loaded file, so each test hands the store its own loader.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { consoleRoutes, installFakeApi } from '../../test/fakeApi';
import { renderRedesign } from '../../test/render';
import { APP_VERSION, type Release } from '../releaseNotes';
import { LAST_SEEN_KEY, resetWhatsNew, setReleaseNotesLoader } from '../store';

const NOTES: Release[] = [
  { version: APP_VERSION, date: '2026-10-22', notes: [{ title: 'Newest thing', body: 'It is the newest.' }, { title: 'Second thing', body: 'Also new.' }] },
  { version: '0.9.0', date: '2026-10-01', notes: [{ title: 'Older thing', body: 'Before that.' }] },
  { version: '0.8.0', date: '2026-09-01', notes: [{ title: 'Oldest thing', body: 'Long ago.' }] },
];

const routes = () =>
  consoleRoutes({
    'GET /v1/restaurant/profile': 'restaurant_profile_halal_certified',
    'GET /v1/restaurant/documents': 'restaurant_document_pack_complete',
    'GET /v1/restaurant/hours': 'restaurant_hours_standard',
  });

beforeEach(() => {
  window.localStorage.clear();
  installFakeApi(routes());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function load(releases: unknown = NOTES) {
  setReleaseNotesLoader(() => Promise.resolve(releases));
  resetWhatsNew();
}

const panel = () => screen.queryByTestId('whats-new-panel');
const seen = () => window.localStorage.getItem(LAST_SEEN_KEY);

async function openAccountMenu() {
  fireEvent.click(await screen.findByRole('button', { name: /^Account/ }));
  return screen.getByRole('menu', { name: 'Account' });
}

describe('the panel after an update', () => {
  it('opens by itself on a device that has seen no notes, with the newest release only, and marks it seen', async () => {
    load();
    await renderRedesign('/orders/history');
    const open = await screen.findByTestId('whats-new-panel');
    expect(within(open).getByRole('heading', { level: 2, name: "What's new since you last looked" })).toBeTruthy();
    expect(within(open).getAllByTestId('whats-new-release').map((r) => r.getAttribute('data-version'))).toEqual([APP_VERSION]);
    expect(open.textContent).toContain('Newest thing.');
    await waitFor(() => expect(seen()).toBe(APP_VERSION));
    // The list it opened with does not change under the owner.
    expect(within(open).getAllByTestId('whats-new-release')).toHaveLength(1);
  });

  it('lists every release since the last-seen version, newest first, each marked New to you', async () => {
    window.localStorage.setItem(LAST_SEEN_KEY, '0.8.0');
    load();
    await renderRedesign('/orders/history');
    const open = await screen.findByTestId('whats-new-panel');
    expect(open.textContent).toContain('Two updates since you last looked. Newest first.');
    expect(within(open).getAllByTestId('whats-new-release').map((r) => r.getAttribute('data-version'))).toEqual([APP_VERSION, '0.9.0']);
    expect(within(open).getAllByText('New to you')).toHaveLength(2);
  });

  it('does not open for a device that has seen this version', async () => {
    window.localStorage.setItem(LAST_SEEN_KEY, APP_VERSION);
    load();
    await renderRedesign('/orders/history');
    await screen.findByTestId('console-rail');
    await act(async () => {});
    expect(panel()).toBeNull();
  });

  it('closes with Got it and does not come back', async () => {
    load();
    await renderRedesign('/orders/history');
    await screen.findByTestId('whats-new-panel');
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(panel()).toBeNull();
    await act(async () => {});
    expect(panel()).toBeNull();
  });

  it('closes with Close what\'s new', async () => {
    load();
    await renderRedesign('/orders/history');
    await screen.findByTestId('whats-new-panel');
    fireEvent.click(screen.getByRole('button', { name: "Close what's new" }));
    expect(panel()).toBeNull();
  });

  it('waits behind a panel the owner already has open, and opens when it closes', async () => {
    load();
    await renderRedesign('/orders/history?panel=health');
    await screen.findByTestId('health-panel');
    await act(async () => {});
    expect(panel()).toBeNull();
    // The account menu says there are notes meanwhile.
    const menu = await openAccountMenu();
    expect(within(menu).getByRole('menuitem', { name: "What's new · new notes" })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close screen health' }));
    expect(await screen.findByTestId('whats-new-panel')).toBeTruthy();
  });

  it('shows nothing by itself when the device cannot store anything, and the menu still opens it', async () => {
    const read = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (this === window.localStorage && key === LAST_SEEN_KEY) throw new DOMException('blocked', 'SecurityError');
      return read.call(this, key);
    });
    load();
    await renderRedesign('/orders/history');
    await screen.findByTestId('console-rail');
    await act(async () => {});
    expect(panel()).toBeNull();
    const menu = await openAccountMenu();
    const item = within(menu).getByRole('menuitem', { name: "What's new" });
    fireEvent.click(item);
    const open = await screen.findByTestId('whats-new-panel');
    expect(await within(open).findAllByTestId('whats-new-release')).toHaveLength(1);
  });
});

describe('the account menu', () => {
  it('opens What\'s new once it has been seen and says the owner is up to date', async () => {
    window.localStorage.setItem(LAST_SEEN_KEY, APP_VERSION);
    load();
    await renderRedesign('/orders/history');
    await act(async () => {});
    const menu = await openAccountMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: "What's new" }));
    const open = await screen.findByTestId('whats-new-panel');
    expect(await within(open).findByText("You're up to date")).toBeTruthy();
    expect(open.textContent).toContain(`You're on version ${APP_VERSION} and you've seen its notes.`);
    expect(within(open).queryByRole('button', { name: 'Got it' })).toBeNull();
  });
});

describe('the panel when the notes are not ready', () => {
  it('loading: draws a busy placeholder and marks nothing seen', async () => {
    setReleaseNotesLoader(() => new Promise(() => undefined));
    resetWhatsNew();
    await renderRedesign('/orders/history?panel=whats-new');
    const open = await screen.findByTestId('whats-new-panel');
    expect(within(open).getByTestId('whats-new-loading').getAttribute('aria-busy')).toBe('true');
    expect(seen()).toBeNull();
  });

  it('error: says so, leaves the version unseen, and Try again loads the notes', async () => {
    let attempts = 0;
    setReleaseNotesLoader(() => (attempts++ === 0 ? Promise.reject(new Error('chunk failed')) : Promise.resolve(NOTES)));
    resetWhatsNew();
    await renderRedesign('/orders/history?panel=whats-new');
    const open = await screen.findByTestId('whats-new-panel');
    expect(await within(open).findByText("Couldn't load the release notes")).toBeTruthy();
    expect(open.textContent).toContain("This doesn't affect your orders or your account.");
    expect(seen()).toBeNull();
    fireEvent.click(within(open).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(within(screen.getByTestId('whats-new-panel')).getAllByTestId('whats-new-release').length).toBeGreaterThan(0));
    await waitFor(() => expect(seen()).toBe(APP_VERSION));
  });

  it('error: a file that is not a list is unreadable too', async () => {
    load({ not: 'a list' });
    await renderRedesign('/orders/history?panel=whats-new');
    expect(await screen.findByText("Couldn't load the release notes")).toBeTruthy();
  });
});

describe('Settings, What\'s new', () => {
  it('is the last section, with the version under its name', async () => {
    window.localStorage.setItem(LAST_SEEN_KEY, APP_VERSION);
    load();
    await renderRedesign('/settings/whatsnew');
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' });
    const items = within(nav).getAllByRole('button');
    expect(items[items.length - 1]?.textContent).toContain("What's new");
    expect(items[items.length - 1]?.getAttribute('aria-current')).toBe('page');
    await waitFor(() => expect(items[items.length - 1]?.textContent).toContain(`Version ${APP_VERSION}`));
  });

  it('lists every release, newest first, with no New to you marks', async () => {
    window.localStorage.setItem(LAST_SEEN_KEY, APP_VERSION);
    load();
    await renderRedesign('/settings/whatsnew');
    const section = await screen.findByTestId('section-whats-new');
    const list = await within(section).findByTestId('whats-new-list');
    expect(list.getAttribute('data-mode')).toBe('all');
    expect(within(list).getAllByTestId('whats-new-release').map((r) => r.getAttribute('data-version'))).toEqual([APP_VERSION, '0.9.0', '0.8.0']);
    expect(within(list).queryByText('New to you')).toBeNull();
    expect(list.textContent).toContain(`You're on version ${APP_VERSION}. Every update, newest first.`);
  });

  it('loading, empty and error are the state of the bundled file', async () => {
    window.localStorage.setItem(LAST_SEEN_KEY, APP_VERSION);
    setReleaseNotesLoader(() => new Promise(() => undefined));
    resetWhatsNew();
    await renderRedesign('/settings/whatsnew');
    expect(await screen.findByTestId('whats-new-loading')).toBeTruthy();
    cleanup();

    load([]);
    await renderRedesign('/settings/whatsnew');
    expect(await screen.findByTestId('whats-new-up-to-date')).toBeTruthy();
    cleanup();

    setReleaseNotesLoader(() => Promise.reject(new Error('offline')));
    resetWhatsNew();
    await renderRedesign('/settings/whatsnew');
    expect(await screen.findByTestId('whats-new-error')).toBeTruthy();
  });
});
