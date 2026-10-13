/**
 * Order updates by push. Once the customer has signed in, the app asks for notification
 * permission, gets its Expo push token and hands it to the API (`registerDevice`, role
 * `CUSTOMER`); signing out takes it back (`unregisterDevice`), so the next person to sign in on a
 * shared phone never sees this customer's orders (docs/spec/02-customer.md, "C-40 —
 * Notifications: push, in-app inbox, and alerts").
 *
 * Nothing here can stop sign-in, ordering or app start. Every failure — permission refused, no
 * EAS project id in this build, no token on a simulator or an emulator without Google Play, the
 * API saying no — ends the attempt quietly with one log line for the whole run. The inbox is the
 * record either way. The token itself is never logged.
 */
import { createHgClient, type Schema } from '@hg/api-client';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from './client';
import { API_BASE_URL } from './config';

// The app keeps nothing on disk between runs, so this id names the device row for one run; the
// API moves a token registered again under a new id to the new row.
const deviceId = `customer-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

let deviceRegistered = false;
let reported = false;

function report(why: string): void {
  if (!reported) console.warn(`[push] skipped: ${why}`);
  reported = true;
}

/** Register this phone for push. Never awaited by sign-in, never rejects. */
export async function enablePush(): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
  try {
    const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
    const easProject = extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!easProject) return report('no EAS project id in this build');

    let status = await Notifications.getPermissionsAsync();
    if (!status.granted && status.canAskAgain) status = await Notifications.requestPermissionsAsync();
    if (!status.granted) return report('notifications are not allowed');

    const { data: pushToken } = await Notifications.getExpoPushTokenAsync({ projectId: easProject });
    const device: Schema['DeviceRegistrationInput'] = {
      device_id: deviceId,
      expo_push_token: pushToken,
      role_context: 'CUSTOMER',
      platform: Platform.OS,
      os_version: `${Platform.Version}`,
      app_version: Constants.expoConfig?.version ?? null,
    };
    const res = await api.POST('/v1/devices', { body: device });
    if (res.error) return report('the API turned the device down');
    deviceRegistered = true;
  } catch {
    report('Expo gave no push token');
  }
}

/**
 * Take this phone's registration back. `accessToken` is the session's, read before sign-out
 * clears it; the request runs on a client of its own, so sign-out does not wait for it.
 */
export function disablePush(accessToken: string | null): void {
  if (!deviceRegistered || accessToken === null) return;
  deviceRegistered = false;
  createHgClient({
    baseUrl: API_BASE_URL,
    getToken: () => accessToken,
    clientSurface: 'customer-app',
    clientVersion: '0.0.0',
  })
    .DELETE('/v1/devices/{deviceId}', { params: { path: { deviceId } } })
    .catch(() => report('the API could not be told about sign-out'));
}
