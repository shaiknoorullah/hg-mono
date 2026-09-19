import type { MetadataRoute } from 'next';
import { listPosts } from '@/lib/posts';
import { absolute } from '@/lib/site';

/**
 * The three tracks, the documents of record, and the blog. Drafts are excluded
 * because listPosts() excludes them — a sitemap that lists a URL returning 404
 * is a crawl budget problem and a Search Console error, not a head start.
 *
 * /verification is priority 0.9: it is the page the product's whole argument
 * rests on, and the one somebody forwards.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await listPosts();

  return [
    { url: absolute('/'), changeFrequency: 'weekly', priority: 1 },
    { url: absolute('/restaurants'), changeFrequency: 'weekly', priority: 0.8 },
    { url: absolute('/riders'), changeFrequency: 'weekly', priority: 0.8 },
    { url: absolute('/verification'), changeFrequency: 'monthly', priority: 0.9 },
    { url: absolute('/blog'), changeFrequency: 'weekly', priority: 0.6 },
    { url: absolute('/privacy'), changeFrequency: 'yearly', priority: 0.3 },
    { url: absolute('/terms'), changeFrequency: 'yearly', priority: 0.3 },
    ...posts.map((post) => ({
      url: absolute(`/blog/${post.slug}`),
      lastModified: new Date(`${post.publishedAt}T00:00:00Z`),
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    })),
  ];
}
