/**
 * The native Mapbox SDK, if this build has it.
 *
 * `@rnmapbox/maps` is linked only in a build made with the Mapbox download token
 * (scripts/release/mapbox.cjs). Without it the native module is absent, and importing the JS
 * package logs an error and then crashes the first map that renders. So: check the native module
 * first, and only then require the package. `null` means "draw the ETA text instead".
 * The web build uses nativeMapbox.web.ts, which is always `null`.
 */
import { NativeModules } from 'react-native';

type MapboxModule = typeof import('@rnmapbox/maps');

let cached: MapboxModule | null | undefined;

export function loadMapbox(): MapboxModule | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (NativeModules.RNMBXModule == null) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@rnmapbox/maps') as { default?: MapboxModule } & MapboxModule;
    const mapbox = (mod.default ?? mod) as Partial<MapboxModule>;
    if (mapbox.MapView && mapbox.Camera && mapbox.MarkerView) cached = mapbox as MapboxModule;
  } catch {
    cached = null;
  }
  return cached;
}

/** Test seam: forget the cached answer. */
export function resetMapboxCacheForTests(): void {
  cached = undefined;
}
