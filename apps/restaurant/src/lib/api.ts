/**
 * The one place this app touches `@hg/api-client`. Everything else calls `api.*`.
 *
 * Token storage: an in-memory access token plus a `localStorage` mirror so a reload
 * doesn't force a re-login during development against the mock server. A real deployment
 * additionally relies on the `hg_rt` HttpOnly refresh cookie the contract describes for
 * web surfaces (P-04) — `onUnauthorized` below is where that refresh would be wired in.
 */
import { createHgClient, type HgClient } from '@hg/api-client';

const STORAGE_KEY = 'hg_restaurant_session_v1';

export interface StoredSession {
  accessToken: string;
  restaurantId?: string;
  accountId?: string;
}

let session: StoredSession | null = null;

function readStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

session = readStoredSession();

export function getSession(): StoredSession | null {
  return session;
}

export function setSession(next: StoredSession | null) {
  session = next;
  if (next) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

const BASE_URL = import.meta.env['VITE_API_BASE_URL'] ?? 'http://localhost:4010';

export const api: HgClient = createHgClient({
  baseUrl: BASE_URL,
  clientSurface: 'restaurant-web',
  clientVersion: '0.1.0',
  getToken: () => session?.accessToken ?? null,
  onError: (err) => {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn('[hg-api]', err.code, err.message);
    }
  },
});
