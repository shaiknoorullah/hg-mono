import { notFound } from 'next/navigation';

/**
 * The editor never serves unauthenticated in production.
 *
 * In local storage mode Keystatic writes to the working tree and has no login —
 * which is exactly right on a developer's machine and exactly wrong on a public
 * origin. On a read-only serverless filesystem it would fail rather than leak,
 * but "fails by accident" is not a security posture. So: in production the
 * route exists only once GitHub mode is configured, and GitHub mode makes the
 * editor sign in and commit as a real person.
 */
export default function KeystaticLayout({ children }: { children: React.ReactNode }) {
  // All three, not just the two secrets. The slug is what keystatic.config.ts
  // reads to choose GitHub mode in the BROWSER, so credentials-without-slug is
  // a deploy whose editor loads, signs in, and then cannot read a single file.
  // Refusing to serve it is better than serving that.
  const githubConfigured =
    !!process.env.KEYSTATIC_GITHUB_CLIENT_ID &&
    !!process.env.KEYSTATIC_GITHUB_CLIENT_SECRET &&
    !!process.env.NEXT_PUBLIC_KEYSTATIC_GITHUB_APP_SLUG;

  if (process.env.NODE_ENV === 'production' && !githubConfigured) notFound();

  return children;
}

// Belt and braces alongside the Disallow in robots.ts: robots.txt is a request,
// a noindex header is an instruction.
export const metadata = { robots: { index: false, follow: false } };
