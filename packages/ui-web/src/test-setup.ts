import '@testing-library/jest-dom/vitest';

/**
 * jsdom does not implement the APIs Radix's floating primitives call the moment they open
 * (`ResizeObserver`, `DOMRect.fromRect`, pointer capture, `scrollIntoView`). Without
 * these, a keyboard test against a menu or a dialog fails for reasons that have nothing to
 * do with the component under test.
 */

if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: ResizeObserverStub,
    writable: true,
  });
}

if (!('DOMRect' in globalThis)) {
  Object.defineProperty(globalThis, 'DOMRect', {
    value: class DOMRectStub {
      constructor(
        public x = 0,
        public y = 0,
        public width = 0,
        public height = 0,
      ) {}
      static fromRect(rect?: { x?: number; y?: number; width?: number; height?: number }) {
        return new DOMRectStub(rect?.x, rect?.y, rect?.width, rect?.height);
      }
      get top() {
        return this.y;
      }
      get bottom() {
        return this.y + this.height;
      }
      get left() {
        return this.x;
      }
      get right() {
        return this.x + this.width;
      }
      toJSON() {
        return { ...this };
      }
    },
    writable: true,
  });
}

if (typeof Element !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => undefined;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => undefined;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
  }
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}
