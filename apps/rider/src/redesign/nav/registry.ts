/**
 * Route name → screen. Each WP registers its screens from its own folder (`./screens.ts`
 * imports them once), so the shell never imports a screen and a WP PR can be dropped alone.
 *
 * A route with no registered screen falls back to the legacy screen for it (MASTER-PLAN §0.3,
 * "the redesign router falls back, route by route"); see `LegacyFallback.tsx`.
 */
import type * as React from 'react';

import type { ParamsOf, RouteName } from './routes';

export interface ScreenProps<K extends RouteName> {
  params: ParamsOf<K>;
}

export interface ScreenSpec<K extends RouteName> {
  component: React.ComponentType<ScreenProps<K>>;
  /**
   * Android Back on this screen: `pop` (default) goes back; `none` swallows it (trip steps,
   * the offer before it expires: "trip steps have no Back").
   */
  back?: 'pop' | 'none';
}

const screens = new Map<string, ScreenSpec<any>>();

export function registerScreen<K extends RouteName>(name: K, spec: ScreenSpec<K>): void {
  screens.set(name, spec);
}

export function screenFor<K extends RouteName>(name: K): ScreenSpec<K> | undefined {
  return screens.get(name);
}

/** Test seam. */
export function clearScreens(): void {
  screens.clear();
}

/**
 * Layers render above every screen and the BottomNav, in `order` (the offer sheet, the What's
 * new sheet). Each decides for itself whether it is showing.
 */
export interface LayerSpec {
  key: string;
  order: number;
  component: React.ComponentType;
}

const layers = new Map<string, LayerSpec>();

export function registerLayer(spec: LayerSpec): void {
  layers.set(spec.key, spec);
}

export function allLayers(): LayerSpec[] {
  return [...layers.values()].sort((a, b) => a.order - b.order);
}

/** Tab accessories render just above the BottomNav (the "back to your delivery" strip). */
const accessories = new Map<string, LayerSpec>();

export function registerTabAccessory(spec: LayerSpec): void {
  accessories.set(spec.key, spec);
}

export function allTabAccessories(): LayerSpec[] {
  return [...accessories.values()].sort((a, b) => a.order - b.order);
}

export function clearLayers(): void {
  layers.clear();
  accessories.clear();
}
