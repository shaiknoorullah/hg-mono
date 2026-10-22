/**
 * This phone's permission to use its location while the app is open, read from Expo (boards
 * `AC/AppSettings`, `-notasked`, `-off`). Nothing is sent to the server: the location only starts
 * the address map where the customer is, and the pin can always be dragged instead.
 *
 * - `allowed`: the customer allowed location while using the app.
 * - `notAsked`: the phone has not asked yet, or can ask again. "Turn on location" asks.
 * - `denied`: refused and the phone will not ask again, or it just refused. Only the phone's
 *   settings can change it, so the page offers "Open phone settings", never a switch that does
 *   nothing.
 *
 * Only "while using the app" is ever requested; the app has no background location. A failed read
 * is `notAsked`, never `allowed`: the page never claims a permission it did not see.
 */
import * as React from 'react';
import { AppState, Linking } from 'react-native';
import * as Location from 'expo-location';

/** The location permission as the page shows it. */
export type LocationState = 'allowed' | 'notAsked' | 'denied';

/** Read the permission without asking. */
export async function readLocationState(): Promise<LocationState> {
  try {
    const p = await Location.getForegroundPermissionsAsync();
    if (p.granted) return 'allowed';
    return p.canAskAgain ? 'notAsked' : 'denied';
  } catch {
    return 'notAsked';
  }
}

/** Ask the phone for location while the app is open, and return what the customer chose. */
export async function askForLocation(): Promise<LocationState> {
  try {
    const p = await Location.requestForegroundPermissionsAsync();
    // A refusal is shown as "turned off in your phone settings" even on a phone that would ask
    // again: the customer just said no, and the next step they can take is the phone's settings.
    return p.granted ? 'allowed' : 'denied';
  } catch {
    return readLocationState();
  }
}

/** Open this app's page in the phone's settings. */
export function openLocationSettings(): void {
  void Linking.openSettings().catch(() => {});
}

/**
 * The permission as last read, or `null` while it loads. It is read again whenever the app comes
 * back to the front, because the customer may have changed it in the phone's settings.
 */
export function useLocationState(): { state: LocationState | null; turnOn: () => Promise<void> } {
  const [state, setState] = React.useState<LocationState | null>(null);
  const live = React.useRef(true);
  React.useEffect(() => {
    live.current = true;
    const refresh = () => void readLocationState().then((s) => live.current && setState(s));
    refresh();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });
    return () => {
      live.current = false;
      sub.remove();
    };
  }, []);
  const turnOn = React.useCallback(async () => {
    const s = await askForLocation();
    if (live.current) setState(s);
  }, []);
  return { state, turnOn };
}
