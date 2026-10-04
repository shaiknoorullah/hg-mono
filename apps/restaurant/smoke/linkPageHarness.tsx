import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

/**
 * Shared set-up for the email-link page tests: a scripted `fetch`, a well-formed token, and
 * the app mounted at a path with a probe that reports where the router is now (to prove the
 * token left the address bar).
 */
export const TOKEN = 'tok_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';

export interface Call {
  path: string;
  url: string;
  body: Record<string, unknown> | null;
}

type Reply = Response | Error | ((call: Call) => Response | Error);

export function json(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
  if (body === undefined) return new Response(null, { status, headers });
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export function apiError(status: number, code: string, headers: Record<string, string> = {}): Response {
  return json(status, { error: { code, message: code, request_id: 'req-test' } }, headers);
}

/**
 * Answers each request by its path (`/v1/auth/password/reset`), in order when a path has a
 * list of replies. An `Error` reply is a dropped connection. Unscripted paths answer an
 * empty 200.
 */
export function scriptFetch(script: Record<string, Reply | Reply[]>): Call[] {
  const calls: Call[] = [];
  const queues = new Map(Object.entries(script).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(String(input));
      const text = request.method === 'GET' ? '' : await request.clone().text();
      const call: Call = { path: new URL(request.url).pathname, url: request.url, body: text ? JSON.parse(text) : null };
      calls.push(call);
      const queue = queues.get(call.path);
      let reply: Reply | undefined = queue && queue.length > 1 ? queue.shift() : queue?.[0];
      if (typeof reply === 'function') reply = reply(call);
      if (reply instanceof Error) throw reply;
      return reply ?? json(200, { data: { current_step: 'DONE', progress_percent: 100 } });
    }),
  );
  return calls;
}

export const where: { pathname: string; search: string } = { pathname: '', search: '' };

function LocationProbe() {
  const location = useLocation();
  where.pathname = location.pathname;
  where.search = location.search;
  return null;
}

export async function mountAt(entry: string) {
  const { Root } = await import('../src/App');
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Root />
      <LocationProbe />
    </MemoryRouter>,
  );
}

export function installDomShims() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }),
  });
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

/** A 12-hour clock time as `formatClockTime` writes it in en-CA, e.g. "2:05 p.m.". */
export const TWELVE_HOUR = /\b(1[0-2]|[1-9]):[0-5]\d\s?[ap]\.?m\.?/i;
