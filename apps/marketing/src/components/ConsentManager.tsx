'use client';

import { useEffect, useRef } from 'react';
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
 * The notice is `position: fixed` in the same bottom corner as the sticky ask,
 * and it is taller than it. Nothing downstream can reserve room for something
 * it cannot measure, so the notice publishes its own footprint the way the
 * sticky bar publishes `--sticky-cta-h`:
 *
 *   --hg-consent-h            how much of the bottom of the viewport the notice
 *                             occupies, its 16px offset included. 0 when there
 *                             is no notice — which is every visitor who has
 *                             already chosen.
 *   html[data-consent-notice] set while it is up. The sticky bar stands down on
 *                             it (see `consent.css`): two asks in one corner is
 *                             one ask nobody can reach, and consent comes first.
 *
 * Only the NOTICE is measured, never the preferences modal — that one is a
 * centred dialog over the whole page, and reserving its height at the bottom of
 * the document would be meaningless.
 */
const NOTICE = '.cookie-notice:not(.cookie-modal-notice)';

function trackNotice(container: HTMLElement): () => void {
  const root = document.documentElement;
  let watched: Element | null = null;
  const sizeWatch =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => publish());

  function publish() {
    const notice = container.querySelector(NOTICE);
    if (!notice) {
      root.style.setProperty('--hg-consent-h', '0px');
      root.removeAttribute('data-consent-notice');
      return;
    }
    // Measured from the bottom of the viewport rather than read off the
    // element's height: the notice is bottom-anchored with its own offset, and
    // what everything downstream needs is the band it covers, not its box.
    const { top } = notice.getBoundingClientRect();
    const covered = Math.max(0, Math.round(window.innerHeight - top));
    root.style.setProperty('--hg-consent-h', `${covered}px`);
    root.setAttribute('data-consent-notice', '');
  }

  function rebind() {
    const notice = container.querySelector(NOTICE);
    if (notice !== watched) {
      if (watched) sizeWatch?.unobserve(watched);
      if (notice) sizeWatch?.observe(notice);
      watched = notice;
    }
    publish();
  }

  // Klaro mounts, re-renders and unmounts the notice itself, so the container
  // is watched rather than the notice: there is no moment we are handed to
  // hook, and a missed unmount would leave a reserve for a notice that is gone.
  const treeWatch = new MutationObserver(rebind);
  treeWatch.observe(container, { childList: true, subtree: true });
  window.addEventListener('resize', publish);
  rebind();

  return () => {
    treeWatch.disconnect();
    sizeWatch?.disconnect();
    window.removeEventListener('resize', publish);
    root.style.removeProperty('--hg-consent-h');
    root.removeAttribute('data-consent-notice');
  };
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
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    return el ? trackNotice(el) : undefined;
  }, []);

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

  return <div ref={host} id="hg-consent" className="klaro" />;
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
