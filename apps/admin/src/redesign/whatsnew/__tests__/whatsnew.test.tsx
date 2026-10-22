/**
 * What's new in the admin console (boards `ASS/WhatsNew*`; issue 102): the update notice, "Not now",
 * the panel and its states, the New label, the queue behind a panel with unsent input, focus on
 * return, and a device whose storage is blocked.
 *
 * The release notes are a lazily loaded file, so each test hands the store its own loader.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetAuthMemory } from '../../auth/memory';
import { resetQueueDepth } from '../../realtime/queueDepth';
import { RedesignApp } from '../../app/RedesignRoot';
import { FakeRealtimeSocket, mockApi, renderRedesign, resetSession } from '../../testing';
import { APP_VERSION, type Release } from '../releaseNotes';
import { holdNotice, LAST_SEEN_KEY, OPENED_KEY, resetWhatsNew, setReleaseNotesLoader } from '../store';

const NOTES: Release[] = [
  { version: APP_VERSION, date: '2026-10-22', notes: [{ title: 'Newest thing', body: 'It is the newest.' }, { title: 'Second thing', body: 'Also new.' }] },
  { version: '0.9.0', date: '2026-10-01', notes: [{ title: 'Older thing', body: 'Before that.' }] },
  { version: '0.8.0', date: '2026-09-01', notes: [{ title: 'Oldest thing', body: 'Long ago.' }] },
];

const trigger = () => screen.getByRole('button', { name: /^What's new/ });
const notice = () => screen.queryByRole('region', { name: 'Console update' });
const panel = () => screen.queryByTestId('whats-new-panel');

beforeEach(() => {
  window.localStorage.clear();
  sessionStorage.clear();
  resetQueueDepth();
  resetAuthMemory();
  mockApi();
});

afterEach(() => {
  cleanup();
  resetSession();
  resetQueueDepth();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function load(releases: unknown = NOTES) {
  setReleaseNotesLoader(() => Promise.resolve(releases));
  resetWhatsNew();
}

function renderApp(principal: 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT_AGENT' = 'SUPER_ADMIN') {
  return renderRedesign(<RedesignApp pathname="/" createSocket={(url: string) => new FakeRealtimeSocket(url)} />, { route: '/account', principal });
}

describe('the update notice', () => {
  it('names the current version only on a device that has not stored a last-seen version', async () => {
    load();
    renderApp();
    const region = await screen.findByRole('region', { name: 'Console update' });
    expect(region.textContent).toContain(`The admin console is on version ${APP_VERSION}.`);
    expect(region.textContent).not.toContain('since you last looked');
    expect(trigger().textContent).toContain('New');
  });

  it('counts the versions since the one this device last saw', async () => {
    window.localStorage.setItem(LAST_SEEN_KEY, '0.8.0');
    load();
    renderApp();
    const region = await screen.findByRole('region', { name: 'Console update' });
    expect(region.textContent).toContain(`The admin console was updated to console version ${APP_VERSION}.`);
    expect(region.textContent).toContain('2 versions since you last looked.');
  });

  it('says "1 version" for one', async () => {
    window.localStorage.setItem(LAST_SEEN_KEY, '0.9.0');
    load();
    renderApp();
    expect((await screen.findByRole('region', { name: 'Console update' })).textContent).toContain('1 version since you last looked.');
  });

  it('does not show when the device has already seen this version', async () => {
    window.localStorage.setItem(LAST_SEEN_KEY, APP_VERSION);
    window.localStorage.setItem(OPENED_KEY, APP_VERSION);
    load();
    renderApp();
    await waitFor(() => expect(trigger()).toBeTruthy());
    await act(async () => {});
    expect(notice()).toBeNull();
    expect(trigger().textContent).not.toContain('New');
  });

  it('"Not now" stores the version, drops the notice and keeps the New label; it does not come back', async () => {
    load();
    const first = renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(notice()).toBeNull();
    expect(window.localStorage.getItem(LAST_SEEN_KEY)).toBe(APP_VERSION);
    expect(window.localStorage.getItem(OPENED_KEY)).toBeNull();
    expect(trigger().textContent).toContain('New');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');

    // Signed in again later (a fresh page): no notice, the label stays.
    first.unmount();
    resetWhatsNew();
    renderApp();
    await waitFor(() => expect(trigger().textContent).toContain('New'));
    expect(notice()).toBeNull();
  });

  it('waits while a panel with unsent input is open, and shows when it closes', async () => {
    load();
    // After `load()`, which resets the store (and so any hold taken before it).
    const release = holdNotice();
    renderApp();
    await waitFor(() => expect(trigger().textContent).toContain('New'));
    expect(notice()).toBeNull();
    act(() => release());
    expect(await screen.findByRole('region', { name: 'Console update' })).toBeTruthy();
  });

  it('shows nothing by itself when the device cannot store anything, and What\'s new still opens', async () => {
    const read = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (this === window.localStorage) throw new DOMException('blocked', 'SecurityError');
      return read.call(this, key);
    });
    load();
    renderApp();
    await act(async () => {});
    expect(notice()).toBeNull();
    expect(trigger().textContent).not.toContain('New');
    fireEvent.click(trigger());
    const open = await screen.findByTestId('whats-new-panel');
    expect(await within(open).findAllByTestId('whats-new-release')).toHaveLength(1);
  });
});

describe('the panel', () => {
  it('opens from "See what\'s new" with the releases since the last-seen version, marks them seen and clears the label', async () => {
    window.localStorage.setItem(LAST_SEEN_KEY, '0.8.0');
    load();
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: /See what's new/ }));
    const open = await screen.findByTestId('whats-new-panel');
    expect(within(open).getByRole('heading', { level: 2, name: "What's new" })).toBeTruthy();
    expect(open.textContent).toContain('You last looked on console version 0.8.0.');
    expect(open.textContent).toContain("Here's what changed since, newest first.");
    const versions = within(open).getAllByTestId('whats-new-release').map((r) => r.getAttribute('data-version'));
    expect(versions).toEqual([APP_VERSION, '0.9.0']);
    expect(within(open).getAllByText('New')).toHaveLength(2);
    expect(open.textContent).toContain('Newest thing.');
    await waitFor(() => expect(window.localStorage.getItem(OPENED_KEY)).toBe(APP_VERSION));
    expect(window.localStorage.getItem(LAST_SEEN_KEY)).toBe(APP_VERSION);
    expect(notice()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().textContent).not.toContain('New');
    // The panel still lists what it opened with.
    expect(within(open).getAllByTestId('whats-new-release')).toHaveLength(2);
  });

  it('on a first device lists only the newest release', async () => {
    load();
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: /See what's new/ }));
    const open = await screen.findByTestId('whats-new-panel');
    expect(within(open).getAllByTestId('whats-new-release').map((r) => r.getAttribute('data-version'))).toEqual([APP_VERSION]);
  });

  it('reopened with nothing new says so and lists every release without a New label', async () => {
    window.localStorage.setItem(LAST_SEEN_KEY, APP_VERSION);
    window.localStorage.setItem(OPENED_KEY, APP_VERSION);
    load();
    renderApp();
    await waitFor(() => expect(trigger()).toBeTruthy());
    await act(async () => {});
    fireEvent.click(trigger());
    const open = await screen.findByTestId('whats-new-panel');
    expect(open.textContent).toContain("You're up to date");
    expect(open.textContent).toContain(`You're on console version ${APP_VERSION}. Earlier updates are below.`);
    expect(within(open).getAllByTestId('whats-new-release')).toHaveLength(3);
    expect(within(open).queryByText('New')).toBeNull();
  });

  it('closes with Done, Close or Escape and puts focus back on the sidebar button', async () => {
    load();
    renderApp();
    await screen.findByRole('region', { name: 'Console update' });
    for (const close of [
      () => fireEvent.click(screen.getByRole('button', { name: 'Done' })),
      () => fireEvent.click(screen.getByRole('button', { name: 'Close' })),
      () => fireEvent.keyDown(screen.getByRole('heading', { name: "What's new" }), { key: 'Escape' }),
    ]) {
      trigger().focus();
      fireEvent.click(trigger());
      await screen.findByTestId('whats-new-panel');
      expect(trigger().getAttribute('aria-expanded')).toBe('true');
      close();
      expect(panel()).toBeNull();
      expect(trigger().getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(trigger());
    }
  });

  it('moves focus to its heading when it opens', async () => {
    load();
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: /See what's new/ }));
    const open = await screen.findByTestId('whats-new-panel');
    await waitFor(() => expect(document.activeElement).toBe(within(open).getByRole('heading', { name: "What's new" })));
  });

  it('shows the readable notes for a role, with the role named', async () => {
    window.localStorage.setItem(LAST_SEEN_KEY, '0.8.0');
    load([
      { version: APP_VERSION, date: '2026-10-22', notes: [{ title: 'For everyone', body: 'x' }, { title: 'Staff list', body: 'y', roles: ['SUPER_ADMIN'] }] },
      { version: '0.9.0', date: '2026-10-01', notes: [{ title: 'Super only', body: 'z', roles: ['SUPER_ADMIN'] }] },
    ]);
    renderApp('SUPPORT_AGENT');
    fireEvent.click(await screen.findByRole('button', { name: /See what's new/ }));
    const open = await screen.findByTestId('whats-new-panel');
    expect(open.textContent).toContain('Showing changes for support agents, newest first.');
    expect(open.textContent).toContain('For everyone.');
    expect(open.textContent).not.toContain('Staff list');
    expect(within(open).getAllByTestId('whats-new-release')).toHaveLength(1);
  });

  it('says it is offline but the notes still show', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    load();
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: /See what's new/ }));
    const open = await screen.findByTestId('whats-new-panel');
    expect(open.textContent).toContain("You're offline, but these notes come with the app, so they still show.");
    expect(within(open).getAllByTestId('whats-new-release').length).toBeGreaterThan(0);
  });
});

describe('the panel when the notes are not ready', () => {
  it('loading: says so, shows no label, and marks nothing seen', async () => {
    setReleaseNotesLoader(() => new Promise(() => undefined));
    resetWhatsNew();
    renderApp();
    await act(async () => {});
    fireEvent.click(trigger());
    const open = await screen.findByTestId('whats-new-panel');
    expect(within(open).getByRole('status').textContent).toBe('Loading notes…');
    expect(within(open).queryByRole('button', { name: 'Done' })).toBeNull();
    expect(window.localStorage.getItem(OPENED_KEY)).toBeNull();
  });

  it('empty: says there are no notes yet and what version this is', async () => {
    load([]);
    renderApp();
    await act(async () => {});
    fireEvent.click(trigger());
    const open = await screen.findByTestId('whats-new-panel');
    expect(await within(open).findByText('No release notes yet')).toBeTruthy();
    expect(open.textContent).toContain(`You're on console version ${APP_VERSION}. Notes appear here after the next update.`);
  });

  it('error: names the version, keeps the version unseen, and Try again loads the notes', async () => {
    let attempts = 0;
    setReleaseNotesLoader(() => (attempts++ === 0 ? Promise.reject(new Error('chunk failed')) : Promise.resolve(NOTES)));
    resetWhatsNew();
    renderApp();
    await act(async () => {});
    fireEvent.click(trigger());
    const open = await screen.findByTestId('whats-new-panel');
    expect(await within(open).findByText("The release notes couldn't be read")).toBeTruthy();
    expect(open.textContent).toContain(`You're on console version ${APP_VERSION}. We'll show the notes the next time they load.`);
    expect(window.localStorage.getItem(OPENED_KEY)).toBeNull();
    expect(notice()).toBeNull();
    fireEvent.click(within(open).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(within(screen.getByTestId('whats-new-panel')).getAllByTestId('whats-new-release').length).toBeGreaterThan(0));
    await waitFor(() => expect(window.localStorage.getItem(OPENED_KEY)).toBe(APP_VERSION));
  });

  it('error: a file that is not a list is unreadable too', async () => {
    load({ not: 'a list' });
    renderApp();
    await act(async () => {});
    fireEvent.click(trigger());
    expect(await screen.findByText("The release notes couldn't be read")).toBeTruthy();
  });
});
