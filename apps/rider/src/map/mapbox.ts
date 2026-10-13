/**
 * Web twin of `mapbox.native.ts`. The rider app's web target is a development convenience and does
 * not ship `mapbox-gl`, which the package's web build imports, so on web the map always renders
 * its text fallback and `@rnmapbox/maps` is never pulled into the bundle.
 */
export type MapboxModule = typeof import('@rnmapbox/maps');

export function loadMapbox(): MapboxModule | null {
  return null;
}
