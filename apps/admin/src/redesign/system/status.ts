/**
 * What the console knows about the API's health, from the two public probes (`getHealth`,
 * `getReadiness`) and the text-message sender check (`getSmsSenderStatus`).
 *
 * One module store read by two places: the System status page (`./SystemRoute`) and the system
 * banner slot (`./banners`), so "The API is not ready" is the same fact on every page. The shell
 * runs one poll every 30 seconds (`useSystemStatusPolling`); the page's "Check again" is the same
 * call.
 *
 * Rules from the boards (`ASS/System*`) and the contract:
 * - Neither probe is a source of truth about Redis or anything else the server keeps: they are a
 *   reading at a moment, shown with the time of the reading. Offline says nothing about the API.
 * - `getReadiness` documents `503` as an error envelope. `services/hg` sends the readiness body
 *   with the 503 (fixture `readiness_not_ready_503`), so the dependency it names is shown when the
 *   body has that shape, and the row says "Not reported" when it does not.
 * - Health and readiness are checked together; each may answer, time out (10 s) or fail.
 * - A timeout keeps the last full report on screen, marked as the earlier reading.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { Schema } from '@hg/api-client';

import { api } from '../data/api';
import { formatTimeWithSeconds } from '../data/format';

export type DependencyName = 'postgres' | 'redis' | 'minio' | 'stripe';
export const DEPENDENCY_ORDER: readonly DependencyName[] = ['postgres', 'redis', 'minio', 'stripe'];

export interface DependencyReading {
  readonly name: DependencyName;
  readonly ready: boolean;
  /** The server's own words. Only ever shown to admins: it can name internal addresses. */
  readonly detail: string | null;
}

export type ReadinessResult =
  | {
      readonly kind: 'answered';
      readonly ready: boolean;
      /** `null` when the answer did not say (a 503 with only an error envelope). */
      readonly dependencies: readonly DependencyReading[] | null;
      /** The error envelope's message, when that is all the 503 carried. */
      readonly message: string | null;
    }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'failed' };

export type HealthResult =
  | { readonly kind: 'ok'; readonly version: string; readonly startedAt: string }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'failed' };

export interface Reading {
  readonly at: Date;
  readonly readiness: ReadinessResult;
  readonly health: HealthResult;
}

/** What the page and the banner conclude from a reading. */
export type StatusView =
  /** All dependencies ready. */
  | 'ready'
  /** The API said it is not ready. */
  | 'not-ready'
  /** Ready, but a dependency listed as not ready: the report does not add up. */
  | 'inconsistent'
  /** The API answered but listed no dependencies. */
  | 'empty'
  /** The liveness probe answered; the readiness probe did not finish. */
  | 'readiness-timeout'
  /** Neither probe answered. */
  | 'unreachable';

export function viewOf(reading: Reading): StatusView {
  const r = reading.readiness;
  if (r.kind !== 'answered') return reading.health.kind === 'ok' ? 'readiness-timeout' : 'unreachable';
  if (!r.ready) return 'not-ready';
  if (r.dependencies !== null && r.dependencies.length === 0) return 'empty';
  if (r.dependencies !== null && r.dependencies.some((d) => !d.ready)) return 'inconsistent';
  return 'ready';
}

export interface StatusState {
  /** The latest reading, or `null` before the first one finishes. */
  readonly latest: Reading | null;
  /** The latest reading in which readiness answered with its dependencies, kept across timeouts. */
  readonly lastFull: Reading | null;
  readonly checking: boolean;
  /** Since when the API has been not ready, while it is. */
  readonly notReadySince: Date | null;
  /** Set when a not-ready API became ready: when, and since when it had not been. */
  readonly recovered: { readonly at: Date; readonly from: Date } | null;
  /** Said once, on change, in the page's status region. */
  readonly announcement: string | null;
  readonly sms: SmsState;
}

export type SmsState =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'passed' }
  | { readonly kind: 'not-checked' }
  | { readonly kind: 'failed'; readonly checkedAt: string | null; readonly failingSince: string | null; readonly message: string | null };

const INITIAL: StatusState = {
  latest: null,
  lastFull: null,
  checking: false,
  notReadySince: null,
  recovered: null,
  announcement: null,
  sms: { kind: 'unknown' },
};

let state: StatusState = INITIAL;
const listeners = new Set<() => void>();

function emit(next: StatusState): void {
  state = next;
  for (const fn of listeners) fn();
}

export function getStatus(): StatusState {
  return state;
}

