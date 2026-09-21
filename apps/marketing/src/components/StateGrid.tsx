import { RecordCard } from '@/components/RecordCard';
import { ISSUERS, STATES } from '@/lib/claims';

/**
 * Show the failure mode voluntarily. This is the credibility beat.
 *
 * Telling a stranger, before launch, exactly when you will refuse to vouch for
 * something is the most persuasive thing available to us — and it costs nothing,
 * because these four states already exist in the product.
 *
 * Two invariants are literally the content of this section:
 *   8 — a missing halal field renders NO badge, never an optimistic one
 *   9 — never red for a halal state. Red reads as *haram*, a religious ruling
 *       the platform does not make. Expired is cool slate: "we can't vouch."
 *
 * The specimen record is hidden on phones. It sits only a screen or two below
 * the hero there, so repeating it is redundancy rather than reinforcement and it
 * costs about 500px of scroll. On desktop the two sit far enough apart to read
 * as a callback.
 */

const MARK: Record<string, string> = {
  certified: 'bg-mk-seal shadow-[inset_0_0_0_2px_var(--hg-mk-seal-ring)]',
  expired: 'bg-mk-expired-bg',
  // Drawn but not filled in: a slate outline plus the diagonal of an unfinished
  // form.
  review:
    'shadow-[inset_0_0_0_2px_var(--hg-mk-expired-bg)] bg-[repeating-linear-gradient(-45deg,transparent_0_5px,color-mix(in_srgb,var(--hg-mk-expired-bg)_22%,transparent)_5px_7px)]',
  // No badge at all — and it must not read as a *quieter badge*. A dashed
  // hairline says "nothing has been drawn here", which is the honest mark.
  none: 'border border-dashed border-line-decorative',
};

export function StateGrid() {
  return (
    <section aria-labelledby="states-heading" className="mt-16 lg:mt-24">
      <header className="max-w-[620px]">
        <p className="m-0 font-mono text-marketing-eyebrow-phone text-mk-ink uppercase lg:text-marketing-eyebrow">
          What the badge can say
        </p>
        <h2
          id="states-heading"
          className="mt-3 mb-0 font-display text-marketing-section-phone text-fg-primary lg:mt-4 lg:text-marketing-section"
        >
          Including when we can’t vouch for a kitchen.
        </h2>
        <p className="mt-4 mb-0 text-body-lg leading-relaxed text-mk-ink">
          Four states, and only four. We’d rather show you less than show you something we can’t stand behind.
        </p>
      </header>

      {/* The one grid break on the page: offset right, off the optical left
          edge. One asymmetry in a strict grid reads as art direction; three read
          as chaos. Do not add a second. */}
      <div className="my-12 hidden ps-8 lg:block">
        <RecordCard
          specimen
          state="certified"
          caption="Specimen · what a listing’s record looks like once it passes"
          issuer={ISSUERS[0].name}
          reviews="None yet. We haven’t opened."
          className="max-w-[460px]"
        />
      </div>

      <ul className="mt-6 grid list-none grid-cols-2 gap-3 p-0 lg:mt-0 lg:grid-cols-4 lg:gap-5">
        {STATES.map((s) => (
          <li
            key={s.state}
            className="m-0 rounded-xl border border-line-decorative bg-surface-raised p-3.5 lg:p-5"
          >
            <span aria-hidden="true" className={`mb-2.5 block size-[30px] rounded-sm lg:mb-3.5 lg:size-10 ${MARK[s.state]}`} />
            <p className="m-0 mb-1.5 text-body-sm font-bold text-fg-primary">{s.label}</p>
            <p className="m-0 mb-3 text-caption leading-snug text-mk-ink">{s.body}</p>
            <p className="m-0 font-mono text-[10.5px] leading-snug tracking-[0.05em] text-mk-ink uppercase">
              {s.mono}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
