import { createReader } from '@keystatic/core/reader';
import keystaticConfig from '../../keystatic.config';

/**
 * Reading posts off disk at build time.
 *
 * The reader is rooted at the REPO root, not the app root, because the
 * collection path in keystatic.config.ts is repo-relative — Keystatic's editor
 * resolves paths from the git root so that a future second app can share the
 * same content directory.
 */
const reader = createReader(process.cwd().replace(/\/apps\/marketing$/, ''), keystaticConfig);

export type PostSummary = {
  slug: string;
  title: string;
  summary: string;
  publishedAt: string;
};

/** A post dated in the future is a draft: it is not listed and not in the sitemap. */
function isPublished(publishedAt: string, now: Date): boolean {
  const at = new Date(`${publishedAt}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.getTime() <= now.getTime();
}

export async function listPosts(now: Date = new Date()): Promise<PostSummary[]> {
  const entries = await reader.collections.posts.all();

  return entries
    .filter((entry) => isPublished(entry.entry.publishedAt ?? '', now))
    .map((entry) => ({
      slug: entry.slug,
      title: entry.entry.title,
      summary: entry.entry.summary,
      publishedAt: entry.entry.publishedAt as string,
    }))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export async function readPost(slug: string, now: Date = new Date()) {
  const entry = await reader.collections.posts.read(slug);
  if (!entry) return null;
  // A draft is a 404 to the public, not a soft-hidden page: a URL that renders
  // for whoever guesses it is not a draft.
  if (!isPublished(entry.publishedAt ?? '', now)) return null;
  return entry;
}
