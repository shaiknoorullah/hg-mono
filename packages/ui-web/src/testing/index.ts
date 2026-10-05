/**
 * Test helpers for the apps that build on `@hg/ui-web`. Imported by tests only, never by
 * app code.
 */

/**
 * The browser APIs jsdom lacks and the apps' screens call: `matchMedia`, `ResizeObserver` and
 * `Element.scrollIntoView`. Each is an inert stub: no media query matches, nothing is observed,
 * nothing scrolls. Call it before the first render, e.g. `beforeAll(installDomShims)`.
 */
export function installDomShims(): void {
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

/**
 * A stand-in for the realtime `WebSocket`, for `RealtimeProvider`'s `createSocket`. Records every
 * frame the client sends (parsed) and lets a test open, feed and drop the connection:
 * `open()` → the client resubscribes; `push(frame)` → a server envelope (`v: 1` and `ts` filled
 * in); `drop(code)` → an abnormal close, so the client reconnects with a fresh ticket.
 */
export class FakeRealtimeSocket {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string = '') {}
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  push(frame: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify({ v: 1, ts: '2026-10-05T12:00:00.000Z', ...frame }) });
  }
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}
