/**
 * Optional resolution of `@rnmapbox/maps`, the map library both mobile apps already depend on.
 *
 * The map is never the only way to know where an order is (02-components.md §26), so a host that
 * cannot draw one must degrade to the text panel rather than crash. Three hosts cannot:
 *
 *  - a build made without the Mapbox download token. The package's JS is still bundled, but the
 *    native module (`RNMBXModule`) is not linked, and importing the package logs an error and
 *    crashes the first map that renders. So the native module is checked FIRST and the JS is only
 *    required once it is present (the same guard as `apps/rider/src/map/mapbox.native.ts` and
 *    `apps/customer/src/maps/nativeMapbox.ts`);
 *  - a build with the SDK but no public token: Mapbox would draw a blank grey tile, which is the
 *    "bare grey box" this component must never show;
 *  - jest, web and Expo Go, where neither exists.
 *
 * Resolution happens at render time, once per answer. The token is read from
 * `EXPO_PUBLIC_MAPBOX_TOKEN` at run time (Expo inlines it into the bundle), exactly as the apps do.
 */
import type { ComponentType } from 'react';
import { NativeModules } from 'react-native';

/** The part of `@rnmapbox/maps` the design system draws with. */
export interface MapboxModule {
  MapView: ComponentType<any>;
  Camera: ComponentType<any>;
  MarkerView: ComponentType<any>;
  PointAnnotation: ComponentType<any>;
  ShapeSource: ComponentType<any>;
  LineLayer: ComponentType<any>;
  StyleURL: { Street: string };
  setAccessToken: (token: string) => unknown;
}

/** Why a map cannot be drawn; `null` from `resolveMapbox` means it can. */
export type MapUnavailableReason = 'module-unlinked' | 'no-token';

export interface MapboxResolution {
  mapbox: MapboxModule | null;
  /** Set when `mapbox` is null. */
  reason: MapUnavailableReason | null;
}

let cachedModule: MapboxModule | null | undefined;
let tokenApplied: string | null = null;

/** The public token the apps set at build time; empty when there is none. */
export function publicMapboxToken(): string {
  return process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';
}

function loadModule(): MapboxModule | null {
  if (cachedModule !== undefined) return cachedModule;
  cachedModule = null;
  if ((NativeModules as Record<string, unknown>).RNMBXModule == null) return cachedModule;
  try {
    const mod = (require as (id: string) => Record<string, unknown>)('@rnmapbox/maps');
    const mb = ((mod.default as Record<string, unknown> | undefined) ?? mod) as Partial<MapboxModule>;
    if (mb.MapView && mb.Camera && mb.MarkerView && mb.PointAnnotation && mb.ShapeSource && mb.LineLayer) {
      cachedModule = mb as MapboxModule;
    }
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

/**
 * The module ready to draw with, or why not. `token` overrides the environment (a test or a screen
 * that holds its own); an empty token means no map, never a blank tile.
 */
export function resolveMapbox(token: string | undefined = undefined): MapboxResolution {
  const mapbox = loadModule();
  if (!mapbox) return { mapbox: null, reason: 'module-unlinked' };
  const pk = token ?? publicMapboxToken();
  if (!pk) return { mapbox: null, reason: 'no-token' };
  if (tokenApplied !== pk) {
    void mapbox.setAccessToken(pk);
    tokenApplied = pk;
  }
  return { mapbox, reason: null };
}

/** Test seam. Not exported from the tier barrel. `undefined` forgets the answer. */
export function __setMapboxForTest(mod: MapboxModule | null | undefined): void {
  cachedModule = mod;
  tokenApplied = null;
}
