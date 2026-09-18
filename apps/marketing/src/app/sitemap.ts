import type { MetadataRoute } from 'next';
import { listPosts } from '@/lib/posts';
import { absolute } from '@/lib/site';

/**
 * The three tracks plus the blog. Drafts are excluded because listPosts()
 * excludes them — a sitemap that lists a URL returning 404 is a crawl budget
 * problem and a Search Console error, not a head start.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await listPosts();

  return [
    { url: absolute('/'), changeFrequency: 'weekly', priority: 1 },
    { url: absolute('/restaurants'), changeFrequency: 'weekly', priority: 0.8 },
    { url: absolute('/riders'), changeFrequency: 'weekly', priority: 0.8 },
    { url: absolute('/blog'), changeFrequency: 'weekly', priority: 0.6 },
    ...posts.map((post) => ({
      url: absolute(`/blog/${post.slug}`),
      lastModified: new Date(`${post.publishedAt}T00:00:00Z`),
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    })),
  ];
}
