/**
 * Push must never hold up sign-in. When the customer says no to notifications, or Expo can't give
 * the phone a push token, `enablePush` still resolves, nothing is sent to the API, and the app
 * logs a single line that never carries a token.
 */
import * as Notifications from 'expo-notifications';

import { api } from '../client';
import { enablePush } from '../push';

const denied = { granted: false, canAskAgain: false, status: 'denied' } as never;
const granted = { granted: true, canAskAgain: true, status: 'granted' } as never;

afterEach(() => jest.restoreAllMocks());

test('a refused permission or a missing push token does not block sign-in', async () => {
  const register = jest.spyOn(api, 'POST');
  const log = jest.spyOn(console, 'warn').mockImplementation(() => {});

  jest.spyOn(Notifications, 'getPermissionsAsync').mockResolvedValueOnce(denied);
  await expect(enablePush()).resolves.toBeUndefined();

  jest.spyOn(Notifications, 'getPermissionsAsync').mockResolvedValueOnce(granted);
  jest
    .spyOn(Notifications, 'getExpoPushTokenAsync')
    .mockRejectedValueOnce(new Error('no simulator push token'));
  await expect(enablePush()).resolves.toBeUndefined();

  expect(register).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledTimes(1);
  expect(log.mock.calls.flat().join(' ')).not.toMatch(/ExponentPushToken/);
});
