/**
 * This phone's permission to show push notifications, read from Expo (boards
 * `AC/NotificationSettings`, `-notasked`, `-denied`). The server holds no push preference: whether
 * order updates reach the lock screen is the phone's setting plus a registered device.
 *
 * - `allowed`: the customer allowed notifications.
 * - `notAsked`: the phone has not asked yet, or can ask again. "Turn on notifications" asks.
 * - `denied`: refused and the phone will not ask again. Only the phone's settings can change it.
 *
 * A failed read is `notAsked`, never `allowed`: the page never claims a permission it did not see.
 */
import * as React from 'react';
import { Linking } from 'react-native';
import * as Notifications from 'expo-notifications';

import { enablePush } from '../../api/push';
import type { PushState } from './rules';

export async function readPushState(): Promise<PushState> {
  try {
    const p = await Notifications.getPermissionsAsync();
    if (p.granted) return 'allowed';
    return p.canAskAgain ? 'notAsked' : 'denied';
  } catch {
    return 'notAsked';
  }
}

/** Ask the phone, register the device when allowed, and return the new state. */
export async function turnOnPush(): Promise<PushState> {
  await enablePush();
  return readPushState();
}

export function openPhoneSettings(): void {
  void Linking.openSettings().catch(() => {});
}

/** The permission as last read, or `null` while it loads. `refresh` reads it again. */
export function usePushState(): { state: PushState | null; refresh: () => Promise<void>; turnOn: () => Promise<void> } {
  const [state, setState] = React.useState<PushState | null>(null);
  const live = React.useRef(true);
  React.useEffect(() => {
    live.current = true;
    void readPushState().then((s) => live.current && setState(s));
    return () => {
      live.current = false;
    };
  }, []);
  const refresh = React.useCallback(async () => {
    const s = await readPushState();
    if (live.current) setState(s);
  }, []);
  const turnOn = React.useCallback(async () => {
    const s = await turnOnPush();
    if (live.current) setState(s);
  }, []);
  return { state, refresh, turnOn };
}
