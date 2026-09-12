// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import sitemap from '@astrojs/sitemap';

// Halal Goes marketing site. Static page + one on-demand API route (/api/waitlist).
// Design implemented from the "Halal Goes Design System" Claude Design project
// (ui_kits/marketing-site), zero-JS by default; islands only for the audience
// toggle and the two waitlist forms.
export default defineConfig({
  site: 'https://halalgoes.com',
  output: 'static',
  adapter: vercel(),
  integrations: [sitemap()],
  build: { inlineStylesheets: 'auto' },
  devToolbar: { enabled: false },
});
