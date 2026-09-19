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
        {/* Phone only: the sage plate sits BEHIND the headline, so the type runs
            onto it, while the seal below sits in front and the type runs behind
            that. The two layers either side of the headline are the whole
            composition — collapsing them into one would either hide the end of
            the first line or float the seal off its plate. On desktop there is
            no overlap at all, so the plate and seal become one element. */}
        <div
          aria-hidden="true"
          className="absolute -end-1 top-1 z-0 size-34 rounded-full bg-mk-seal-plate lg:hidden"
        />

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
        <h1 className="relative z-10 m-0 font-display text-marketing-hero-phone text-fg-primary max-lg:[font-size:min(4.5rem,calc(18.8vw-7.6px))] lg:w-max lg:flex-none lg:text-marketing-hero">
          {track.headline.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </h1>

        <div className="absolute end-1 top-3 z-20 lg:static lg:z-auto lg:grid lg:size-74 lg:flex-none lg:place-items-center lg:rounded-full lg:bg-mk-seal-plate">
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
