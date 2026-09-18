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
  { abbr: 'HMA', sub: 'Canada', size: 'text-[12px] md:text-[14px]' },
  // One character wider than the others, so it steps down a point to keep the
  // same optical margin inside the ring.
  { abbr: 'HFSAA', sub: null, size: 'text-[11px] md:text-[13px]' },
  { abbr: 'ISNA', sub: 'Canada', size: 'text-[12px] md:text-[14px]' },
] as const;

export function CertifierRow({ className = '' }: { className?: string }) {
  return (
    <section aria-labelledby="certifiers-heading" className={className}>
      <div className="flex h-11 items-center justify-between gap-3 md:justify-start md:gap-7">
        <h2
          id="certifiers-heading"
          className="flex-none text-[10px] leading-none font-semibold tracking-[0.16em] whitespace-nowrap text-mk-ink uppercase md:text-marketing-eyebrow"
        >
          Certificates we recognise
        </h2>
        <Link
          href="#seven-checks"
          className="inline-flex min-h-11 flex-none items-center gap-1.5 py-2.5 text-[13px] leading-none font-bold whitespace-nowrap text-mk-ink underline decoration-[var(--hg-mk-accent)] decoration-2 underline-offset-4 md:text-label-lg"
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
            className="block md:size-4"
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </Link>
      </div>

      <div className="mt-1.5 flex items-center gap-2.5 md:gap-3">
        {CERTIFIERS.map(({ abbr, sub, size }) => (
          <div
            key={abbr}
            className="flex size-14 flex-none flex-col items-center justify-center rounded-full border-[1.5px] border-mk-ink leading-none text-mk-ink md:size-18"
          >
            <span className={`font-extrabold tracking-[-0.01em] ${size}`}>{abbr}</span>
            {sub ? (
              <span className="mt-[3px] text-[7px] font-bold tracking-[0.16em] uppercase md:mt-1 md:text-[8px]">
                {sub}
              </span>
            ) : null}
          </div>
        ))}
        <p className="m-0 ms-1.5 max-w-[250px] text-[12px] leading-snug font-medium text-mk-ink md:ms-2.5 md:text-body-sm">
          Only these three bodies, and only while the certificate is in date.
        </p>
      </div>
    </section>
  );
}
