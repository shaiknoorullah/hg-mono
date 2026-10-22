/**
 * Settings, "This device" (restaurant settings, #658): the sound, notification and screen-on
 * rows against what the browser reports. Each browser answer is stubbed, because jsdom has no
 * audio, no notification permission and no wake lock of its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { consoleRoutes, installFakeApi } from '../test/fakeApi';
import { renderRedesign } from '../test/render';
import { getDevicePrefs, resetDevicePrefs, setDevicePrefs } from '../data/devicePrefs';

const routes = () =>
  consoleRoutes({
    'GET /v1/restaurant/profile': 'restaurant_profile_halal_certified',
    'GET /v1/restaurant/documents': 'restaurant_document_pack_complete',
    'GET /v1/restaurant/hours': 'restaurant_hours_standard',
  });

function stubNotifications(permission: NotificationPermission, onRequest?: () => Promise<NotificationPermission>) {
  const N = vi.fn() as unknown as { permission: NotificationPermission; requestPermission: () => Promise<NotificationPermission> };
  N.permission = permission;
  N.requestPermission = async () => {
    const next = onRequest ? await onRequest() : permission;
    N.permission = next;
    return next;
  };
  vi.stubGlobal('Notification', N);
  return N;
}

function stubAudio(play: () => Promise<void>) {
  vi.stubGlobal(
    'Audio',
    class {
      onended: null | (() => void) = null;
      pause() {}
      play = play;
    },
  );
}

beforeEach(() => {
  window.localStorage.clear();
  resetDevicePrefs();
  Object.defineProperty(navigator, 'wakeLock', { value: { request: async () => ({ release: async () => {} }) }, configurable: true });
  stubNotifications('granted');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (navigator as unknown as { wakeLock?: unknown }).wakeLock;
});

async function open() {
  installFakeApi(routes());
  await renderRedesign('/settings/device');
  return screen.findByTestId('section-device');
}

describe('Settings: this device', () => {
  it('is a section of its own, with a one-line summary in the list', async () => {
    const section = await open();
    expect(within(section).getByRole('heading', { name: 'This device' })).toBeTruthy();
    expect(within(screen.getByTestId('settings-nav')).getByText('Sound on · notifications allowed')).toBeTruthy();
  });

  it('turning the order sound off saves it for this browser and says what that means', async () => {
    const section = await open();
    expect(within(section).queryByTestId('sound-off-warning')).toBeNull();
    fireEvent.click(within(section).getByRole('switch', { name: /Order sound/ }));
    expect(within(section).getByTestId('sound-off-warning').textContent).toMatch(/You won't hear new orders\. They still appear in the strip/);
    expect(getDevicePrefs().soundOff).toBe(true);
    expect(JSON.parse(window.localStorage.getItem('hg.restaurant.device')!)).toMatchObject({ soundOff: true });
    expect(within(screen.getByTestId('settings-nav')).getByText('Order sound off')).toBeTruthy();
  });

  it('plays the order sound, and says so while it plays', async () => {
    let finish: () => void = () => {};
    stubAudio(() => new Promise<void>((r) => (finish = r)));
    const section = await open();
    fireEvent.click(within(section).getByRole('button', { name: 'Play the order sound' }));
    expect(await within(section).findByText('Playing now. Check the volume on this device.')).toBeTruthy();
    finish();
  });

  it('says the browser blocked the sound, and that orders still show on screen', async () => {
    stubAudio(() => Promise.reject(new Error('NotAllowedError')));
    const section = await open();
    fireEvent.click(within(section).getByRole('button', { name: 'Play the order sound' }));
    expect((await within(section).findByTestId('sound-blocked')).textContent).toMatch(/blocked the sound.*New orders still show on screen/);
  });

  it('offers to turn notifications on, shows the browser is asking, then allowed', async () => {
    let answer: (p: NotificationPermission) => void = () => {};
    stubNotifications('default', () => new Promise<NotificationPermission>((r) => (answer = r)));
    const section = await open();
    expect(within(section).getByTestId('notifications-badge').textContent).toBe('Not turned on');
    fireEvent.click(within(section).getByRole('button', { name: /Turn on notifications/ }));
    expect(await within(section).findByText('Your browser is asking whether to allow notifications. Choose Allow in its prompt.')).toBeTruthy();
    expect(within(section).getByRole('button', { name: /Waiting for your browser/ })).toBeTruthy();
    answer('granted');
    await waitFor(() => expect(within(section).getByTestId('notifications-badge').textContent).toBe('Allowed'));
    expect(within(section).queryByRole('button', { name: /Turn on notifications/ })).toBeNull();
  });

  it('blocked notifications are a warning that says how to allow them, never a button that cannot work', async () => {
    stubNotifications('denied');
    const section = await open();
    expect(within(section).getByTestId('notifications-badge').textContent).toBe('Blocked in this browser');
    expect(within(section).getByText(/set Notifications to Allow\. Then reload this page\./)).toBeTruthy();
    expect(within(section).queryByRole('button', { name: /Turn on notifications/ })).toBeNull();
    expect(within(screen.getByTestId('settings-nav')).getByText('Sound on · notifications blocked')).toBeTruthy();
  });

  it('a browser with no notifications at all says so', async () => {
    vi.stubGlobal('Notification', undefined);
    const section = await open();
    expect(within(section).getByTestId('notifications-badge').textContent).toBe('Not available');
  });

  it('a browser that cannot keep the screen on disables the switch and says what to do instead', async () => {
    delete (navigator as unknown as { wakeLock?: unknown }).wakeLock;
    const section = await open();
    expect(within(section).getByTestId('no-wake-lock').textContent).toMatch(/can't keep the screen on\. Set your device to stay awake/);
    expect(within(section).getByRole('switch', { name: /Keep the screen on/ }).hasAttribute('disabled')).toBe(true);
    expect(within(screen.getByTestId('settings-nav')).getByText("Sound on · screen can't stay on")).toBeTruthy();
  });

  it('letting the screen dim is saved for this browser', async () => {
    const section = await open();
    fireEvent.click(within(section).getByRole('switch', { name: /Keep the screen on/ }));
    expect(getDevicePrefs().screenMayDim).toBe(true);
    setDevicePrefs({ screenMayDim: false });
  });
});
