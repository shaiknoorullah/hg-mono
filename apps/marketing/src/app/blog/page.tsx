import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/PageShell';
import { listPosts } from '@/lib/posts';
import { pageMetadata } from '@/lib/site';

export const metadata: Metadata = pageMetadata({
  title: 'Writing',
  description:
    'How halal certification actually works in Canada, what the seven checks are for, and what we find when we run them.',
  path: '/blog',
});

const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

export default async function BlogIndex() {
  const posts = await listPosts();

  return (
    <PageShell>
      <section className="mt-8 md:mt-12">
        <h1 className="m-0 max-w-[16ch] font-display text-marketing-section-phone text-fg-primary md:text-marketing-section">
          Writing
        </h1>
        <p className="mt-4 mb-0 max-w-[52ch] text-body-lg leading-relaxed text-mk-ink md:text-[19px]">
          How halal certification actually works in Canada, what the seven checks are for, and what we find
          when we run them.
        </p>

        {/* The empty state is the one that ships first, so it is the one that has
            to be right. It says what will be here and offers the way back, rather
            than rendering a heading over nothing. */}
        {posts.length === 0 ? (
          <div className="mt-8 max-w-[52ch] rounded-2xl border border-line-decorative bg-surface-raised p-6 md:mt-12 md:p-8">
            <p className="m-0 font-display text-heading-lg text-fg-primary">Nothing published yet.</p>
            <p className="mt-2 mb-0 text-body-md leading-relaxed text-mk-ink">
              The first pieces are being written. In the meantime, the seven checks — and what each one
              catches — are set out in full on the home page.
            </p>
            <Link
              href="/#seven-checks"
              className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-label-lg font-bold text-mk-ink underline decoration-[var(--hg-mk-accent)] decoration-2 underline-offset-4"
            >
              Read the seven checks
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--hg-mk-accent)"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="block"
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </Link>
          </div>
        ) : (
          <ul className="mt-8 m-0 list-none p-0 md:mt-12">
            {posts.map((post) => (
              <li key={post.slug} className="border-t border-line-decorative">
                <Link href={`/blog/${post.slug}`} className="group block py-6 no-underline md:py-8">
                  <time
                    dateTime={post.publishedAt}
                    className="font-mono text-[11px] leading-none font-medium tracking-[0.08em] text-mk-ink uppercase"
                  >
                    {formatDate(post.publishedAt)}
                  </time>
                  <h2 className="mt-3 mb-0 max-w-[24ch] font-display text-heading-xl text-fg-primary group-hover:underline group-hover:decoration-[var(--hg-mk-accent)] group-hover:decoration-2 group-hover:underline-offset-4 md:text-[34px] md:leading-tight">
                    {post.title}
                  </h2>
                  <p className="mt-2 mb-0 max-w-[60ch] text-body-md leading-relaxed text-mk-ink">
                    {post.summary}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
