import { type AudienceTrack } from '@/lib/audiences';

/**
 * Native <details>, not a JavaScript accordion.
 *
 * It works before hydration, it is keyboard-operable and screen-reader-correct
 * for free, and the browser's find-in-page can open a closed answer — which a
 * div-based accordion silently cannot. The only thing added is the marker.
 */
export function Faq({ track }: { track: AudienceTrack }) {
  return (
    <section id="faq" className="mt-16 scroll-mt-6 md:mt-24">
      <div className="md:grid md:grid-cols-[1fr_440px] md:items-start md:gap-16">
        <h2 className="m-0 max-w-[12ch] font-display text-marketing-section-phone text-fg-primary md:text-marketing-section">
          Questions people ask.
        </h2>

        <div className="mt-6 md:mt-0">
          {track.faq.map(({ q, a }) => (
            <details key={q} className="group border-b border-line-decorative">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 py-4 text-body-lg leading-snug font-semibold text-fg-primary [&::-webkit-details-marker]:hidden">
                {q}
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                  className="mt-1 block flex-none text-mk-ink transition-transform duration-[180ms] ease-[var(--hg-ease-spring)] group-open:rotate-45 motion-reduce:transition-none"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </summary>
              <p className="mt-0 mb-4 max-w-[58ch] text-body-md leading-relaxed text-mk-ink">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
