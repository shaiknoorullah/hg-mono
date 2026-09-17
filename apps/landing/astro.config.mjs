// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import sitemap from '@astrojs/sitemap';

// Halal Goes marketing site. Three static pages + one on-demand API route
// (/api/waitlist). Static by default; the only client JS is a ~4-line head
// script, one IntersectionObserver and the form handler.
//
// Creative direction: docs/design/landing-creative-direction.md
// Every factual claim on the site is sourced in src/lib/claims.ts.
export default defineConfig({
  site: 'https://halalgoes.com',
  output: 'static',
  adapter: vercel(),
  integrations: [sitemap()],
  // The audience toggle used to live in a query string. Anything already
  // pointing at it — a QR code, a printed card, a shared link — lands on the
  // real page instead of a homepage that silently reconfigures itself.
  redirects: {
    '/restaurants': '/for-restaurants',
    '/for-restaurant': '/for-restaurants',
    '/partners': '/for-restaurants',
    '/standard': '/verification',
    '/how-we-check': '/verification',
  },
  build: { inlineStylesheets: 'auto' },
  devToolbar: { enabled: false },
});