export function subscribeStatus(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useStatus(): StatusState {
  return useSyncExternalStore(subscribeStatus, getStatus, getStatus);
}

/** Forgets everything (sign out, and between tests). */
export function resetStatus(): void {
  emit(INITIAL);
}

/** How long a probe may take before the page calls it unanswered. */
export const PROBE_TIMEOUT_MS = 10_000;
/** The re-check interval the page promises ("checks again every 30 seconds"). */
export const RECHECK_MS = 30_000;
const SMS_RECHECK_MS = 60_000;

function isDependencyName(value: unknown): value is DependencyName {
  return value === 'postgres' || value === 'redis' || value === 'minio' || value === 'stripe';
}

/** Reads a readiness body, or `null` when it is not one (an error envelope, say). */
export function parseReadiness(body: unknown): { ready: boolean; dependencies: DependencyReading[] } | null {
  if (!body || typeof body !== 'object') return null;
  const data = (body as { data?: unknown }).data ?? body;
  if (!data || typeof data !== 'object') return null;
  const { ready, dependencies } = data as { ready?: unknown; dependencies?: unknown };
  if (typeof ready !== 'boolean' || !Array.isArray(dependencies)) return null;
  const out: DependencyReading[] = [];
  for (const d of dependencies) {
    const item = d as { name?: unknown; ready?: unknown; detail?: unknown };
    // A name this console does not know is kept out of the table rather than guessed at.
    if (!isDependencyName(item?.name) || typeof item.ready !== 'boolean') continue;
    out.push({ name: item.name, ready: item.ready, detail: typeof item.detail === 'string' && item.detail !== '' ? item.detail : null });
  }
  return { ready, dependencies: out };
}

function withTimeout(): { signal: AbortSignal; done: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let fired = false;
  const timer = setTimeout(() => {
    fired = true;
    controller.abort();
  }, PROBE_TIMEOUT_MS);
  return { signal: controller.signal, done: () => clearTimeout(timer), timedOut: () => fired };
}

async function probeReadiness(): Promise<ReadinessResult> {
  const t = withTimeout();
  try {
    const res = await api.GET('/health/ready', { signal: t.signal });
    const body: unknown = res.data ?? res.error;
    const parsed = parseReadiness(body);
    if (parsed) return { kind: 'answered', ready: res.response.status === 503 ? false : parsed.ready, dependencies: parsed.dependencies, message: null };
    if (res.response.status === 503) {
      const message = (res.error as { error?: { message?: unknown } } | undefined)?.error?.message;
      return { kind: 'answered', ready: false, dependencies: null, message: typeof message === 'string' ? message : null };
    }
    return { kind: 'failed' };
  } catch {
    return t.timedOut() ? { kind: 'timeout' } : { kind: 'failed' };
  } finally {
    t.done();
  }
}

async function probeHealth(): Promise<HealthResult> {
  const t = withTimeout();
  try {
    const res = await api.GET('/health', { signal: t.signal });
    const data = res.data?.data;
    if (res.response.ok && data) return { kind: 'ok', version: data.version, startedAt: data.started_at };
    return { kind: 'failed' };
  } catch {
    return t.timedOut() ? { kind: 'timeout' } : { kind: 'failed' };
  } finally {
    t.done();
  }
}

let inFlight: Promise<void> | null = null;

/**
 * Runs both probes. A second call while one is running joins it. Offline is not a reading: the
 * last one stays and the page says so (the browser, not the API, is what is down).
 */
export function checkNow(): Promise<void> {
  if (inFlight) return inFlight;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve();
  emit({ ...state, checking: true });
  inFlight = (async () => {
    const [readiness, health] = await Promise.all([probeReadiness(), probeHealth()]);
    const reading: Reading = { at: new Date(), readiness, health };
    const view = viewOf(reading);
    const before = state.latest ? viewOf(state.latest) : null;
    const unhealthy = (v: StatusView | null) => v === 'not-ready' || v === 'inconsistent';

    let notReadySince = state.notReadySince;
    let recovered = state.recovered;
    let announcement = state.announcement;
    if (unhealthy(view)) {
      if (!unhealthy(before)) {
        notReadySince = reading.at;
        recovered = null;
        announcement = view === 'not-ready' ? `API not ready, ${formatTimeWithSeconds(reading.at)}` : `Report inconsistent, ${formatTimeWithSeconds(reading.at)}`;
      }
    } else if (view === 'ready' && unhealthy(before) && notReadySince) {
      recovered = { at: reading.at, from: notReadySince };
      notReadySince = null;
      announcement = `All dependencies ready again, ${formatTimeWithSeconds(reading.at)}`;
    } else if (view === 'ready') {
      notReadySince = null;
    }

    emit({
      ...state,
      latest: reading,
      lastFull: readiness.kind === 'answered' && readiness.dependencies !== null ? reading : state.lastFull,
      checking: false,
      notReadySince,
      recovered,
      announcement,
    });
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Reads the text-message sender check. Anything but a clear answer leaves the state unknown. */
export async function checkSmsSender(): Promise<void> {
  try {
    const res = await api.GET('/v1/admin/system/sms-sender');
    const data = res.data?.data as Schema['SmsSenderStatus'] | undefined;
    if (!res.response.ok || !data) return setSms({ kind: 'unknown' });
    if (data.state === 'FAILED') {
      return setSms({ kind: 'failed', checkedAt: data.checked_at, failingSince: data.failing_since, message: data.message });
    }
    setSms({ kind: data.state === 'PASSED' ? 'passed' : data.state === 'NOT_CHECKED' ? 'not-checked' : 'unknown' });
  } catch {
    setSms({ kind: 'unknown' });
  }
}

function setSms(sms: SmsState): void {
  emit({ ...state, sms });
}

/**
 * Runs the probes now and every 30 seconds while the signed-in console is open, and the sender
 * check every minute. Mounted once by the shell.
 */
export function useSystemStatusPolling(): void {
  useEffect(() => {
    void checkNow();
    void checkSmsSender();
    const probes = setInterval(() => void checkNow(), RECHECK_MS);
    const sms = setInterval(() => void checkSmsSender(), SMS_RECHECK_MS);
    const onOnline = () => void checkNow();
    window.addEventListener('online', onOnline);
    return () => {
      clearInterval(probes);
      clearInterval(sms);
      window.removeEventListener('online', onOnline);
    };
  }, []);
}
