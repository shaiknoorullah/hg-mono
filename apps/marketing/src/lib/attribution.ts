/**
 * First-party attribution, ported from the Astro site's Base.astro + forms.ts.
 *
 * Session-scoped and deliberately thin: which campaign a visitor arrived on, and
 * what the referring page was. No identifier, no cookie, nothing that survives
 * the tab closing — which is why it runs without consent and why the privacy
 * policy can describe it in one sentence.
 *
 * Read back only at submit time, so a visitor who never fills the form leaves
 * nothing behind but a sessionStorage key their browser discards.
 */

const KEY = 'hg-utm';

const PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'] as const;

export type Attribution = Record<string, string>;

/** Call once on mount. No-ops when the URL carries no campaign parameters, so a
 *  direct visit never overwrites the campaign that actually brought someone in. */
export function captureAttribution(): void {
  try {
    const search = new URLSearchParams(window.location.search);
    const found: Attribution = {};
    for (const key of PARAMS) {
      const value = search.get(key);
      if (value) found[key] = value.slice(0, 200);
    }
    if (Object.keys(found).length === 0) return;
    found.landing_at = new Date().toISOString();
    found.referrer = document.referrer || '';
    sessionStorage.setItem(KEY, JSON.stringify(found));
  } catch {
    // Private mode, blocked storage, a browser that throws on access. Attribution
    // is a nice-to-have; it never gets to break a signup.
  }
}

export function readAttribution(): Attribution {
  try {
    const stored = sessionStorage.getItem(KEY);
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Attribution = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}
