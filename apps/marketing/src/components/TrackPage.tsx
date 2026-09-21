import { Checkable } from '@/components/Checkable';
import { CravingGrid } from '@/components/CravingGrid';
import { Faq } from '@/components/Faq';
import { FinalCta } from '@/components/FinalCta';
import { Hero } from '@/components/Hero';
import { JourneyChapters } from '@/components/journey/Chapters';
import { Overture } from '@/components/journey/Overture';
import { Recognition } from '@/components/Recognition';
import { Refusal } from '@/components/Refusal';
import { Sealed } from '@/components/Sealed';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { SkipLink } from '@/components/SkipLink';
import { StickyCta } from '@/components/StickyCta';
import { StateGrid } from '@/components/StateGrid';
import { Steps } from '@/components/Steps';
import { FaqLd } from '@/components/StructuredData';
import { VerificationSheet } from '@/components/VerificationSheet';
import { WhyThisExists } from '@/components/WhyThisExists';
import { TRACKS, type Audience } from '@/lib/audiences';
import { resolveLaunchState } from '@/lib/launch';

/**
 * One page shape for all three audiences. The tracks differ in copy, not in
 * structure — and the structure is where the anti-slop work lives, so it should
 * not fork three ways before there is a reason.
 *
 * Beat order merges the copy deck's with the Astro site's, which was argued
 * rather than assembled: appetite, belonging, the problem, the instrument, the
 * refusal, the failure modes, the handoff, the ask. Two placements carried over
 * because they were load-bearing:
 *
 *   - The tension beat (WhyThisExists, the CBC investigation) sits AFTER the
 *     food, never before it. As an opener it reads as a grievance.
 *   - Refusal and StateGrid sit AFTER the verification sheet. Telling someone
 *     what you refuse to claim only lands once they know what you do claim.
 *
 * Three sections are audience-scoped, because the argument genuinely differs:
 *   Recognition + CravingGrid  customer only — an owner's subject is their
 *                              certificate, not dinner, and a rider's is the fee.
 *   WhyThisExists              customer only — an owner and a rider already know
 *                              the problem; explaining it to them is condescending.
 *   Sealed                     not for restaurants — the seal binds at their
 *                              counter, but the chain after it is the customer's
 *                              and the rider's.
 *
 * Refusal, StateGrid and Checkable are shared on purpose. They are the halal
 * claim itself, and the claim does not get quieter for an audience that is
 * selling to us rather than buying from us.
 *
 * THE JOURNEY LAYER (G3) sits ON this order rather than replacing it. Two kinds
 * of thing were added and nothing was moved:
 *
 *   - Overture, once, straight after the hero. It names the chapters that
 *     follow, so a reader who meets a pinned beat knows what it is and how many
 *     are left.
 *   - Three insertion points — `verification`, `sealed`, `steps` — where
 *     `JourneyChapters` splices in whatever device chapters that track has at
 *     that point, and nothing where it has none. They sit at their content's
 *     home on purpose: the record beside the sheet that produced it, the seal
 *     beside Sealed, the door beside Steps. Bolted on as a block at the end
 *     they would be a showreel; placed here they are the same argument, moving.
 *
 * Everything else stays ordinary flow. G3's restraint is the direction — a page
 * where every section pinned would be scroll-jacking, which is the thing the
 * direction was chosen over.
 *
 * Padding is the artboards': 20px each side on phones, 56px on desktop, over a
 * 1280px content box.
 */
export function TrackPage({ audience }: { audience: Audience }) {
  const track = TRACKS[audience];
  const launch = resolveLaunchState();
  const isCustomer = audience === 'customer';

  return (
    <div className="mx-auto box-border flex min-h-dvh max-w-[1280px] flex-col px-5 pt-4 lg:px-14 lg:pt-8">
      <SkipLink />
      <SiteHeader current={audience} />
      <main id="main" className="flex-1">
        {/* The hero, with the region StickyCta watches laid over it. The bar
            appears once this has left the top of the screen — which is the
            hero's end, as before, and on a phone that is well before the hero
            has left entirely.

            A REGION, not the 1px mark this used to be. The mark sat below the
            fold at 390 and at 1024, so it was un-intersected before a jump and
            un-intersected after one; the observer delivered no second entry and
            the bar never came back for the rest of the session. A region that
            covers the hero is intersecting until the moment it is not. */}
        <div className="relative">
          <Hero track={track} launch={launch} />
          <div id="hero-zone" aria-hidden="true" className="pointer-events-none absolute inset-0" />
        </div>
        <Overture audience={audience} />
        {isCustomer ? <Recognition /> : null}
        {isCustomer ? <CravingGrid /> : null}
        {isCustomer ? <WhyThisExists /> : null}
        <VerificationSheet />
        <Refusal />
        <StateGrid />
        <JourneyChapters audience={audience} at="verification" />
        {audience === 'restaurant' ? null : <Sealed />}
        <JourneyChapters audience={audience} at="sealed" />
        <Steps track={track} />
        <JourneyChapters audience={audience} at="steps" />
        <Checkable />
        <Faq track={track} />
        <FinalCta track={track} />
      </main>
      <SiteFooter current={audience} />
      <FaqLd track={track} />
      <StickyCta track={track} />
    </div>
  );
}
