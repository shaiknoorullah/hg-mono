/**
 * The restaurant's own menu (`getOwnMenu`). There are no menu realtime events yet (Needs API),
 * so it re-reads on window focus and every 60 s (manifest WP8 DONE). A failed re-read keeps the
 * menu on screen and marks it stale with the time it was last read (MenuStale).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Schema } from '@hg/api-client';
import { client } from '../data/client';
import { call } from '../data/call';
import { serverNow } from '../data/serverClock';
import { useServerResource } from '../data/useServerResource';
import type { MenuItem, OwnedMenu } from './model';

export const MENU_REFRESH_MS = 60_000;

export function loadOwnMenu(): Promise<OwnedMenu> {
  // `call` loses the Cents brand through `infer`; the shape is the contract's.
  return call(client.GET('/v1/restaurant/menu', {})) as unknown as Promise<OwnedMenu>;
}

export function useOwnMenu() {
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const fetcher = useCallback(async () => {
    const menu = await loadOwnMenu();
    setLoadedAt(serverNow());
    return menu;
  }, []);
  const menu = useServerResource<OwnedMenu>(fetcher);
  const { refresh } = menu;
  useEffect(() => {
    const id = window.setInterval(() => void refresh(), MENU_REFRESH_MS);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);
  return { ...menu, loadedAt };
}

/** Replace one item in the menu with the server's answer (it may have moved category). */
export function withItem(menu: OwnedMenu | null, item: MenuItem): OwnedMenu | null {
  if (!menu) return menu;
  return {
    ...menu,
    categories: menu.categories.map((c) => {
      const rest = c.items.filter((i) => i.id !== item.id);
      if (c.id !== item.category_id) return rest.length === c.items.length ? c : { ...c, items: rest };
      const at = c.items.findIndex((i) => i.id === item.id);
      const items = [...rest];
      items.splice(at >= 0 ? at : items.length, 0, item);
      return { ...c, items };
    }),
  };
}

export function withCategory(menu: OwnedMenu | null, category: Schema['MenuCategory']): OwnedMenu | null {
  if (!menu) return menu;
  return { ...menu, categories: [...menu.categories, { ...category, items: [] }] };
}

/**
 * Whether the server's copy of an item differs from the screen's in anything this save did
 * not change (MenuLiveChanges: "Your menu changed on another device or at HalalGoes").
 */
export function changedElsewhere(onScreen: MenuItem, fromServer: MenuItem): boolean {
  return (
    onScreen.price_cents !== fromServer.price_cents ||
    onScreen.category_id !== fromServer.category_id ||
    (onScreen.live_version?.id ?? null) !== (fromServer.live_version?.id ?? null) ||
    (onScreen.pending_version?.id ?? null) !== (fromServer.pending_version?.id ?? null)
  );
}

/** Previous fetch's availability per item, to say "Back in stock at 5:00 pm by itself" in-session. */
export function useRestockedBySelf(menu: OwnedMenu | null): Map<string, string> {
  const previous = useRef(new Map<string, { state: string; until: string | null }>());
  const [restocked, setRestocked] = useState(new Map<string, string>());
  useEffect(() => {
    if (!menu) return;
    const now = serverNow();
    const next = new Map(restocked);
    let changed = false;
    for (const c of menu.categories) {
      for (const i of c.items) {
        const prev = previous.current.get(i.id);
        if (prev?.state === 'OUT_OF_STOCK' && prev.until && Date.parse(prev.until) <= now && i.availability_state === 'AVAILABLE') {
          next.set(i.id, prev.until);
          changed = true;
        } else if (i.availability_state !== 'AVAILABLE' && next.has(i.id)) {
          next.delete(i.id);
          changed = true;
        }
        previous.current.set(i.id, { state: i.availability_state, until: i.out_of_stock_until ?? null });
      }
    }
    if (changed) setRestocked(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu]);
  return restocked;
}
