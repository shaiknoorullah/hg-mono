import { SEAL } from '@/lib/claims';

/**
 * Chain of custody, stated as a fact.
 *
 * Shipped as a document card with three ruled rows, in exactly the grammar of
 * the verification sheet. That is a DECISION, not a placeholder: the alternative
 * until real photography exists is stock, and a stock photo of a stranger's hand
 * on a stranger's doorstep is worse than type on this page.
 *
 * Forbidden here permanently: connecting lines, arrows, numbered rails, sticky
 * columns, scroll-scrub, anything that plays.
 *
 * Carefully NOT claimed: that a broken seal blocks the handoff or triggers a
 * refund. The contract says twice that it does not — the customer files a tamper
 * report, the rider never does, and nothing auto-fails the order or the payment.
 */
export function Sealed() {
  return (
    <section aria-labelledby="sealed-heading" className="mt-16 lg:mt-24 lg:grid lg:grid-cols-[4fr_7fr] lg:items-start lg:gap-16">
      <div>
        <p className="m-0 font-mono text-marketing-eyebrow-phone text-mk-ink uppercase lg:text-marketing-eyebrow">
          After you order
        </p>
        <h2
          id="sealed-heading"
          className="mt-3 mb-0 font-display text-marketing-section-phone text-fg-primary lg:mt-4 lg:text-marketing-section"
        >
          Sealed at the kitchen. Opened by you.
        </h2>
        <p className="mt-4 mb-0 max-w-[48ch] text-body-lg leading-relaxed text-mk-ink">
          Verifying the kitchen is only half of it. The other half is making sure nothing happened to the bag
          between their pass and your door.
        </p>
      </div>

      <ol className="mt-7 grid list-none rounded-2xl border border-line-decorative bg-surface-raised p-5 lg:mt-0 lg:px-10 lg:py-9">
        {SEAL.map((step, i) => (
          <li
            key={step.step}
            className="border-t border-line-decorative py-4 first:border-t-0 first:pt-0 last:pb-0 lg:py-[22px]"
          >
            <span className="mb-2 block font-mono text-[10.5px] leading-none font-medium tracking-[0.08em] text-mk-ink uppercase">
              {String(i + 1).padStart(2, '0')} · {step.step}
            </span>
            <p className="m-0 mb-1.5 text-body-lg leading-tight font-bold text-fg-primary">{step.title}</p>
            <p className="m-0 max-w-[56ch] text-body-md leading-relaxed text-mk-ink">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
