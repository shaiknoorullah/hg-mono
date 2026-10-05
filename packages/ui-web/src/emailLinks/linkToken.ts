/**
 * The single-use token an email link carries (`/reset-password?token=…`), handled as the
 * credential it is (issue #329):
 *
 * - read once, at boot, before the app's own modules load, so before any network call;
 * - removed from the address bar at once with `history.replaceState`, so it is not shown,
 *   bookmarked, kept in history or sent on as a referrer;
 * - the page's referrer policy switched to `no-referrer` while a link page is open;
 * - kept in this module's memory only, and handed to the page for that one path.
 *
 * Nothing here logs it. This module imports nothing, so each app's `linkTokenBoot.ts` can run
 * it first: import it as `@hg/ui-web/link-token`, never through `@hg/ui-web/email-links`,
 * whose other modules load React and the API client.
 */
let captured: { path: string; token: string } | null = null;

/**
 * Takes the token out of the address when the page is one of `linkPaths` (the app's pages an
 * email links to), and switches that page's referrer policy to `no-referrer`.
 */
export function captureLinkToken(linkPaths: readonly string[]): void {
  captured = null;
  const url = new URL(window.location.href);
  if (!linkPaths.includes(url.pathname)) return;

  let meta = document.querySelector<HTMLMetaElement>('meta[name="referrer"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'referrer';
    document.head.appendChild(meta);
  }
  meta.content = 'no-referrer';

  const token = url.searchParams.get('token');
  if (token === null) return;
  url.searchParams.delete('token');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  captured = { path: url.pathname, token };
}

/** The token captured for `path`, or `null` when the link opened another page or had none. */
export function linkTokenFor(path: string): string | null {
  return captured?.path === path ? captured.token : null;
}
