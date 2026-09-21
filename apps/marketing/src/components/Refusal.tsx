import { DISCLAIMER } from '@/lib/claims';

/**
 * Turn the hardest legal constraint into the most trustworthy sentence on the
 * site. Humility at scale reads as confidence.
 *
 * This copy currently lives in the product as small grey disclaimer text. It is
 * the best writing we have and it belongs at display size.
 *
 * The right quarter stays empty on purpose. That emptiness is the section's
 * whole design — the visual equivalent of not over-claiming. Do not fill it.
 *
 * The band is the ACCENT ink, not green: solid green is reserved to
 * `color.halal.*` (invariant 10, lint rule L-4), and a page-wide green field
 * behind a sentence about not certifying food would be the exact confusion this
 * section exists to remove.
 */
export function Refusal() {
  return (
    <section
      aria-labelledby="refusal-heading"
      className="mt-16 rounded-3xl bg-fg-primary px-5 py-10 text-surface-base lg:mt-24 lg:px-12 lg:py-16"
    >
      <h2
        id="refusal-heading"
        className="m-0 max-w-[18ch] font-display text-marketing-section-phone leading-[1.1] lg:text-marketing-section"
      >
        We don’t certify food.
        <br />
        We don’t make rulings.
        <br />
        That isn’t ours to make.
      </h2>

      <p className="mt-7 mb-0 max-w-[58ch] text-body-lg leading-relaxed opacity-90 lg:text-[19px]">
        We do the clerical work. We get the certificate, we read it, we check it’s real and still in force,
        and we put our name against the date we checked. What the badge shows is what the certificate says —
        including who issued it, so you can decide whether that issuer meets your standard. We don’t rank
        issuers and we don’t score them.
      </p>

      {/* The fixed copy the product itself is pinned to, quoted verbatim. */}
      <p className="mt-8 mb-0 max-w-[62ch] border-t border-current/20 pt-5 font-mono text-[11px] leading-relaxed tracking-[0.03em] opacity-80 lg:text-[12px]">
        {DISCLAIMER}
      </p>
    </section>
  );
}
