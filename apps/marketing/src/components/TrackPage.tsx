import { Hero } from '@/components/Hero';
import { SevenChecks } from '@/components/SevenChecks';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { TRACKS, type Audience } from '@/lib/audiences';
import { resolveLaunchState } from '@/lib/launch';

/**
 * One page shape for all three audiences. The tracks differ in copy, not in
 * structure — and the structure is where the anti-slop work lives, so it should
 * not fork three ways before there is a reason.
 *
 * The padding is the artboards': 20px each side on phones, 56px on desktop,
 * over a 1280px content box.
 */
export function TrackPage({ audience }: { audience: Audience }) {
  const launch = resolveLaunchState();

  return (
    <div className="mx-auto box-border flex min-h-dvh max-w-[1280px] flex-col px-5 pt-4 md:px-14 md:pt-8">
      <SiteHeader current={audience} />
      <main className="flex-1">
        <Hero track={TRACKS[audience]} launch={launch} />
        <SevenChecks />
      </main>
      <SiteFooter />
    </div>
  );
}
