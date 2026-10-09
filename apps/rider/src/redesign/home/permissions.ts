/**
 * Phone permissions Home reads on its own (the server cannot see them): notifications, read on
 * mount and each return to the foreground (SH/HomeNotificationsOff: "OS permission read on
 * foreground"). Location is read from the reporting loop's own outcome (`dashboard.ts`).
 *
 * The fix for every permission row is the app's page in the phone's Settings.
 */
import * as React from 'react';
import { AppState, Linking } from 'react-native';
import * as Notifications from 'expo-notifications';

export function openPhoneSettings(): void {
  void Linking.openSettings().catch(() => undefined);
}

/** `true` when the phone says notifications are off for HalalGoes; checked only while `active`. */
export function useNotificationsOff(active: boolean): boolean {
  const [off, setOff] = React.useState(false);
  React.useEffect(() => {
    if (!active) {
      setOff(false);
      return;
    }
    let cancelled = false;
    const check = () => {
      Notifications.getPermissionsAsync()
        .then((p) => {
          if (!cancelled) setOff(!p.granted);
        })
        .catch(() => undefined);
    };
    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [active]);
  return off;
}
