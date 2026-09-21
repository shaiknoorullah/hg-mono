import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/site';

/**
 * The web app manifest, for the icon Android uses when somebody adds the site
 * to their home screen.
 *
 * `theme_color` is the cream, not the orange: it paints the Chrome toolbar on
 * Android, and the orange there would read as a status colour on a page that is
 * making a halal claim. `background_color` matches so the splash does not flash
 * white before the page paints.
 *
 * Two 512s on purpose. `any` keeps the rounded tile; `maskable` is the one
 * Android crops to a circle, so it carries far more padding — ship only the
 * first and the H loses its swash on most launchers, ship only the second and
 * every other surface gets a tiny mark in a big field.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE.name} — verified halal, delivered`,
    short_name: SITE.name,
    description:
      'Order from halal-certified restaurants in Ontario. Every kitchen passes seven checks against its certificate before it can take an order.',
    start_url: '/',
    display: 'standalone',
    background_color: '#FFFAEA',
    theme_color: '#FFFAEA',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
