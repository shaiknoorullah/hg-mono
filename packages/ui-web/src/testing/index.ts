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
