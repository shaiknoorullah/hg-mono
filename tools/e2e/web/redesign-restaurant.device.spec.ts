import { expect, test, type Page } from '@playwright/test';

import { expectDesignFor } from './design';
import { MOCK_API, MODE, openSignedIn } from './redesign-restaurant.support';

test.skip(MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The redesigned restaurant console's "This device" settings section (`/settings/device`): the
 * order sound, browser notifications and keeping the screen on, each state captured for the design
 * board it must match (tools/e2e/README.md, "Design captures"). These are the eight boards the
 * settings spec lists as having no screen ([#883](https://github.com/shaiknoorullah/hg-mono/issues/883)):
 * `Settings-Device` and the seven `Device-*` boards. The section reads the browser, not the
 * server, so each state is made by giving the page the browser answer the board draws (a
 * notification permission, a sound that plays, is blocked or never ends, a screen that cannot
 * stay on) before it loads; the profile and documents it sits beside come from the mock's fixtures.
 *
 * It lives in its own file so the settings spec, which already accounts for the other boards in the
 * area, stays as it is; its header still lists these eight as "no screen yet" until it is next
 * edited.
 *
 * Board ids are written out in full on purpose: tools/e2e/web/check-boards.mjs validates only
 * literal ids.
 */

interface Browser {
  notifications?: 'granted' | 'default' | 'denied' | 'pending';
  /** What `Audio.play()` does: succeed, be refused by the autoplay rule, or never finish. */
  sound?: 'plays' | 'blocked' | 'never';
  wakeLock?: boolean;
  soundOff?: boolean;
}

async function fixture<T = any>(page: Page, name: string): Promise<T> {
  const res = await page.request.get(`${MOCK_API}/__mock/scenarios/${name}`);
  return (await res.json()).data.payload;
}

async function open(page: Page, { notifications = 'granted', sound = 'plays', wakeLock = true, soundOff = false }: Browser = {}) {
  await page.addInitScript(
    ({ notifications, sound, wakeLock, soundOff }) => {
      const N: any = function () {};
      N.permission = notifications === 'pending' ? 'default' : notifications;
      N.requestPermission = () => (notifications === 'pending' ? new Promise(() => undefined) : Promise.resolve(N.permission));
      Object.defineProperty(window, 'Notification', { value: N, configurable: true });
      Object.defineProperty(HTMLMediaElement.prototype, 'play', {
        configurable: true,
        value() {
          if (sound === 'blocked') return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
          return sound === 'never' ? new Promise(() => undefined) : Promise.resolve();
        },
      });
      if (wakeLock) Object.defineProperty(navigator, 'wakeLock', { value: { request: async () => ({ release: async () => undefined }) }, configurable: true });
      else {
        // Remove the property, not set it to undefined: the component feature-detects with `'wakeLock' in navigator`,
        // which a defined-but-undefined property still satisfies. Chromium puts it on the prototype.
        Reflect.deleteProperty(navigator, 'wakeLock');
        Reflect.deleteProperty(Navigator.prototype, 'wakeLock');
      }
      if (soundOff) window.localStorage.setItem('hg.restaurant.device', JSON.stringify({ soundOff: true }));
    },
    { notifications, sound, wakeLock, soundOff },
  );
  const profile = await fixture(page, 'restaurant_profile_halal_certified');
  const docs = await fixture(page, 'restaurant_document_pack_complete');
  await page.route('**/v1/restaurant/profile', (route) => route.fulfill({ json: { data: profile } }));
  await page.route('**/v1/restaurant/documents', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { data: docs } }) : route.fallback()));
  await openSignedIn(page, '/settings/device');
  await expect(page.getByTestId('section-device')).toBeVisible();
}

async function capture(page: Page, board: Parameters<typeof expectDesignFor>[1]) {
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Not built yet')).toHaveCount(0);
  await expectDesignFor(page, board);
}

test.describe('redesigned restaurant settings · this device (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('sound on, notifications allowed, screen kept on', async ({ page }) => {
    await open(page);
    await expect(page.getByTestId('notifications-badge')).toHaveText('Allowed');
    await capture(page, 'restaurant/settings/Settings-Device');
  });

  test('the order sound is off', async ({ page }) => {
    await open(page, { soundOff: true });
    await expect(page.getByTestId('sound-off-warning')).toBeVisible();
    await capture(page, 'restaurant/settings/Device-SoundOff');
  });

  test('playing the order sound', async ({ page }) => {
    await open(page, { sound: 'never' });
    await page.getByRole('button', { name: 'Play the order sound' }).click();
    await expect(page.getByText('Playing now. Check the volume on this device.')).toBeVisible();
    await capture(page, 'restaurant/settings/Device-SoundPlaying');
  });

  test('the browser blocked the sound', async ({ page }) => {
    await open(page, { sound: 'blocked' });
    await page.getByRole('button', { name: 'Play the order sound' }).click();
    await expect(page.getByTestId('sound-blocked')).toBeVisible();
    await capture(page, 'restaurant/settings/Device-SoundBlocked');
  });

  test('notifications are not turned on', async ({ page }) => {
    await open(page, { notifications: 'default' });
    await expect(page.getByRole('button', { name: /Turn on notifications/ })).toBeVisible();
    await capture(page, 'restaurant/settings/Device-NotificationsAsk');
  });

  test('the browser is asking about notifications', async ({ page }) => {
    await open(page, { notifications: 'pending' });
    await page.getByRole('button', { name: /Turn on notifications/ }).click();
    await expect(page.getByText('Your browser is asking whether to allow notifications. Choose Allow in its prompt.')).toBeVisible();
    await capture(page, 'restaurant/settings/Device-NotificationsAsking');
  });

  test('notifications are blocked in this browser', async ({ page }) => {
    await open(page, { notifications: 'denied' });
    await expect(page.getByTestId('notifications-badge')).toHaveText('Blocked in this browser');
    await capture(page, 'restaurant/settings/Device-NotificationsBlocked');
  });

  test('this browser cannot keep the screen on', async ({ page }) => {
    await open(page, { wakeLock: false });
    await expect(page.getByTestId('no-wake-lock')).toBeVisible();
    await capture(page, 'restaurant/settings/Device-NoWakeLock');
  });
});
