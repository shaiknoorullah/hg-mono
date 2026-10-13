/**
 * `return_to` after sign-in (the shell's "Sign in again" sends it): only a same-origin relative
 * path. It must start with exactly one `/`; `//host` (protocol-relative), `/\host` (browsers
 * read the backslash as a slash), any scheme (`https:`, `javascript:`), and control characters
 * are refused, so a crafted sign-in link can never send an owner to another site.
 */
const PUBLIC_PATHS = ['/login', '/register', '/check-email', '/verify-email', '/forgot-password', '/reset-password'];

export function safeReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null;
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, 'https://restaurant.invalid');
  } catch {
    return null;
  }
  if (url.origin !== 'https://restaurant.invalid') return null;
  // Back to a sign-in page would loop.
  if (PUBLIC_PATHS.includes(url.pathname)) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
