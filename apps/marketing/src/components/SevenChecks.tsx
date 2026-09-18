/**
 * The seven checks, verbatim from docs/spec/05-admin.md H1–H7 and worded as in
 * docs/marketing/copy-deck.md.
 *
 * This is the only claim the product makes, so it is stated as a list of what
 * we do rather than as a promise about the food. Two of the seven cannot be
 * waived by a person — the spec makes them hard-computed — and saying which two
 * is the most specific, least marketing-sounding sentence available to us.
 */

type Check = {
  /** The spec's own identifier for the check (docs/spec/05-admin.md H1–H7). */
  n: string;
  text: string;
  /** Hard-computed in the spec: no reviewer can override it. */
  hard?: boolean;
};

const CHECKS: readonly Check[] = [
  { n: 'H1', text: 'The certificate is legible and complete.' },
  { n: 'H2', text: 'The issuing body is one we accept.' },
  { n: 'H3', text: 'The legal name matches the restaurant.' },
  { n: 'H4', text: 'The premises address matches the certificate.' },
  { n: 'H5', text: 'The dates are valid today.', hard: true },
  { n: 'H6', text: 'The scope covers everything sold.' },
  { n: 'H7', text: 'The certificate isn’t already in use by another restaurant.', hard: true },
];

export function SevenChecks() {
  return (
    <section id="seven-checks" className="mt-16 scroll-mt-6 md:mt-24">
      <h2 className="m-0 max-w-[16ch] font-display text-marketing-section-phone text-fg-primary md:text-marketing-section">
        Seven checks. All seven, or no seal.
      </h2>

      <div className="mt-6 md:mt-10 md:grid md:grid-cols-[1fr_440px] md:gap-12">
        <ol className="m-0 list-none p-0">
          {CHECKS.map(({ n, text, hard }) => (
            <li
              key={n}
              className="flex items-baseline gap-4 border-b border-line-decorative py-4 last:border-b-0 md:gap-6"
            >
              <span className="w-8 flex-none font-mono text-mono-sm text-fg-tertiary tabular-nums">{n}</span>
              <span className="text-body-lg text-fg-primary">{text}</span>
              {hard ? (
                <span className="ms-auto flex-none rounded-full bg-surface-sunken px-2.5 py-1 text-label-sm font-semibold whitespace-nowrap text-fg-secondary">
                  Computed
                </span>
              ) : null}
            </li>
          ))}
        </ol>

        <aside className="mt-8 box-border rounded-2xl border border-line-decorative bg-surface-raised p-6 md:mt-0 md:self-start md:p-7">
          <p className="m-0 text-body-md leading-relaxed text-accent-600">
            Five of the seven are read by a person. Two — the dates and whether the certificate is already
            in use somewhere else — are computed, and nobody at Halal Goes can override them.
          </p>
          <p className="mt-4 mb-0 text-body-md leading-relaxed text-accent-600">
            Six of seven is a rejection with a reason, not a seal. When a certificate expires the seal comes
            down the same day, and the listing shows a neutral state: we can’t currently vouch.
          </p>
          <p className="mt-4 mb-0 text-body-sm leading-relaxed text-fg-secondary">
            We don’t make religious rulings. We check certificates issued by recognised bodies and report
            what we find.
          </p>
        </aside>
      </div>
    </section>
  );
}
