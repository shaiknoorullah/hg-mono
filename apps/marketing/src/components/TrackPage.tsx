import { Faq } from '@/components/Faq';
import { FinalCta } from '@/components/FinalCta';
import { Hero } from '@/components/Hero';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { Steps } from '@/components/Steps';
import { VerificationSheet } from '@/components/VerificationSheet';
import { WhyThisExists } from '@/components/WhyThisExists';
import { TRACKS, type Audience } from '@/lib/audiences';
import { resolveLaunchState } from '@/lib/launch';

/**
 * One page shape for all three audiences. The tracks differ in copy, not in
 * structure — and the structure is where the anti-slop work lives, so it should
 * not fork three ways before there is a reason.
 *
 * Section order follows docs/marketing/copy-deck.md. The one section that is not
 * shared is "Halal is a claim anyone can print": it exists to tell a cold
 * customer what problem we solve, and a restaurant owner or a rider already
 * knows. The verification sheet IS shared — it is the product, and it is what
 * the "seven checks" link in every hero points at.
 *
 * Padding is the artboards': 20px each side on phones, 56px on desktop, over a
 * 1280px content box.
 */
export function TrackPage({ audience }: { audience: Audience }) {
  const track = TRACKS[audience];
  const launch = resolveLaunchState();

  return (
    <div className="mx-auto box-border flex min-h-dvh max-w-[1280px] flex-col px-5 pt-4 md:px-14 md:pt-8">
      <SiteHeader current={audience} />
      <main className="flex-1">
        <Hero track={track} launch={launch} />
        {audience === 'customer' ? <WhyThisExists /> : null}
        <VerificationSheet />
        <Steps track={track} />
        <Faq track={track} />
        <FinalCta track={track} />
      </main>
      <SiteFooter />
    </div>
  );
}
