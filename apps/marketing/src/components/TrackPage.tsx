import { Checkable } from '@/components/Checkable';
import { CravingGrid } from '@/components/CravingGrid';
import { Faq } from '@/components/Faq';
import { FinalCta } from '@/components/FinalCta';
import { Hero } from '@/components/Hero';
import { Recognition } from '@/components/Recognition';
import { Refusal } from '@/components/Refusal';
import { Sealed } from '@/components/Sealed';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
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
 * Padding is the artboards': 20px each side on phones, 56px on desktop, over a
 * 1280px content box.
 */
export function TrackPage({ audience }: { audience: Audience }) {
  const track = TRACKS[audience];
  const launch = resolveLaunchState();
  const isCustomer = audience === 'customer';

  return (
    <div className="mx-auto box-border flex min-h-dvh max-w-[1280px] flex-col px-5 pt-4 lg:px-14 lg:pt-8">
      <SiteHeader current={audience} />
      <main className="flex-1">
        <Hero track={track} launch={launch} />
        {isCustomer ? <Recognition /> : null}
        {isCustomer ? <CravingGrid /> : null}
        {isCustomer ? <WhyThisExists /> : null}
        <VerificationSheet />
        <Refusal />
        <StateGrid />
        {audience === 'restaurant' ? null : <Sealed />}
        <Steps track={track} />
        <Checkable />
        <Faq track={track} />
        <FinalCta track={track} />
      </main>
      <SiteFooter />
      <FaqLd track={track} />
    </div>
  );
}
