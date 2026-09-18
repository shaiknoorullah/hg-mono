import Markdoc from '@markdoc/markdoc';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import React from 'react';
import { PageShell } from '@/components/PageShell';
import { Prose } from '@/components/Prose';
import { listPosts, readPost } from '@/lib/posts';
import { absolute, pageMetadata } from '@/lib/site';

type Params = { params: Promise<{ slug: string }> };

/** Drafts are excluded here too, so a future-dated post is not prerendered. */
export async function generateStaticParams() {
  return (await listPosts()).map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const post = await readPost(slug);
  if (!post) return {};

  const base = pageMetadata({ title: post.title, description: post.summary, path: `/blog/${slug}` });
  return {
    ...base,
    openGraph: { ...base.openGraph, type: 'article', publishedTime: post.publishedAt ?? undefined },
  };
}

export default async function PostPage({ params }: Params) {
  const { slug } = await params;
  const post = await readPost(slug);
  if (!post) notFound();

  // The reader returns { node }, not the node itself. @markdoc/markdoc is
  // pinned to ^0.4.0 to match the copy Keystatic parses with: two copies
  // type-check as incompatible and, worse, would parse and transform with
  // different versions of the same library.
  const { node } = await post.content();
  const content = Markdoc.transform(node);

  // fields.url permits an empty value, so a half-filled source row would render
  // <a href> with nothing behind it. Drop those rather than link to nowhere.
  const sources = post.sources.filter(
    (source): source is { label: string; url: string } => typeof source.url === 'string' && source.url !== '',
  );

  return (
    <PageShell>
      <article className="mt-8 md:mt-12">
        <Link
          href="/blog"
          className="inline-flex min-h-11 items-center font-mono text-[11px] leading-none font-medium tracking-[0.08em] text-accent-600 uppercase"
        >
          ← Writing
        </Link>

        <h1 className="mt-4 mb-0 max-w-[20ch] font-display text-marketing-section-phone text-fg-primary md:text-marketing-section">
          {post.title}
        </h1>
        <p className="mt-4 mb-0 max-w-[60ch] text-body-lg leading-relaxed text-accent-600 md:text-[19px]">
          {post.summary}
        </p>
        <time
          dateTime={post.publishedAt ?? undefined}
          className="mt-5 block font-mono text-[11px] leading-none font-medium tracking-[0.08em] text-accent-600 uppercase"
        >
          {post.publishedAt}
        </time>

        <hr className="mt-8 mb-8 border-line-decorative" />

        <Prose>{Markdoc.renderers.react(content, React)}</Prose>

        {/* Sources are a required field in the CMS, so they render whenever a
            post has any. Everything factual on this site is attributable. */}
        {sources.length > 0 ? (
          <section className="mt-12 max-w-[68ch] border-t border-line-decorative pt-6">
            <h2 className="m-0 font-mono text-[11px] leading-none font-semibold tracking-[0.1em] text-accent-600 uppercase">
              Sources
            </h2>
            <ol className="mt-4 m-0 list-decimal ps-5 text-body-sm leading-relaxed text-accent-600">
              {sources.map((source) => (
                <li key={source.url} className="my-1.5">
                  <a href={source.url} className="text-fg-link underline underline-offset-4">
                    {source.label || source.url}
                  </a>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </article>
    </PageShell>
  );
}
