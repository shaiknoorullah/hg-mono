import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

const SECTIONS = ['halal', 'primitives', 'content', 'navigation', 'feedback', 'data', 'contrast'];

const EXPECTED = [
  'HALAL_DISPLAY_STATE_MISSING', // the missing-state specimen, on purpose
  'no copy mapped for error code', // the unmapped-code specimen, on purpose
  'unsupported value for OrderState', // the unknown-enum specimen, on purpose
];

describe('gallery smoke', () => {
  beforeAll(() => {
    (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = () => null;
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
    (window as unknown as { scrollTo: unknown }).scrollTo = () => {};
    // jsdom has no layout, so these are absent; both are used by the library.
    Element.prototype.scrollIntoView = function scrollIntoView() {};
    (Element.prototype as unknown as { hasPointerCapture: unknown }).hasPointerCapture = () => false;
    (Element.prototype as unknown as { releasePointerCapture: unknown }).releasePointerCapture = () => {};
  });

  beforeEach(() => { vi.resetModules(); });

  for (const section of SECTIONS) {
    it(`renders ${section}`, async () => {
      window.history.replaceState(null, '', `/?section=${section}`);
      const { Root } = await import('../src/App');
      const errors: string[] = [];
      const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
        errors.push(args.map((a) => String(a)).join(' '));
      });
      const { container } = render(<Root />);
      spy.mockRestore();
      expect(container.querySelector(`#${section}`)).not.toBeNull();
      expect(container.textContent?.length ?? 0).toBeGreaterThan(500);
      const real = errors.filter((text) => !EXPECTED.some((ok) => text.includes(ok)));
      if (real.length) console.log('UNEXPECTED', section, real.slice(0, 5));
      expect(real).toEqual([]);
    });
  }
});
