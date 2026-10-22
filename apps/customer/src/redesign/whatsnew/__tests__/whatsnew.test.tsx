/**
 * A7 What's new (boards `AC/WhatsNew*`; issues 99 and 702): the release-notes rules, the sheet on
 * Home (once after an update, a new phone sees only the latest release, held while an order is
 * open, never without storage that survives a restart), and the page opened from Account (newest
 * first, "Your version", the empty state for a file that cannot be read).
 */
import * as React from 'react';
import { Linking } from 'react-native';
import Constants from 'expo-constants';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import bundled from '../../../release-notes.json';
import { resetConnectivity } from '../../lib/connectivity';
import { setNowOverride } from '../../lib/now';
import { HomeScreen } from '../../discover/HomeScreen';
import { resetChosenAddress } from '../../discover/deliveryAddress';
import { resetHomeCache } from '../../discover/homeData';
import { mockApi, type MockApi } from '../../test/mockApi';
import { navSpy, renderRedesign } from '../../test/render';
import { WHATS_NEW } from '../copy';
import { compareVersions, parseReleaseNotes, releaseDate, setReleaseNotesSource, unseen } from '../releaseNotes';
import { LAST_SEEN_KEY, memoryStore, resetWhatsNew, setLastSeenStore, type LastSeenStore } from '../store';
import { WhatsNewScreen } from '../WhatsNewScreen';

const FIXTURE = [
  {
    version: '1.1.0',
    date: '2026-09-04',
    notes: [{ title: 'Arrival window', body: 'Tracking shows an arrival window instead of a countdown.' }],
  },
  {
    version: '1.2.0',
    date: '2026-09-26',
    notes: [
      { title: 'Certificate details', body: "Restaurant pages show the certifying body and end date when we have them." },
      { title: 'Several addresses', body: 'Save several addresses and pick where each order goes.' },
    ],
  },
];

const config = Constants.expoConfig as { version?: string };
const BASE = {
  listAddresses: 'addresses_list',
  getCustomerProfile: 'customer_profile',
  listRestaurants: 'restaurant_list_populated',
  getCart: 'cart_empty',
  getActiveOrder: 'order_no_active',
} as const;

let mock: MockApi | undefined;

beforeEach(() => {
  resetConnectivity();
  resetHomeCache();
  resetChosenAddress();
  resetWhatsNew();
  setNowOverride({ at: Date.parse('2026-10-09T22:42:00Z') });
  setReleaseNotesSource(() => FIXTURE);
  config.version = '1.2.0';
});

afterEach(() => {
  mock?.restore();
  mock = undefined;
  setNowOverride(null);
  setReleaseNotesSource(null);
  config.version = '0.0.0';
  jest.restoreAllMocks();
});

/** A store that remembers writes, persistent unless it is broken or told otherwise. */
function store(seed: string | null, opts: { broken?: boolean; persistent?: boolean } = {}): LastSeenStore & { writes: string[] } {
  const writes: string[] = [];
  return {
    persistent: opts.persistent ?? true,
    writes,
    async getItem(key) {
      if (opts.broken) throw new Error('no storage');
      return key === LAST_SEEN_KEY ? seed : null;
    },
    async setItem(_key, value) {
      if (opts.broken) throw new Error('no storage');
      writes.push(value);
    },
  };
}

async function renderHome(answers: Record<string, unknown> = {}, scheme: 'light' | 'dark' = 'light') {
  mock = mockApi({ ...BASE, ...(answers as Record<string, never>) });
  const view = renderRedesign(<HomeScreen />, { nav: navSpy({ name: 'home' }), scheme });
  await screen.findByTestId('Home-list');
  return view;
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });

describe('release notes', () => {
  it('reads the shared file shape, newest first, skipping what is malformed', () => {
    const parsed = parseReleaseNotes([
      { version: '1.0.0', date: '2026-10-01', notes: [{ title: 'a', body: 'b' }, { title: 'only a title' }] },
      { version: 'next', date: '2026-10-02', notes: [{ title: 'x', body: 'y' }] },
      { version: '1.1.0', date: '2026-10-03', notes: [] },
      { version: '1.2.0', date: '2026-10-04', notes: [{ title: 'c', body: 'd' }] },
    ]);
    expect(parsed.map((r) => r.version)).toEqual(['1.2.0', '1.0.0']);
    expect(parsed[1]!.notes).toEqual([{ title: 'a', body: 'b' }]);
    expect(() => parseReleaseNotes({ versions: [] })).toThrow();
  });

  it('the bundled file is in that shape and its newest release is 1.0.0', () => {
    const parsed = parseReleaseNotes(bundled);
    expect(parsed[0]!.version).toBe('1.0.0');
    expect(parsed[0]!.notes.length).toBeGreaterThan(0);
  });

  it('orders versions and picks what is unseen: a new phone sees only the latest release', () => {
    const notes = parseReleaseNotes(FIXTURE);
    expect(compareVersions('1.2.0', '1.1.9')).toBe(1);
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(unseen(notes, '1.2.0', null).map((r) => r.version)).toEqual(['1.2.0']);
    expect(unseen(notes, '1.2.0', '1.0.0').map((r) => r.version)).toEqual(['1.2.0', '1.1.0']);
    expect(unseen(notes, '1.2.0', '1.2.0')).toEqual([]);
    expect(unseen(notes, '1.1.0', '1.0.0').map((r) => r.version)).toEqual(['1.1.0']);
    expect(unseen(notes, '0.0.0', null)).toEqual([]);
    expect(releaseDate('2026-09-26')).toBe('26 September 2026');
  });
});

