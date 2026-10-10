/**
 * R43 What's new (HW/WhatsNew), light and dark: the sheet after an update on Home (a new device
 * sees only the latest release; a saved version sees every version since), Got it and the close
 * button both count as seen, storage that throws never breaks it, never during a delivery,
 * nothing for a version with no notes; the page reopened from Account (newest first, "New" on
 * the unseen ones, loading, empty, error).
 */
import './mocks';
import Constants from 'expo-constants';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import '../../home';
import { mockApi, type MockApi } from '../../test/mockApi';
import { SCHEMES } from '../../test/render';
import type { KeyValueStore } from '../../data/storage';
import { WHATS_NEW } from '../copy';
import { compareVersions, parseNotes, resetWhatsNew, SEEN_KEY, setReleaseNotesSource, setSeenStore, unseen } from '../whatsNew';
import { idleDashboard, renderRoute, renderSignedIn, riderOnHome, signOut } from './harness';

const NOTES = parseNotes(require('../release-notes.json'));
const config = Constants.expoConfig as { version?: string };

let api: MockApi;
beforeEach(() => {
  resetWhatsNew();
  config.version = '1.4.0';
});
afterEach(() => {
  api?.restore();
  signOut();
  config.version = '0.0.0';
});

/** Home is up and the seen-version read and the notes file have both answered. */
async function settled(): Promise<void> {
  await screen.findByTestId('tab-home');
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

/** A store that remembers writes, optionally seeded or broken. */
function store(seed: string | null, broken = false): KeyValueStore & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    async getItem(key) {
      if (broken) throw new Error('no storage');
      return key === SEEN_KEY ? seed : null;
    },
    async setItem(_key, value) {
      if (broken) throw new Error('no storage');
      writes.push(value);
    },
    async removeItem() {},
  };
}

describe('release notes', () => {
  it('orders versions and picks what is unseen', () => {
    expect(compareVersions('1.4.0', '1.3.12')).toBe(1);
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(0);
    expect(unseen(NOTES, '1.4.0', null).map((v) => v.version)).toEqual(['1.4.0']);
    expect(unseen(NOTES, '1.4.0', '1.3.1').map((v) => v.version)).toEqual(['1.4.0', '1.3.2']);
    expect(unseen(NOTES, '1.3.2', null).map((v) => v.version)).toEqual(['1.3.2']);
    expect(unseen(NOTES, '1.4.0', '1.4.0')).toEqual([]);
    expect(unseen(NOTES, '0.0.0', null)).toEqual([]);
    expect(() => parseNotes({ versions: [{ version: 1 }] })).toThrow();
  });
});

