/**
 * Push notifications for the rider app: after sign-in, ask permission, get the Expo push token and
 * register it with the API (`registerDevice`); on sign-out, unregister it (`unregisterDevice`), so
 * a shared phone never gets the previous rider's offers (docs/spec/01-platform.md, "P-25 — Push
 * notifications (Expo)").
 *
 * Push is a convenience, never a gate. A refused permission, a token Expo can't issue (no EAS
 * project id in this build, a simulator, an emulator without Google Play) or a failed request
 * leaves the rider signed in and working: this module logs one line, once, and gives up until the
 * next sign-in. It never throws, nothing awaits it, and it never logs the token.
 */
import { createHgClient, type Schema } from '@hg/api-client';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api, API_BASE_URL } from './api';

/**
 * This install's device id for the session's device row. The app keeps no storage between runs,
 * so it lasts one run; the server rebinds a token registered again under a new id.
 */
const DEVICE_ID = `rider-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

let registered = false;
let warned = false;

function warnOnce(reason: string): void {
  if (warned) return;
  warned = true;
  console.warn(`push notifications are off on this device: ${reason}`);
}

/** The EAS project id the build carries (app.config.js adds it only when EAS_PROJECT_ID is set). */
function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

/** Ask for permission, get a token and register it. Resolves either way; never throws. */
export async function registerForPush(): Promise<void> {
  try {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
    const id = projectId();
    if (!id) {
      warnOnce('this build has no EAS project id');
      return;
    }
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) {
      permission = await Notifications.requestPermissionsAsync();
    }
    if (!permission.granted) {
      warnOnce('permission was not given');
      return;
    }
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
    const body: Schema['DeviceRegistrationInput'] = {
      expo_push_token: token,
      device_id: DEVICE_ID,
      platform: Platform.OS,
      role_context: 'RIDER',
      app_version: Constants.expoConfig?.version ?? null,
      os_version: String(Platform.Version),
    };
    const { error } = await api.POST('/v1/devices', { body });
    if (error) {
      warnOnce('the API did not register this device');
      return;
    }
    registered = true;
  } catch {
    warnOnce('no push token could be had');
  }
}

/**
 * The device id this run registered, or null, for a caller that unregisters it itself and waits
 * for the answer (the redesign's Account › Sign out, which must unregister before it revokes the
 * session). Taking it marks the device unregistered, so `unregisterForPush` does not repeat it.
 */
export function takeRegisteredDeviceId(): string | null {
  if (!registered) return null;
  registered = false;
  return DEVICE_ID;
}

/**
 * Unregister this device. Call it with the session's bearer token *before* signing out: the
 * request goes on its own client holding that token, so sign-out never waits for it.
 */
export function unregisterForPush(bearer: string | null): void {
  if (!registered || !bearer) return;
  registered = false;
  const client = createHgClient({
    baseUrl: API_BASE_URL,
    getToken: () => bearer,
    clientSurface: 'rider-app',
    clientVersion: '0.0.0',
  });
  client
    .DELETE('/v1/devices/{deviceId}', { params: { path: { deviceId: DEVICE_ID } } })
    .catch(() => warnOnce('this device could not be unregistered'));
}