describe.each(['light', 'dark'] as const)('What\'s new sheet on Home (%s)', (scheme) => {
  it('a new phone: the latest release only; Got it marks it seen and it does not come back', async () => {
    const s = store(null);
    setLastSeenStore(s);
    const view = await renderHome({}, scheme);
    const sheet = within(await screen.findByTestId('WhatsNew-sheet'));
    expect(sheet.getByText(WHATS_NEW.introOne)).toBeTruthy();
    expect(sheet.getByTestId('WhatsNew-version-1.2.0')).toBeTruthy();
    expect(sheet.queryByTestId('WhatsNew-version-1.1.0')).toBeNull();
    expect(sheet.getByText('Several addresses')).toBeTruthy();
    expect(sheet.getByText(WHATS_NEW.footerLine)).toBeTruthy();

    fireEvent.press(screen.getByTestId('WhatsNew-gotIt'));
    expect(screen.queryByTestId('WhatsNew-sheet')).toBeNull();
    await waitFor(() => expect(s.writes).toEqual(['1.2.0']));

    view.unmount();
    mock?.restore();
    await renderHome({}, scheme);
    await settle();
    expect(screen.queryByTestId('WhatsNew-sheet')).toBeNull();
  });

  it('a stored version: every release since it; the close button counts as seen', async () => {
    const s = store('1.0.0');
    setLastSeenStore(s);
    await renderHome({}, scheme);
    const sheet = within(await screen.findByTestId('WhatsNew-sheet'));
    expect(sheet.getByText(WHATS_NEW.introMany(2))).toBeTruthy();
    expect(sheet.getByTestId('WhatsNew-version-1.2.0')).toBeTruthy();
    expect(sheet.getByTestId('WhatsNew-version-1.1.0')).toBeTruthy();
    fireEvent.press(screen.getByLabelText(`Close ${WHATS_NEW.sheetTitle}`));
    expect(screen.queryByTestId('WhatsNew-sheet')).toBeNull();
    await waitFor(() => expect(s.writes).toEqual(['1.2.0']));
  });

  it('holds while an order is open, and shows on the next Home visit after it', async () => {
    const s = store('1.0.0');
    setLastSeenStore(s);
    const view = await renderHome({ getActiveOrder: 'order_preparing', getOrderTracking: 'tracking_preparing' }, scheme);
    await screen.findByTestId('Home-activeOrder');
    await settle();
    expect(screen.queryByTestId('WhatsNew-sheet')).toBeNull();
    expect(s.writes).toEqual([]);

    view.unmount();
    mock?.restore();
    await renderHome({}, scheme);
    await screen.findByTestId('WhatsNew-sheet');
  });
});

describe('What\'s new sheet: when it stays away', () => {
  it('without storage that survives a restart it never opens by itself', async () => {
    setLastSeenStore(memoryStore());
    await renderHome();
    await settle();
    expect(screen.queryByTestId('WhatsNew-sheet')).toBeNull();
  });

  it('storage that cannot be read: nothing by itself, and Home still works', async () => {
    setLastSeenStore(store(null, { broken: true }));
    await renderHome();
    await settle();
    expect(screen.queryByTestId('WhatsNew-sheet')).toBeNull();
    expect(screen.getByTestId('Home-list')).toBeTruthy();
  });

  it('a build with no notes of its own (a dev build, 0.0.0) shows nothing', async () => {
    config.version = '0.0.0';
    setLastSeenStore(store(null));
    await renderHome();
    await settle();
    expect(screen.queryByTestId('WhatsNew-sheet')).toBeNull();
  });
});

describe.each(['light', 'dark'] as const)('What\'s new page (%s)', (scheme) => {
  it('lists every release newest first and marks the installed version', async () => {
    const s = store('1.0.0');
    setLastSeenStore(s);
    const nav = navSpy({ name: 'whatsNew' });
    renderRedesign(<WhatsNewScreen />, { nav, scheme });
    const cards = ['WhatsNew-card-1.2.0', 'WhatsNew-card-1.1.0'].map((id) => screen.getByTestId(id));
    expect(within(cards[0]!).getByText('26 September 2026')).toBeTruthy();
    expect(within(cards[0]!).getByText(WHATS_NEW.yourVersion)).toBeTruthy();
    expect(within(cards[1]!).queryByText(WHATS_NEW.yourVersion)).toBeNull();
    expect(screen.getByText('Certificate details')).toBeTruthy();
    // Reading the page counts as seeing the notes, so Home does not repeat them.
    await waitFor(() => expect(s.writes).toEqual(['1.2.0']));
    fireEvent.press(screen.getByLabelText('Back to Account'));
    expect(nav.log.map((l) => l.action)).toEqual(['back']);
  });

  it('a file that cannot be read is the empty state, with the store listing', async () => {
    setReleaseNotesSource(() => ({ nope: true }));
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    renderRedesign(<WhatsNewScreen />, { nav: navSpy({ name: 'whatsNew' }), scheme });
    expect(screen.getByText(WHATS_NEW.empty.title)).toBeTruthy();
    expect(screen.getByText(WHATS_NEW.empty.youHave('1.2.0'))).toBeTruthy();
    fireEvent.press(screen.getByTestId('WhatsNew-store'));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('a build older than every release has nothing to show yet', () => {
    config.version = '1.0.0';
    renderRedesign(<WhatsNewScreen />, { nav: navSpy({ name: 'whatsNew' }), scheme });
    expect(screen.getByText(WHATS_NEW.empty.title)).toBeTruthy();
  });
});
