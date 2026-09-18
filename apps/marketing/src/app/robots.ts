import type { MetadataRoute } from 'next';
import { absolute, isProductionSite } from '@/lib/site';

/**
 * Preview and local builds are disallowed wholesale. A preview origin that gets
 * indexed competes with production for the brand term and is very hard to undo.
 */
export default function robots(): MetadataRoute.Robots {
  if (!isProductionSite()) {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // The CMS and its API. Neither is content, and /keystatic is an editor.
        disallow: ['/keystatic', '/api/'],
      },
    ],
    sitemap: absolute('/sitemap.xml'),
    host: absolute('/'),
  };
}
