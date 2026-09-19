import { PageShell } from '@/components/PageShell';

/**
 * The shell for text of record — /verification, /privacy, /terms.
 *
 * Ported from the Astro site's Doc.astro, and it keeps the one thing that
 * mattered about it: every document rendered here is VERSIONED and DATED in the
 * masthead. If we quietly change what we promise, the change is visible. That is
 * the same argument the product makes about a restaurant's certificate, applied
 * to ourselves, so it is not a detail to drop for tidiness.
 *
 * Numbered sections come from `DocSection`, which draws the ordinal as document
 * furniture rather than baking it into the heading text — so a section can be
 * inserted without rewriting every heading after it.
 */

export function DocPage({
  heading,
  standfirst,
  version,
  effective,
  children,
  footnote,
}: {
  heading: string;
  standfirst: string;
  version: string;
  effective: string;
  children: React.ReactNode;
  footnote?: React.ReactNode;
}) {
  return (
    <PageShell>
      <article className="pb-4">
        <header className="border-b border-line-decorative pb-8 md:pb-11">
          <p className="m-0 font-mono text-[11px] leading-none font-medium tracking-[0.1em] text-mk-ink uppercase md:text-[12px]">
            {version} · Effective {effective}
          </p>
          <h1 className="mt-4 mb-0 max-w-[18ch] font-display text-marketing-section-phone text-fg-primary md:mt-[18px] md:text-marketing-section">
            {heading}
          </h1>
          <p className="mt-4 mb-0 max-w-[62ch] text-body-lg leading-relaxed text-mk-ink md:mt-[18px] md:text-[19px]">
            {standfirst}
          </p>
        </header>

        <div className="pt-9 md:pt-13">{children}</div>

        <p className="mt-2 mb-0 max-w-[74ch] font-mono text-[11px] leading-relaxed tracking-[0.03em] text-mk-ink">
          {footnote ?? (
            <>
              {version} · effective {effective} · Halal Goes · Ontario, Canada. This document applies to this
              website and its waitlist. It is not a contract for a delivery service — there isn’t one yet.
            </>
          )}
        </p>
      </article>
    </PageShell>
  );
}

/**
 * One numbered section. `n` is the ordinal as it should read, e.g. "01".
 *
 * The body is styled with descendant selectors rather than per-element classes
 * because the content is prose written as prose: a paragraph should not need a
 * className to be a paragraph. The list marker is a rule, not a bullet — the
 * same mark the seven checks use, so a document and a form read as the same
 * family of object.
 */
export function DocSection({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section
      className="
        mb-9 max-w-[700px] md:mb-11
        [&_a]:font-semibold [&_a]:text-fg-primary [&_a]:underline [&_a]:decoration-line-decorative [&_a]:underline-offset-[3px]
        hover:[&_a]:decoration-[var(--hg-mk-accent)]
        [&_code]:rounded-xs [&_code]:bg-surface-sunken [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-mono-sm
        [&_h3]:mt-6 [&_h3]:mb-1.5 [&_h3]:text-body-lg [&_h3]:font-bold [&_h3]:text-fg-primary
        [&_li]:relative [&_li]:mb-2.5 [&_li]:ps-[22px] [&_li]:text-body-md [&_li]:leading-relaxed [&_li]:text-mk-ink
        [&_li]:before:absolute [&_li]:before:start-0 [&_li]:before:top-[0.72em] [&_li]:before:h-px [&_li]:before:w-2.5 [&_li]:before:bg-fg-tertiary [&_li]:before:content-['']
        [&_p]:mb-3.5 [&_p]:max-w-[66ch] [&_p]:text-body-md [&_p]:leading-relaxed [&_p]:text-mk-ink
        [&_strong]:font-bold [&_strong]:text-fg-primary
        [&_ul]:m-0 [&_ul]:mb-4 [&_ul]:list-none [&_ul]:max-w-[66ch] [&_ul]:p-0
      "
    >
      <h2 className="mb-3 text-heading-lg leading-tight font-extrabold tracking-[-0.02em] text-fg-primary">
        <span className="mb-2 block font-mono text-[11px] font-medium tracking-[0.1em] text-mk-ink">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * A value we do not have yet, drawn as a ruled blank rather than invented.
 *
 * This is the specimen record card's device turned on ourselves: where a value
 * does not exist, show the shape of it and say so. A made-up hello@ on the page
 * that documents our rigour would be self-refuting.
 */
export function RuledBlank({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="mt-2 rounded-xl border border-line-decorative bg-surface-raised px-5 py-5">
      <p className="m-0 font-mono text-[11px] leading-none font-medium tracking-[0.06em] text-mk-ink uppercase">
        {label}
      </p>
      <p className="mt-3 mb-0">
        <span
          role="img"
          aria-label="not yet published"
          className="inline-block w-[min(24ch,100%)] border-t border-dashed border-line-interactive align-[0.32em] opacity-60"
        />
      </p>
      {children ? <div className="mt-3 [&_p]:m-0 [&_p]:text-body-sm [&_p]:leading-relaxed [&_p]:text-mk-ink">{children}</div> : null}
    </div>
  );
}
