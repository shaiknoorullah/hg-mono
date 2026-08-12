/**
 * Global gallery controls, persisted to the URL so that any view is linkable.
 *
 * `?scheme=dark&theme=admin&density=roomy&dir=rtl&section=halal` is the whole state of
 * the app. There is no local storage and no React context holding a second copy: the
 * URL is the single source of truth, which is what makes "send me the link to the thing
 * that looks wrong" work.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ThemeName } from '@hg/ui-web';

export type Scheme = 'light' | 'dark';
export type Density = 'compact' | 'comfortable' | 'roomy';
export type Direction = 'ltr' | 'rtl';

export interface Controls {
  scheme: Scheme;
  theme: ThemeName;
  density: Density;
  dir: Direction;
  section: string;
}

export const SCHEMES: readonly Scheme[] = ['light', 'dark'];
export const THEMES: readonly ThemeName[] = ['restaurant', 'admin'];
export const DENSITIES: readonly Density[] = ['compact', 'comfortable', 'roomy'];
export const DIRECTIONS: readonly Direction[] = ['ltr', 'rtl'];

/**
 * `restaurant` is a kitchen tablet at arm's length and runs `compact`; `admin` runs
 * `comfortable` (`packages/ui-web/src/tokens/themes.ts`). Switching theme therefore
 * moves density too, unless the URL pins one explicitly.
 */
export const THEME_DEFAULT_DENSITY: Record<ThemeName, Density> = {
  restaurant: 'compact',
  admin: 'comfortable',
};

const DEFAULTS: Controls = {
  scheme: 'light',
  theme: 'restaurant',
  density: 'compact',
  dir: 'ltr',
  section: 'halal',
};

function pick<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

export function readControls(search: string = window.location.search): Controls {
  const params = new URLSearchParams(search);
  const theme = pick(params.get('theme'), THEMES, DEFAULTS.theme);
  return {
    scheme: pick(params.get('scheme'), SCHEMES, DEFAULTS.scheme),
    theme,
    // Density falls back to whatever the selected theme declares, not to a constant.
    density: pick(params.get('density'), DENSITIES, THEME_DEFAULT_DENSITY[theme]),
    dir: pick(params.get('dir'), DIRECTIONS, DEFAULTS.dir),
    section: params.get('section') ?? DEFAULTS.section,
  };
}

export function controlsToSearch(next: Controls): string {
  const params = new URLSearchParams();
  params.set('scheme', next.scheme);
  params.set('theme', next.theme);
  params.set('density', next.density);
  params.set('dir', next.dir);
  params.set('section', next.section);
  return `?${params.toString()}`;
}

/* -------------------------------------------------------------------------- *
 * Store
 * -------------------------------------------------------------------------- */

const listeners = new Set<() => void>();
let snapshot: Controls = readControls();

function emit(): void {
  snapshot = readControls();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', emit);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('popstate', emit);
  };
}

function getSnapshot(): Controls {
  return snapshot;
}

export function useControls(): [Controls, (patch: Partial<Controls>) => void] {
  const controls = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const set = useCallback((patch: Partial<Controls>) => {
    const current = readControls();
    const merged: Controls = { ...current, ...patch };
    // Changing theme without pinning density re-derives density from the new theme.
    if (patch.theme && patch.density === undefined) {
      merged.density = THEME_DEFAULT_DENSITY[patch.theme];
    }
    window.history.replaceState(null, '', controlsToSearch(merged));
    emit();
  }, []);

  return [controls, set];
}

/**
 * Where each attribute has to live, and why it is not all on `<html>`:
 *
 *  - `:root[data-theme="dark"]` is written against the root element, so the scheme goes
 *    on `<html>`.
 *  - `[data-hg-density="…"]` and `[data-hg-theme="…"]` are bare attribute selectors of
 *    the same specificity as the `:root` block that `tokens.css` emits **after** them.
 *    On the root element the later `:root` block wins and the density switch silently
 *    does nothing. Applied to a wrapper element instead, the rule matches that element
 *    and beats the inherited value. This is a real token-pipeline finding; the gallery
 *    works around it rather than papering over it (see README).
 */
export function useDocumentScheme(controls: Controls): void {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', controls.scheme);
    root.setAttribute('dir', controls.dir);
    root.style.colorScheme = controls.scheme;
    return () => {
      root.removeAttribute('data-theme');
      root.setAttribute('dir', 'ltr');
    };
  }, [controls.scheme, controls.dir]);
}

export function useThemeSubtreeAttributes(controls: Controls): Record<string, string> {
  return useMemo(
    () => ({
      'data-hg-theme': controls.theme,
      'data-hg-density': controls.density,
    }),
    [controls.theme, controls.density],
  );
}
