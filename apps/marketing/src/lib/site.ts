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

  // Vercel hands every preview and branch deploy its own host. Using it keeps a
  // preview's canonicals self-referential rather than pointing every preview
  // page at production, which is what makes Google pick the wrong URL.
  const vercelHost = process.env.NEXT_PUBLIC_VERCEL_URL ?? process.env.VERCEL_URL;
  if (vercelHost) return `https://${vercelHost}`;

  return CANONICAL_ORIGIN;
}

export const SITE = {
  name: 'Halal Goes',
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
 *  - **Titles doubled.** The root layout sets `template: '%s — Halal Goes'`, so
 *    a page title that already carries the brand renders as
 *    "Deliver with Halal Goes — Halal Goes". Pass the bare page title.
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