describe.each(SCHEMES)("What's new sheet (%s)", (scheme) => {
  it('a new device: only the latest release; Got it marks it seen and it does not come back', async () => {
    const s = store(null);
    setSeenStore(s);
    api = mockApi({ getRiderMe: riderOnHome(), getRiderDashboard: idleDashboard() });
    const view = renderSignedIn(scheme);
    const sheet = within(await screen.findByTestId('whats-new-sheet'));
    expect(sheet.getByText(WHATS_NEW.newIn('1.4.0'))).toBeTruthy();
    expect(sheet.getByText(WHATS_NEW.version('1.4.0'))).toBeTruthy();
    for (const n of NOTES[0]!.notes) expect(sheet.getByText(`• ${n}`)).toBeTruthy();
    expect(sheet.queryByText(WHATS_NEW.version('1.3.2'))).toBeNull();
    expect(sheet.getByText(WHATS_NEW.reread)).toBeTruthy();

    fireEvent.press(screen.getByTestId('whats-new-got-it'));
    expect(screen.queryByTestId('whats-new-sheet')).toBeNull();
    await waitFor(() => expect(s.writes).toEqual(['1.4.0']));

    view.unmount();
    renderSignedIn(scheme);
    await settled();
    expect(screen.queryByTestId('whats-new-sheet')).toBeNull();
  });

  it('a saved version: every version since it; the close button counts as seen', async () => {
    const s = store('1.3.1');
    setSeenStore(s);
    api = mockApi({ getRiderMe: riderOnHome(), getRiderDashboard: idleDashboard() });
    renderSignedIn(scheme);
    const sheet = within(await screen.findByTestId('whats-new-sheet'));
    expect(sheet.getByText(WHATS_NEW.newSince('1.3.1'))).toBeTruthy();
    expect(sheet.getByText(WHATS_NEW.version('1.4.0'))).toBeTruthy();
    expect(sheet.getByText(WHATS_NEW.version('1.3.2'))).toBeTruthy();
    expect(sheet.queryByText(WHATS_NEW.version('1.3.1'))).toBeNull();
    fireEvent.press(screen.getByLabelText(`Close ${WHATS_NEW.title}`));
    expect(screen.queryByTestId('whats-new-sheet')).toBeNull();
    await waitFor(() => expect(s.writes).toEqual(['1.4.0']));
  });

  it('no persisted storage: it still shows once, closes, and stays closed for the run', async () => {
    setSeenStore(store(null, true));
    api = mockApi({ getRiderMe: riderOnHome(), getRiderDashboard: idleDashboard() });
    const view = renderSignedIn(scheme);
    await screen.findByTestId('whats-new-sheet');
    fireEvent.press(screen.getByTestId('whats-new-got-it'));
    expect(screen.queryByTestId('whats-new-sheet')).toBeNull();
    view.unmount();
    renderSignedIn(scheme);
    await settled();
    expect(screen.queryByTestId('whats-new-sheet')).toBeNull();
  });

  it('never during a delivery: it waits', async () => {
    api = mockApi({ getRiderMe: riderOnHome({ availability_state: 'ON_DELIVERY', active_assignment_id: 'd32c6111-bbee-4947-a3db-005a8ae50058' }), getRiderDashboard: idleDashboard() });
    renderSignedIn(scheme);
    await settled();
    expect(screen.queryByTestId('whats-new-sheet')).toBeNull();
  });

  it('a version with no notes (a dev build, 0.0.0) shows nothing', async () => {
    config.version = '0.0.0';
    api = mockApi({ getRiderMe: riderOnHome(), getRiderDashboard: idleDashboard() });
    renderSignedIn(scheme);
    await settled();
    expect(screen.queryByTestId('whats-new-sheet')).toBeNull();
  });
});

describe.each(SCHEMES)("What's new page (%s)", (scheme) => {
  it('Account › What\'s new: the version, newest first, dates, "New" on the unseen one', async () => {
    api = mockApi({ getRiderMe: riderOnHome(), getRiderDashboard: idleDashboard() });
    renderRoute(scheme, 'account', undefined);
    const row = await screen.findByTestId('row-whats-new');
    expect(within(row).getByText(WHATS_NEW.onVersion('1.4.0'))).toBeTruthy();
    fireEvent.press(row);
    await screen.findByText(WHATS_NEW.pageLead('1.4.0'));
    expect(screen.getByLabelText('Back to Account')).toBeTruthy();
    for (const v of ['1.4.0', '1.3.2', '1.3.1']) expect(screen.getByTestId(`whats-new-card-${v}`)).toBeTruthy();
    expect(within(screen.getByTestId('whats-new-card-1.4.0')).getByText('Sunday 27 September 2026')).toBeTruthy();
    expect(screen.getByTestId('whats-new-fresh-1.4.0')).toBeTruthy();
    expect(screen.queryByTestId('whats-new-fresh-1.3.2')).toBeNull();
  });

  it('loading while the file is read', () => {
    setReleaseNotesSource(() => new Promise(() => {}));
    renderRoute(scheme, 'whatsNew', undefined);
    expect(screen.getByText(WHATS_NEW.loading)).toBeTruthy();
  });

  it('empty: no release notes yet', async () => {
    setReleaseNotesSource(() => ({ versions: [] }));
    renderRoute(scheme, 'whatsNew', undefined);
    await screen.findByText(WHATS_NEW.empty.title);
    expect(screen.getByText(WHATS_NEW.empty.body)).toBeTruthy();
  });

  it('an unreadable file: the error, and Try again reads it again', async () => {
    setReleaseNotesSource(() => ({ nope: true }));
    renderRoute(scheme, 'whatsNew', undefined);
    await screen.findByText(WHATS_NEW.error.title);
    expect(screen.getByText(WHATS_NEW.error.body)).toBeTruthy();
    setReleaseNotesSource(null);
    fireEvent.press(screen.getByTestId('whats-new-retry'));
    await screen.findByTestId('whats-new-card-1.4.0');
  });
});
