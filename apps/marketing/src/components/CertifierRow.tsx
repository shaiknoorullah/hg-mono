import Link from 'next/link';

/**
 * The three bodies whose certificates satisfy check H2 (issuer accepted),
 * per decision S-11.
 *
 * Names only, never marks: the names are factual, the logos need permission
 * (docs/marketing/copy-deck.md, "not publishable"). The rings are drawn from
 * type so nothing here is a borrowed asset.
 */

const CERTIFIERS = [
  { abbr: 'HMA', sub: 'Canada', size: 'text-[12px] lg:text-[14px]' },
  // One character wider than the others, so it steps down a point to keep the
  // same optical margin inside the ring.
  { abbr: 'HFSAA', sub: null, size: 'text-[11px] lg:text-[13px]' },
  { abbr: 'ISNA', sub: 'Canada', size: 'text-[12px] lg:text-[14px]' },
] as const;

export function CertifierRow({ className = '' }: { className?: string }) {
  return (
    <section aria-labelledby="certifiers-heading" className={className}>
      {/* Both children are whitespace-nowrap and neither may shrink, so the row
          has to be allowed to WRAP rather than be pinned to one line: at 320px
          the heading and the link together need ~350px inside a 280px box, and
          a fixed-height nowrap row turns that into sideways page scroll. The
          44px row height and the single line come back at md, where they fit.
          The link keeps its own min-h-11, so the tap target survives the wrap. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 lg:h-11 lg:flex-nowrap lg:justify-start lg:gap-7">
        <h2
          id="certifiers-heading"
          className="flex-none text-[10px] leading-none font-semibold tracking-[0.16em] whitespace-nowrap text-mk-ink uppercase lg:text-marketing-eyebrow"
        >
          Certificates we recognise
        </h2>
        <Link
          href="#seven-checks"
          className="inline-flex min-h-11 flex-none items-center gap-1.5 py-2.5 text-[13px] leading-none font-bold whitespace-nowrap text-mk-ink underline decoration-[var(--hg-mk-accent)] decoration-2 underline-offset-4 lg:text-label-lg"
        >
          The seven checks
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--hg-mk-accent)"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="block lg:size-4"
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </Link>
      </div>

      <div className="mt-1.5 flex items-center gap-2.5 lg:gap-3">
        {CERTIFIERS.map(({ abbr, sub, size }) => (
          <div
            key={abbr}
            className="flex size-14 flex-none flex-col items-center justify-center rounded-full border-[1.5px] border-mk-ink leading-none text-mk-ink lg:size-18"
          >
            <span className={`font-extrabold tracking-[-0.01em] ${size}`}>{abbr}</span>
            {sub ? (
              <span className="mt-[3px] text-[7px] font-bold tracking-[0.16em] uppercase lg:mt-1 lg:text-[8px]">
                {sub}
              </span>
            ) : null}
          </div>
        ))}
        <p className="m-0 ms-1.5 max-w-[250px] text-[12px] leading-snug font-medium text-mk-ink lg:ms-2.5 lg:text-body-sm">
          Only these three bodies, and only while the certificate is in date.
        </p>
      </div>
    </section>
  );
}
