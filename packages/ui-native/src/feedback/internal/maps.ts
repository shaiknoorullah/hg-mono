/**
 * Optional resolution of `react-native-maps`.
 *
 * The map is never the only way to know where an order is (02-components.md §26), so a host
 * without the native module — jest, a web surface, an Expo Go build — must degrade to the text
 * panel rather than fail to import. Resolution therefore happens at render time, once.
 */
import type { ComponentType } from 'react';

export interface NativeMapModule {
  MapView: ComponentType<any>;
  Marker: ComponentType<any>;
  Polyline: ComponentType<any>;
}

let cached: NativeMapModule | null | undefined;

export function resolveNativeMaps(): NativeMapModule | null {
  if (cached !== undefined) return cached;
  try {
    const mod = (require as (id: string) => Record<string, unknown>)('react-native-maps');
    const MapView = (mod.default ?? mod.MapView) as NativeMapModule['MapView'] | undefined;
    const Marker = mod.Marker as NativeMapModule['Marker'] | undefined;
    const Polyline = mod.Polyline as NativeMapModule['Polyline'] | undefined;
    cached = MapView && Marker && Polyline ? { MapView, Marker, Polyline } : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Test seam. Not exported from the tier barrel. */
export function __setNativeMapsForTest(mod: NativeMapModule | null | undefined): void {
  cached = mod;
}
