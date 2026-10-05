import { vi } from 'vitest';
import { installDomShims as installJsdomShims } from '@hg/ui-web/testing';

/**
 * Shared set-up for the email-link page tests: a scripted `fetch` and a well-formed token.
 * The pages read the real address (`window.location`), not the console's hash router, so a
 * test opens one with `history.replaceState` before mounting `Root`.
 */
export const TOKEN = 'tok_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';

export interface Call {
  path: string;
  url: string;
  body: Record<string, unknown> | null;
  /** The address bar when the request went out. */
  address: string;
}

type Reply = Response | Error;

export function json(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
  if (body === undefined) return new Response(null, { status, headers });
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export function apiError(status: number, code: string, headers: Record<string, string> = {}): Response {
  return json(status, { error: { code, message: code, request_id: 'req-test' } }, headers);
}

/** Answers by path, in order when a path has a list. An `Error` is a dropped connection. */
export function scriptFetch(script: Record<string, Reply | Reply[]>): Call[] {
  const calls: Call[] = [];
  const queues = new Map(Object.entries(script).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  vi.mocked(globalThis.fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(String(input));
    const text = request.method === 'GET' ? '' : await request.clone().text();
    const call: Call = {
      path: new URL(request.url).pathname,
      url: request.url,
      body: text ? JSON.parse(text) : null,
      address: window.location.href,
    };
    calls.push(call);
    const queue = queues.get(call.path);
    const reply = queue && queue.length > 1 ? queue.shift() : queue?.[0];
    if (reply instanceof Error) throw reply;
    return reply ?? json(200, {});
  });
  return calls;
}

export function openAddress(pathAndQuery: string) {
  window.history.replaceState(null, '', pathAndQuery);
}

/**
 * Opens an emailed link the way a browser does: the real address, then the boot step that
 * takes the token out of it (`src/linkTokenBoot.ts`, which `main.tsx` imports first).
 */
export async function openLink(address: string) {
  // Imported before the address is set: the boot module captures once, on first import.
  const { LINK_PATHS } = await import('../src/linkTokenBoot');
  const { captureLinkToken } = await import('@hg/ui-web/link-token');
  openAddress(address);
  captureLinkToken(LINK_PATHS);
}

/** Puts the address and the referrer policy back between tests. */
export function resetAddress() {
  openAddress('/');
  document.querySelector('meta[name="referrer"]')?.remove();
}

/** jsdom's missing browser APIs (`@hg/ui-web/testing`), and a `fetch` that answers an empty 200. */
export function installDomShims() {
  installJsdomShims();
  // The module graph touches `fetch` at import time (see login-gate.test.tsx): stub it first.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })),
  );
}

/** A 12-hour clock time as `formatClockTime` writes it in en-CA, e.g. "2:05 p.m.". */
export const TWELVE_HOUR = /\b(1[0-2]|[1-9]):[0-5]\d\s?[ap]\.?m\.?/i;
