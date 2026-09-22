import type { MetadataRoute } from 'next';
import { absolute, isProductionSite } from '@/lib/site';

/**
 * The unfurl bots, which are not indexers.
 *
 * Each fetches one URL to build a share card and none of them puts the page in
 * a search result. LinkedIn and Slack honour robots.txt before unfurling, so a
 * blanket `Disallow: /` silently kills the card on exactly the two surfaces a
 * pre-launch link actually gets shared on. Facebook and X ignore robots.txt,
 * which is why the failure looked partial rather than total.
 *
 * Keeping them out of the wholesale disallow costs nothing: a card is a link
 * somebody already has, not a way to find the page.
 */
const UNFURL_BOTS = [
  'facebookexternalhit',
  'Twitterbot',
  'LinkedInBot',
  'Slackbot-LinkExpanding',
  'WhatsApp',
  'TelegramBot',
  'Discordbot',
];

/**
 * Preview and local builds are disallowed wholesale. A preview origin that gets
 * indexed competes with production for the brand term and is very hard to undo.
 *
 * The unfurl bots are the one exception, above. The indexing risk that motivated
 * the blanket rule is carried by `robots: { index: false }` in the root layout
 * as well, which is the stronger of the two signals — robots.txt only asks a
 * crawler not to fetch, and Google will still index a URL it finds linked.
 */
export default function robots(): MetadataRoute.Robots {
  if (!isProductionSite()) {
    return {
      rules: [
        ...UNFURL_BOTS.map((userAgent) => ({ userAgent, allow: '/' })),
        { userAgent: '*', disallow: '/' },
      ],
    };
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
