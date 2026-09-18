/**
 * Typographic defaults for CMS content.
 *
 * Post bodies come from Markdoc, so the elements are whatever the writer used.
 * Styling them here rather than per-element keeps the writer free and keeps the
 * type on the tokens. Deliberately narrow: ~68 characters is the readable
 * measure, and a blog post is the only place on this site with long prose.
 */
export function Prose({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="
        max-w-[68ch] text-body-lg leading-relaxed text-fg-primary
        [&_a]:text-fg-link [&_a]:underline [&_a]:underline-offset-4
        [&_blockquote]:my-6 [&_blockquote]:border-s-2 [&_blockquote]:border-line-brand [&_blockquote]:ps-5 [&_blockquote]:text-accent-600
        [&_code]:rounded-xs [&_code]:bg-surface-sunken [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-mono-sm
        [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:font-display [&_h2]:text-heading-xl [&_h2]:text-fg-primary
        [&_h3]:mt-8 [&_h3]:mb-2 [&_h3]:font-display [&_h3]:text-heading-lg [&_h3]:text-fg-primary
        [&_hr]:my-10 [&_hr]:border-line-decorative
        [&_li]:my-1.5
        [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:ps-6
        [&_p]:my-4
        [&_pre]:my-6 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-surface-sunken [&_pre]:p-4
        [&_pre_code]:bg-transparent [&_pre_code]:p-0
        [&_strong]:font-semibold
        [&_ul]:my-4 [&_ul]:list-disc [&_ul]:ps-6
      "
    >
      {children}
    </div>
  );
}
