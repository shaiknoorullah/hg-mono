import { isApiError, type RestaurantAccountState } from '@hg/api-client';
import { Banner } from '@hg/ui-web';

/**
 * The menu lock (docs/spec/03-restaurant.md "R-15 — Menu item authoring", issue #256): while
 * the restaurant is `SUSPENDED` or `BANNED` every menu write is `403 MENU_LOCKED`, and reading
 * stays open. The app learns it from `account_state` on the profile before any save, and from
 * the error itself if a save races a suspension — both land on the same notice.
 */
export type MenuLockState = Extract<RestaurantAccountState, 'SUSPENDED' | 'BANNED'>;

export function menuLockFromAccountState(state: RestaurantAccountState | undefined): MenuLockState | null {
  return state === 'SUSPENDED' || state === 'BANNED' ? state : null;
}

/** The lock carried by a `403 MENU_LOCKED`, or `null` for any other error. */
export function menuLockFromError(e: unknown): MenuLockState | null {
  if (!isApiError(e) || !e.is('MENU_LOCKED')) return null;
  // `details` is code-specific; for `MENU_LOCKED` it is `{ account_state }`.
  const state = (e.details as unknown as { account_state?: RestaurantAccountState } | undefined)?.account_state;
  return menuLockFromAccountState(state) ?? 'SUSPENDED';
}

/** Never red: a lock is a status, not a fault. Amber `warning`, like the app's other notices. */
export function MenuLockedNotice({ state }: { state: MenuLockState }) {
  return state === 'BANNED' ? (
    <Banner
      variant="warning"
      testId="menu-locked"
      title="Your menu is locked because this restaurant is banned"
      description="You can still read your menu, but nothing on it can be changed. Contact Halal Goes support if you have questions."
    />
  ) : (
    <Banner
      variant="warning"
      testId="menu-locked"
      title="Your menu is locked while this restaurant is suspended"
      description="You can still read your menu, but items, prices, photos and availability can't be changed until the suspension is lifted. Contact Halal Goes support to resolve it. Your opening hours can still be changed."
    />
  );
}
