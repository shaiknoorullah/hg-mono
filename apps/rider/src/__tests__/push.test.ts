/**
 * Push is never a gate: a refused permission or a push token Expo can't issue leaves sign-in
 * working. registerForPush resolves, registers nothing, never throws, and logs one line however
 * often it fails, without the token.
 */
import * as Notifications from 'expo-notifications';

import { api } from '../api';
import { registerForPush } from '../push';

describe('push registration never blocks', () => {
  let post: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    post = jest.spyOn(api, 'POST');
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('carries on when permission is refused, or the token cannot be had', async () => {
    jest
      .spyOn(Notifications, 'getPermissionsAsync')
      .mockResolvedValue({ granted: false, canAskAgain: true, status: 'denied' } as never);
    const ask = jest
      .spyOn(Notifications, 'requestPermissionsAsync')
      .mockResolvedValue({ granted: false, canAskAgain: false, status: 'denied' } as never);
    await expect(registerForPush()).resolves.toBeUndefined();
    expect(ask).toHaveBeenCalledTimes(1);

    jest
      .spyOn(Notifications, 'getPermissionsAsync')
      .mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' } as never);
    jest
      .spyOn(Notifications, 'getExpoPushTokenAsync')
      .mockRejectedValue(new Error('Default FirebaseApp is not initialized'));
    await expect(registerForPush()).resolves.toBeUndefined();

    expect(post).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain('ExponentPushToken');
  });
});
