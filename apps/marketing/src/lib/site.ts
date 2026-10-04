/**
 * One place for the things every page's <head> needs.
 *
 * Absolute URLs are not optional here: a relative canonical is ignored, and an
 * Open Graph image without an origin does not render in any scraper.
 */

/** The one origin that is allowed to be indexed. */
const CANONICAL_ORIGIN = 'https://halalgoes.com';

function resolveOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');

  // On a production deploy, the project's STABLE alias — never VERCEL_URL.
  //
  // VERCEL_URL is the per-deployment host (landing-dgmn9nq3r-….vercel.app). It
  // is unique to one build, it is covered by Deployment Protection, and it stops
  // resolving once that deployment is superseded. Baking it into og:image meant
  // every share card pointed at a host that was first auth-walled and then dead,
  // so the scraper got no image and fell back to whatever it could find — which
  // is how a HalalGoes link came to unfurl as a Vercel card.
  //
  // VERCEL_PROJECT_PRODUCTION_URL is the alias that survives the next deploy,
  // which is the only kind of URL that belongs in metadata somebody else caches.
  const productionHost =
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (process.env.VERCEL_ENV === 'production' && productionHost) {
    return `https://${productionHost}`;
  }

  // Previews keep self-referential canonicals: a preview's own host is the right
  // answer there, and pointing every preview page at production is what makes
  // Google pick the wrong URL. Cards on a preview rot with the deploy, which is
  // correct — the preview rots with it too.
  const vercelHost = process.env.NEXT_PUBLIC_VERCEL_URL ?? process.env.VERCEL_URL;
  if (vercelHost) return `https://${vercelHost}`;

  return CANONICAL_ORIGIN;
}

export const SITE = {
  name: 'HalalGoes',
  /** en-CA throughout: this is an Ontario product, priced in CAD. */
  locale: 'en_CA',
  origin: resolveOrigin(),
} as const;

export function absolute(path: string): string {
  return new URL(path, `${SITE.origin}/`).toString();
}

/**
 * Whether this build is the real, indexable site.
 *
 * Deliberately a three-way AND, because the default origin is the production
 * one and "forgot to set the env var" must not be the same thing as "this is
 * production". A preview deploy that gets indexed competes with production for
 * the brand term and is very hard to undo, so every signal has to agree:
 *
 *   - Vercel says this is the production environment (or we are not on Vercel),
 *   - this is a production build rather than `next dev`,
 *   - and the resolved origin really is the canonical one.
 */
export function isProductionSite(): boolean {
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') return false;
  if (process.env.NODE_ENV !== 'production') return false;
  return SITE.origin === CANONICAL_ORIGIN;
}

/**
 * Per-page metadata.
 *
 * Exists because two things are easy to get wrong page by page and were:
 *
 *  - **Titles doubled.** The root layout sets `template: '%s — HalalGoes'`, so
 *    a page title that already carries the brand renders as
 *    "Deliver with HalalGoes — HalalGoes". Pass the bare page title.
 *  - **og:url pinned to the root.** Next merges Open Graph from the layout and
 *    does NOT derive `url` from the page's canonical, so every page inherited
 *    the homepage's og:url until it was set explicitly. A share of /riders that
 *    unfurls as the homepage is a silent loss of every social click.
 */
export function pageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}) {
  const url = absolute(path);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url },
  };
}
