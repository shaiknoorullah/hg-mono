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
    <section className="mt-6 md:mt-10">
      <LaunchEyebrow state={launch} />

      <div className="relative mt-5 md:mt-[22px] md:flex md:items-center md:gap-12">
        {/* Phone only: the sage plate sits BEHIND the headline, so the type runs
            onto it, while the seal below sits in front and the type runs behind
            that. The two layers either side of the headline are the whole
            composition — collapsing them into one would either hide the end of
            the first line or float the seal off its plate. On desktop there is
            no overlap at all, so the plate and seal become one element. */}
        <div
          aria-hidden="true"
          className="absolute -end-1 top-1 z-0 size-34 rounded-full bg-mk-seal-plate md:hidden"
        />

        <h1 className="relative z-10 m-0 font-display text-marketing-hero-phone text-fg-primary md:w-max md:flex-none md:text-marketing-hero">
          {track.headline.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </h1>

        <div className="absolute end-1 top-3 z-20 md:static md:z-auto md:grid md:size-74 md:flex-none md:place-items-center md:rounded-full md:bg-mk-seal-plate">
          <Seal size={120} className="md:hidden" />
          <Seal size={240} className="hidden md:block" />
        </div>
      </div>

      <div className="mt-5 md:mt-7 md:grid md:grid-cols-[1fr_440px] md:grid-rows-[auto_1fr] md:gap-x-12">
        <p className="m-0 max-w-[560px] font-display text-marketing-lede-phone text-mk-ink md:col-start-1 md:row-start-1 md:text-marketing-lede">
          {track.lede}
        </p>

        <div id="waitlist" className="mt-5 scroll-mt-6 md:col-start-2 md:row-span-2 md:row-start-1 md:mt-0 md:self-end">
          <WaitlistForm track={track} context="hero" />
        </div>

        <CertifierRow className="mt-8 md:col-start-1 md:row-start-2 md:mt-0 md:self-end" />
      </div>
    </section>
  );
}
