/**
 * The public sign-in calls, as outcomes a screen switches on (WP2). Every failure is branched
 * on `error.code`, never on the status alone (the backend answers a temporary lock with 429
 * where the contract lists 423), and every rate limit carries the wait the server set:
 * `Retry-After` counted from the response's own `Date` header, not this device's clock.
 */
import type { FetchResponse } from 'openapi-fetch';
import type { Schema } from '@hg/api-client';
import { client } from '../data/client';
import { serverNow } from '../data/serverClock';
import { useServerResource, type ServerResource } from '../data/useServerResource';
import { call } from '../data/call';

/** A wait the server set (`Retry-After`), as the Countdown takes it. */
export interface ServerWait {
  /** The server's clock when it answered (its `Date` header). */
  serverNow: string;
  expiresAt: string;
  windowSeconds: number;
  /**
   * This device's clock when the answer arrived. A wait that travels in router state (and so
   * survives a reload in `history.state`) is aged by it, never restarted.
   */
  receivedAt?: number;
}

/**
 * The wait as it stands now: `serverNow` moved on by the time spent on this device since the
 * answer arrived, or null when it has run out.
 */
export function agedWait(wait: ServerWait | undefined | null, now: number = Date.now()): ServerWait | null {
  if (!wait) return null;
  const elapsed = Math.max(0, now - (wait.receivedAt ?? now));
  const left = Date.parse(wait.expiresAt) - Date.parse(wait.serverNow) - elapsed;
  if (!(left > 0)) return null;
  return { ...wait, serverNow: new Date(Date.parse(wait.serverNow) + elapsed).toISOString(), receivedAt: now };
}

export type Attempt<T> =
  | { ok: true; data: T; status: number; serverDate: number }
  | { ok: false; network: true }
  | {
      ok: false;
      network: false;
      status: number;
      code: string;
      details: unknown;
      /** Seconds from `Retry-After` (a delay or an HTTP date), or null when absent. */
      retryAfter: number | null;
      serverDate: number;
    };

/**
 * The server's clock at the response: its `Date` header. Cross-origin the browser can only read
 * it once the API exposes it (`services/hg` CORS lists only X-Request-ID, Idempotency-Replayed
 * and Retry-After today: Needs API); until then the redesign's server clock stands in.
 */
function serverDateOf(response: Response): number {
  const raw = response.headers.get('Date');
  const parsed = raw ? Date.parse(raw) : Number.NaN;
  return Number.isNaN(parsed) ? serverNow() : parsed;
}

function retryAfterOf(response: Response, serverDate: number): number | null {
  const raw = response.headers.get('Retry-After')?.trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : Math.max(0, Math.round((at - serverDate) / 1000));
}

/** Runs one openapi-fetch call and settles it: never throws. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the payload type is the envelope's `data`
export async function attempt<T extends Record<string | number, any>, E, O extends `${string}/${string}`>(
  run: () => Promise<FetchResponse<T, E, O>>,
): Promise<Attempt<NonNullable<FetchResponse<T, E, O>['data']> extends { data: infer D } ? D : undefined>> {
  let result: FetchResponse<T, E, O>;
  try {
    result = await run();
  } catch {
    return { ok: false, network: true };
  }
  const { response } = result;
  const serverDate = serverDateOf(response);
  if (response.ok) {
    const body = result.data as { data?: unknown } | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ok: true, data: body?.data as any, status: response.status, serverDate };
  }
  const err = (result.error as { error?: { code?: string; details?: unknown } } | undefined)?.error;
  return {
    ok: false,
    network: false,
    status: response.status,
    code: err?.code ?? '',
    details: err?.details ?? null,
    retryAfter: retryAfterOf(response, serverDate),
    serverDate,
  };
}

/** A wait of `seconds` from the server's `Date`. */
export function serverWait(serverDate: number, seconds: number): ServerWait {
  return {
    serverNow: new Date(serverDate).toISOString(),
    expiresAt: new Date(serverDate + seconds * 1000).toISOString(),
    windowSeconds: seconds,
    receivedAt: Date.now(),
  };
}

export const HG_CLIENT = { 'X-HG-Client': 'restaurant-web' } as const;

export type PublicConfig = Schema['PublicConfig'];

/** `getPublicConfig`: support phone and hours, `terms_version`, the order response window. */
export function usePublicConfig(): ServerResource<PublicConfig> {
  return useServerResource(() => call(client.GET('/v1/config/public')) as Promise<PublicConfig>);
}

export interface SupportContact {
  /** E.164, for the `tel:` link. */
  tel: string;
  display: string;
  hours: string | null;
}

/**
 * Partner support, only when the server says it is on (Ref-SupportUnavailable): the phone and
 * hours are never hard-coded and are absent when `support_enabled` is false.
 */
export function supportOf(config: PublicConfig | null): SupportContact | null {
  if (!config?.support_enabled || !config.support_phone_e164) return null;
  return { tel: config.support_phone_e164, display: formatPhone(config.support_phone_e164), hours: config.support_hours ?? null };
}

/** `undefined` until the config is on screen, so nothing about support is guessed. */
export function supportFrom(config: ServerResource<PublicConfig>): SupportContact | null | undefined {
  return config.data ? supportOf(config.data) : undefined;
}

/** "+18005550199" →"1-800-555-0199" (North American numbers); anything else as given. */
export function formatPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `1-${m[1]}-${m[2]}-${m[3]}` : e164;
}

/** The order response window in words ("3 minutes"), from config (180 s); never a constant. */
export function responseWindowWords(config: PublicConfig | null): string {
  const seconds = config?.restaurant_response_window_seconds ?? 180;
  if (seconds % 60 === 0) {
    const m = seconds / 60;
    return `${m} minute${m === 1 ? '' : 's'}`;
  }
  return `${seconds} seconds`;
}

/** Device convenience: the last email that signed in here, so a "Sign in again" keeps it. */
const LAST_EMAIL_KEY = 'hg_restaurant_last_email_v1';

export function rememberedEmail(): string {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}

export function rememberEmail(email: string): void {
  try {
    localStorage.setItem(LAST_EMAIL_KEY, email);
  } catch {
    /* storage blocked: nothing to remember */
  }
}

/** A plausible full address: something@something.tld (the server has the last word). */
export function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
