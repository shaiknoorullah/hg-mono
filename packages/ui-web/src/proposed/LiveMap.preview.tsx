/**
 * Specimens for `LiveMap`, named after the admin `orders/LiveMap*` boards (the live design
 * system has no preview page for it). The ready states run on a stand-in map engine
 * (`__fixtures__/fake-mapbox`): no tiles, but the real pins, controls and attribution strip.
 */

import { LiveMap, type LiveMapRider } from './LiveMap.js';
import { loadFakeMapbox } from './__fixtures__/fake-mapbox.js';

/** Grouped under one heading in the preview. */
export const component = 'LiveMap';

const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();
const places = [
  { id: 'r', kind: 'restaurant' as const, label: 'Zaytoun Grill', latitude: 43.7262, longitude: -79.2701 },
  { id: 'c', kind: 'customer' as const, label: 'Drop-off', latitude: 43.7349, longitude: -79.2552 },
];
const rider = (seconds: number): LiveMapRider => ({
  id: 'rider',
  label: 'Ahmed K.',
  description: 'bicycle',
  fix: { latitude: 43.7296, longitude: -79.2648, headingDeg: null, accuracyM: null, recordedAt: ago(seconds), coarse: false },
});
const never = () => new Promise<never>(() => undefined);
const box = { width: 720 };

/** `LiveMap`: places and a moving rider, with the text equivalent shown. */
export function Live() {
  return (
    <div style={box}>
      <LiveMap
        accessToken="pk.preview"
        loadMapbox={loadFakeMapbox}
        places={places}
        riders={[rider(8)]}
        ariaLabel="Map of order HG-6RN4KP"
        height="360px"
        showEntityList
      />
    </div>
  );
}

/** `LiveMapStale`: no fix for four minutes. */
export function Stale() {
  return (
    <div style={box}>
      <LiveMap accessToken="pk.preview" loadMapbox={loadFakeMapbox} places={places} riders={[rider(240)]} ariaLabel="Map of order HG-1CV7HS" height="360px" />
    </div>
  );
}

/** No token configured: the places and riders in words. */
export function NoToken() {
  return (
    <div style={box}>
      <LiveMap accessToken="" loadMapbox={never} places={places} riders={[rider(8)]} ariaLabel="Map of order HG-6RN4KP" />
    </div>
  );
}

/** `LiveMapLoading`. */
export function Loading() {
  return (
    <div style={box}>
      <LiveMap accessToken="pk.preview" loadMapbox={never} places={places} riders={[]} ariaLabel="Map of order HG-6RN4KP" />
    </div>
  );
}

/** `LiveMapError`: the engine failed; the list stands in. */
export function Failed() {
  return (
    <div style={box}>
      <LiveMap
        accessToken="pk.preview"
        loadMapbox={() => Promise.reject(new Error('no webgl'))}
        places={places}
        riders={[rider(8)]}
        ariaLabel="Map of order HG-6RN4KP"
      />
    </div>
  );
}

/** Nothing to draw: the empty state. */
export function Empty() {
  return (
    <div style={box}>
      <LiveMap accessToken="pk.preview" loadMapbox={never} places={[]} riders={[]} ariaLabel="Map" />
    </div>
  );
}
