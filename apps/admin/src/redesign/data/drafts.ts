/**
 * Unsent input survives a session that ends under the page.
 *
 * A panel with typed input (an invite, a decision note, a refund) saves it here as the person
 * types; after they sign in again the panel restores it. `sessionStorage` is per tab and gone
 * when the tab closes. Every access is wrapped: storage can be blocked, full or absent.
 *
 * Drafts belong to one account: the key carries the signed-in `account_id`, so a different
 * person signing in on the same tab never gets the previous person's typing (which can hold
 * customer details). They are also all dropped when someone signs out on purpose, and when a
 * different account signs in through the session-ended dialog (`clearAllDrafts`).
 */
import { getSession } from './session';

const PREFIX = 'hg-admin-draft:';

function storageKey(key: string): string | null {
  const account = getSession().principal?.account_id;
  return account ? `${PREFIX}${account}:${key}` : null;
}

export function saveDraft<T>(key: string, value: T): void {
  const full = storageKey(key);
  if (!full) return;
  try {
    sessionStorage.setItem(full, JSON.stringify(value));
  } catch {
    /* storage unavailable: the draft lives only in memory */
  }
}

export function loadDraft<T>(key: string): T | null {
  const full = storageKey(key);
  if (!full) return null;
  try {
    const raw = sessionStorage.getItem(full);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  const full = storageKey(key);
  if (!full) return;
  try {
    sessionStorage.removeItem(full);
  } catch {
    /* nothing to clear */
  }
}

/** Drops every draft in this tab, whoever typed it. */
export function clearAllDrafts(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) sessionStorage.removeItem(k);
  } catch {
    /* storage unavailable: nothing was kept */
  }
}
