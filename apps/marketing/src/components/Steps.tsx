import { type AudienceTrack } from '@/lib/audiences';

/**
 * Three steps. Numbered in the mono face so they read as the same document
 * furniture as the verification sheet rather than as decoration.
 */
export function Steps({ track }: { track: AudienceTrack }) {
  return (
    <section className="mt-16 md:mt-24">
      <h2 className="m-0 font-display text-marketing-section-phone text-fg-primary md:text-marketing-section">
        {track.steps.heading}
      </h2>

      <ol className="mt-6 grid list-none grid-cols-1 gap-px p-0 md:mt-10 md:grid-cols-3 md:gap-8">
        {track.steps.items.map((step, i) => (
          <li key={step.title} className="border-t border-line-decorative pt-5 md:pt-6">
            <span className="font-mono text-[11px] leading-none font-medium tracking-[0.08em] text-mk-ink tabular-nums">
              {String(i + 1).padStart(2, '0')}
            </span>
            <h3 className="mt-3 mb-0 font-display text-heading-xl text-fg-primary">{step.title}</h3>
            <p className="mt-2 mb-0 text-body-md leading-relaxed text-mk-ink">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
