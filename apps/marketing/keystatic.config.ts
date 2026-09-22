import { collection, config, fields } from '@keystatic/core';

/**
 * The CMS. Git IS the database — every post is a Markdoc file in this repo, so
 * an edit is a commit, review is a diff, and rollback is a revert. There is no
 * database to run, no second copy of the content, and nothing to migrate.
 *
 * Storage is local by default, which is what `pnpm --filter @hg/marketing dev`
 * needs and what makes the editor work with no credentials at all. Set
 * KEYSTATIC_GITHUB_CLIENT_ID / _SECRET (and NEXT_PUBLIC_KEYSTATIC_GITHUB_APP_SLUG)
 * and it switches to GitHub mode, where the editor commits through the GitHub
 * App on behalf of whoever signed in. See src/app/keystatic/README for the
 * reason the route refuses to serve an unauthenticated editor in production.
 */

/**
 * Which storage this config selects — and it must answer the same on the server
 * and in the browser, because this file is imported by both.
 *
 * It is gated on the NEXT_PUBLIC_ slug for exactly that reason. Next only
 * inlines NEXT_PUBLIC_* into the client bundle, so gating on
 * KEYSTATIC_GITHUB_CLIENT_ID — which is server-only, and must stay that way —
 * made the two disagree: the route handler ran GitHub mode while the editor in
 * the browser ran local mode. Sign-in succeeded, then the editor asked for
 * `/api/keystatic/tree/main`, which is a LOCAL-mode endpoint the GitHub-mode
 * handler does not serve. It answered 404 with the body `Not Found`, the client
 * called JSON.parse on it, and the collection died with
 * "Unexpected token 'N', \"Not Found\" is not valid JSON".
 *
 * So the slug is load-bearing, not decoration: it is the one signal about
 * GitHub mode that both halves can see. `.env.example` says all four variables
 * ship together, and `src/app/keystatic/layout.tsx` now refuses to serve the
 * editor unless they do, so "slug set but credentials missing" 404s rather than
 * rendering an editor that cannot read anything.
 */
const githubConfigured = !!process.env.NEXT_PUBLIC_KEYSTATIC_GITHUB_APP_SLUG;

export default config({
  storage: githubConfigured
    ? { kind: 'github', repo: { owner: 'shaiknoorullah', name: 'hg-mono' } }
    : { kind: 'local' },

  ui: {
    brand: { name: 'Halal Goes' },
  },

  collections: {
    posts: collection({
      label: 'Blog posts',
      slugField: 'title',
      path: 'apps/marketing/content/posts/*',
      format: { contentField: 'content' },
      entryLayout: 'content',
      columns: ['title', 'publishedAt'],
      schema: {
        title: fields.slug({
          name: { label: 'Title', validation: { length: { min: 1, max: 70 } } },
          slug: {
            label: 'URL slug',
            description: 'Becomes /blog/<slug>. Changing it after publishing breaks existing links.',
          },
        }),

        // Deliberately required and deliberately capped. It is the meta
        // description AND the card on the index, so a post without one either
        // ships a truncated first paragraph to Google or nothing at all.
        summary: fields.text({
          label: 'Summary',
          description: 'One or two sentences. Used as the meta description and on the blog index.',
          multiline: true,
          validation: { length: { min: 50, max: 160 } },
        }),

        publishedAt: fields.date({
          label: 'Published',
          description: 'A date in the future keeps the post out of the index, the sitemap and /blog.',
          validation: { isRequired: true },
        }),

        // Every claim on this site has a source. A post is not exempt.
        sources: fields.array(
          fields.object({
            label: fields.text({ label: 'Label' }),
            url: fields.url({ label: 'URL' }),
          }),
          {
            label: 'Sources',
            description:
              'Anything factual in the post is cited here. See docs/marketing/copy-deck.md — nothing goes on the site that is not in the claims register.',
            itemLabel: (props) => props.fields.label.value || 'Source',
          },
        ),

        content: fields.markdoc({ label: 'Content' }),
      },
    }),
  },
});
