/**
 * What this browser is set to do with a new order: ring or stay quiet, and keep the screen on or
 * let it dim. Both belong to this browser only (settings board `PartDevice`: "These settings
 * belong to this browser only"), so they live in local storage, not on the server. The default
 * is both on: a screen that takes orders should ring and stay awake.
 *
 * `NewOrdersProvider` reads this; the Settings "This device" section writes it.
 */
import { useSyncExternalStore } from 'react';

export interface DevicePrefs {
  /** True when the order sound is switched off here (the order still appears in the strip). */
  soundOff: boolean;
  /** True when this browser should not hold the screen awake. */
  screenMayDim: boolean;
}

const KEY = 'hg.restaurant.device';
const listeners = new Set<() => void>();

function read(): DevicePrefs {
  const fallback: DevicePrefs = { soundOff: false, screenMayDim: false };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return fallback;
    const v = JSON.parse(raw) as Partial<DevicePrefs>;
    return { soundOff: v.soundOff === true, screenMayDim: v.screenMayDim === true };
  } catch {
    return fallback;
  }
}

let current: DevicePrefs = read();

export function getDevicePrefs(): DevicePrefs {
  return current;
}

/** Saves a change. A browser that refuses storage still honours it until the page reloads. */
export function setDevicePrefs(patch: Partial<DevicePrefs>): void {
  current = { ...current, ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* private window or blocked storage: the choice holds for this page only */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useDevicePrefs(): DevicePrefs {
  return useSyncExternalStore(subscribe, getDevicePrefs, getDevicePrefs);
}

/** Test seam: forget the saved choice and re-read storage. */
export function resetDevicePrefs(): void {
  current = read();
  listeners.forEach((l) => l());
}
