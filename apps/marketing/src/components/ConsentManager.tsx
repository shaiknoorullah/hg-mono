'use client';

import { useEffect } from 'react';
import { KLARO_CONFIG } from '@/lib/consent';
// Klaro's layout stylesheet, then ours on top. The JS is lazy (below) but the
// CSS is not: it is ~13KB minified, all of it scoped under `.klaro`, and
// loading it late would flash an unstyled notice. The no-css JS build is used
// precisely so this sheet is a normal stylesheet the bundler can handle rather
// than a runtime <style> injection.
import 'klaro/dist/klaro.min.css';
import '@/styles/consent.css';

declare global {
  interface Window {
    klaro?: { show: () => void; setup: (config: unknown) => void };
    klaroConfig?: unknown;
  }
}

/**
 * Loads Klaro after the page has painted.
 *
 * Klaro bundles its own renderer and is ~60KB. Importing it at module scope
 * would put that on the critical path of a page whose whole job is a fast first
 * impression, to render a bar that nobody needs in the first 200ms. So it is a
 * dynamic import fired from an effect: the notice appears a beat late, and the
 * LCP element does not wait for it.
 *
 * Nothing is tracked in the meantime — every service is `default: false`, and
 * the Umami tag in the layout is inert until Klaro rewrites it.
 */
export function ConsentManager() {
  useEffect(() => {
    let cancelled = false;

    // `requestIdleCallback` where it exists, a timeout where it does not
    // (Safari). Either way: after paint, never during.
    const schedule = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 400));

    const handle = schedule(() => {
      if (cancelled) return;
      void import('klaro/dist/klaro-no-css').then((klaro) => {
        if (cancelled) return;
        window.klaroConfig = KLARO_CONFIG;
        window.klaro = klaro as unknown as Window['klaro'];
        (klaro as unknown as { setup: (c: unknown) => void }).setup(KLARO_CONFIG);
      });
    });

    return () => {
      cancelled = true;
      window.cancelIdleCallback?.(handle as number);
    };
  }, []);

  return <div id="hg-consent" className="klaro" />;
}

/**
 * The footer link that reopens the choices.
 *
 * Rendered whether or not Klaro has loaded: if someone clicks before it has,
 * the click loads it and then shows the modal, rather than doing nothing.
 */
export function ConsentPreferencesButton({ className = '' }: { className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        if (window.klaro) {
          window.klaro.show();
          return;
        }
        void import('klaro/dist/klaro-no-css').then((klaro) => {
          window.klaroConfig = KLARO_CONFIG;
          window.klaro = klaro as unknown as Window['klaro'];
          (klaro as unknown as { setup: (c: unknown) => void }).setup(KLARO_CONFIG);
          window.klaro?.show();
        });
      }}
    >
      Cookie preferences
    </button>
  );
}
