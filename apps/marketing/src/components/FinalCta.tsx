import { WaitlistForm } from '@/components/WaitlistForm';
import { type AudienceTrack } from '@/lib/audiences';

/**
 * The form again, at the bottom.
 *
 * Someone who has read the whole page should not have to scroll back up to act,
 * and someone who was ready at the top already used the hero form. The id is
 * distinct from the hero's so the header link keeps pointing at the first one.
 */
export function FinalCta({ track }: { track: AudienceTrack }) {
  return (
    <section className="mt-16 md:mt-24">
      <div className="box-border rounded-2xl bg-feedback-success-tint px-5 py-8 md:grid md:grid-cols-[1fr_440px] md:items-center md:gap-16 md:px-12 md:py-12">
        <div>
          <h2 className="m-0 font-display text-marketing-section-phone text-fg-primary md:text-marketing-section">
            {track.finalCta.heading}
          </h2>
          <p className="mt-3 mb-0 max-w-[40ch] text-body-lg leading-relaxed text-mk-ink md:mt-4 md:text-[19px]">
            {track.finalCta.body}
          </p>
        </div>
        <div className="mt-6 md:mt-0">
          <WaitlistForm track={track} context="final" />
        </div>
      </div>
    </section>
  );
}
