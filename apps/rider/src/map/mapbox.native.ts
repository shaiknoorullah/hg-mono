/**
 * The guarded `@rnmapbox/maps` import for iOS and Android.
 *
 * The native SDK is linked only in builds that carry the Mapbox download token
 * (`react-native.config.js`). In every other build the package's JS is still bundled, but
 * importing it throws at module load because its native module is missing. So this checks for
 * the native module first and only then requires the JS, and the map component renders its text
 * fallback when this returns null. `mapbox.ts` is the web twin, which always returns null.
 */
import { NativeModules } from 'react-native';

export type MapboxModule = typeof import('@rnmapbox/maps');

let cached: MapboxModule | null | undefined;

export function loadMapbox(): MapboxModule | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (NativeModules.RNMBXModule == null) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('@rnmapbox/maps') as MapboxModule;
  } catch {
    cached = null;
  }
  return cached;
}
