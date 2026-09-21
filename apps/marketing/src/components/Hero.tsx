import { CertifierRow } from '@/components/CertifierRow';
import { LaunchEyebrow } from '@/components/LaunchEyebrow';
import { Seal } from '@/components/Seal';
import { WaitlistForm } from '@/components/WaitlistForm';
import { type AudienceTrack } from '@/lib/audiences';
import { type LaunchState } from '@/lib/launch';

/**
 * The hero, ported from artboard F0 (desktop) and E1-m (phone).
 *
 * The two differ on purpose and the difference is in the tokens, not here:
 * marketing.hero is 118px at weight 650, marketing.heroPhone is 72px at weight
 * 800. Bricolage Grotesque carries an optical-size axis, so the same face needs
 * LESS weight as it grows — setting the phone value on desktop is what made the
 * first desktop pass read as too heavy.
 */
export function Hero({ track, launch }: { track: AudienceTrack; launch: LaunchState }) {
  return (
    <section className="mt-6 lg:mt-10">
      <LaunchEyebrow state={launch} />

      <div className="relative mt-5 lg:mt-[22px] lg:flex lg:items-center lg:gap-12">
        {/* The phone hero is 72px by the artboard, and 72px does not fit every
            phone: "commission" is up to 5.32× its font size in Bricolage Bold, so it
            needs 373px inside a 350px box at 390 and a 320px box at 360 — 3px of
            sideways page scroll on an iPhone, 53px on a common Android.

            So the token is a CEILING below md, not a fixed size: 72px wherever it
            fits, and (100vw − 40px gutters) ÷ 5.32 where it does not. The named
            utility still supplies line-height, weight and tracking; only the size
            is overridden, and only below md.

            5.32 is measured, not guessed — the widest line across the three
            tracks, divided by the font size. Re-measure it if a headline changes:
            range.selectNodeContents(span) on each line, widest ÷ fontSize. */}
        <h1 className="m-0 font-display text-marketing-hero-phone text-fg-primary max-lg:[font-size:min(4.5rem,calc(18.8vw-7.6px))] lg:w-max lg:flex-none lg:text-marketing-hero">
          {track.headline.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </h1>

        {/* The seal sits ABOVE the headline on a phone and beside it on desktop.
            It used to be absolutely positioned over the headline's top-right,
            with the type running behind it by design — and on the customer
            track, whose longest line is "delivered.", that just about held.

            It did not hold anywhere else. The seal swallowed the end of
            "0% commission at launch." and of "The delivery fee is yours.",
            leaving "0% commis⬤" and "fee is yo⬤" on the two tracks whose
            headline IS the offer. A decorative overlap that eats a word is not
            decorative, and this is the one element on the site that must never
            be ambiguous: the seal is the product's single claim, and a reader
            should never be working out which letters it is covering.

            So the two stop sharing space: on a phone the seal sits under the
            headline and above the lede, right-aligned, between the claim and
            its explanation. The headline stays the highest thing on the page,
            which is what the fold is for. Desktop is untouched — the flex row
            already put them side by side with no overlap to solve. */}
        <div className="mb-6 grid size-34 place-items-center rounded-full bg-mk-seal-plate max-lg:ms-auto lg:mb-0 lg:size-74 lg:flex-none">
          <Seal size={120} className="lg:hidden" />
          <Seal size={240} className="hidden lg:block" />
        </div>
      </div>

      <div className="mt-5 lg:mt-7 lg:grid lg:grid-cols-[1fr_440px] lg:grid-rows-[auto_1fr] lg:gap-x-12">
        <p className="m-0 max-w-[560px] font-display text-marketing-lede-phone text-mk-ink lg:col-start-1 lg:row-start-1 lg:text-marketing-lede">
          {track.lede}
        </p>

        <div id="waitlist" className="mt-5 scroll-mt-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:self-end">
          <WaitlistForm track={track} context="hero" />
        </div>

        <CertifierRow className="mt-8 lg:col-start-1 lg:row-start-2 lg:mt-0 lg:self-end" />
      </div>
    </section>
  );
}
