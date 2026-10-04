import { join } from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,

  // The repo root, not this app. Next traces which files a build output needs,
  // and in a monorepo it guesses the root from the nearest lockfile — which on
  // Vercel, with the Root Directory set to apps/marketing, is the wrong answer.
  // The blog reads content from apps/marketing/content via a reader rooted at
  // the repo root, so a wrong trace root means missing files rather than a
  // warning.
  outputFileTracingRoot: join(import.meta.dirname, '../..'),

  // @hg/ui-web ships TypeScript source rather than a build. Today this app
  // imports only its two stylesheets, so nothing here needs compiling — but the
  // moment a component is imported it does, and discovering that as a runtime
  // syntax error is worse than carrying one line of config.
  transpilePackages: ['@hg/ui-web', '@hg/brand'],

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Stops a browser second-guessing a Content-Type — the vector for
          // serving a user-supplied file as script.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Send the full URL same-origin, only the origin cross-origin. The
          // referrer is how Umami attributes traffic, so `no-referrer` would
          // quietly make every visit direct.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Nothing here is meant to be framed. Clickjacking a waitlist form is
          // not a big prize, but it costs nothing to refuse.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
        ],
      },
    ];
  },
};

export default config;
