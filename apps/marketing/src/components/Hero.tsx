import { CertifierRow } from '@/components/CertifierRow';
import { LaunchEyebrow } from '@/components/LaunchEyebrow';
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
 *
 * THERE IS NO SEAL HERE, and that is the decision rather than an omission.
 *
 * Everywhere else on the site the seal is attached to something: the stamp on
 * Form HG-7, issued only on 7/7; the specimen record card; the badge on a
 * listing inside the device screens; the certified state in the four-state
 * grid. In the hero it was attached to nothing — no restaurant, no certificate,
 * no issuer, no date. A mark we drew ourselves, floating above a headline that
 * already says the same words.
 *
 * That is the one thing this brand argues against. A seal is supposed to mean a
 * specific record exists and a named person checked it on a named day; a seal
 * that means "we are the kind of company that has seals" is the decoration the
 * whole verification instrument exists to replace. It also had to be sized,
 * placed and kept out of the type's way on every track and every width, and it
 * lost that fight on two of three tracks.
 *
 * What carries the claim instead is already here and is real: the headline says
 * it, and CertifierRow immediately below names the three bodies whose
 * certificates we accept. Three named accreditors beat one self-issued badge.
 */
export function Hero({ track, launch }: { track: AudienceTrack; launch: LaunchState }) {
  return (
    <section className="mt-6 lg:mt-10">
      <LaunchEyebrow state={launch} />

      <div className="mt-5 lg:mt-[22px]">
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
        <h1 className="m-0 font-display text-marketing-hero-phone text-fg-primary max-lg:[font-size:min(4.5rem,calc(18.8vw-7.6px))] lg:text-marketing-hero">
          {track.headline.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </h1>

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
