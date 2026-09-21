import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { SkipLink } from '@/components/SkipLink';
import { StickyCta } from '@/components/StickyCta';
import { TRACKS, type Audience } from '@/lib/audiences';

/**
 * The frame every non-track page sits in — same gutters, same header, same
 * footer as a track page, so the blog does not feel like a different website.
 */
export function PageShell({
  children,
  current = 'customer',
}: {
  children: React.ReactNode;
  current?: Audience;
}) {
  return (
    <div className="relative mx-auto box-border flex min-h-dvh max-w-[1280px] flex-col px-5 pt-4 lg:px-14 lg:pt-8">
      <SkipLink />
      <SiteHeader current={current} />
      {/* A document page has no hero for the bar to follow, so this region
          stands in for one: from the top of the page down far enough to clear
          the masthead the bar should sit below, positioned out of flow so it
          costs no layout.

          45svh, not the screenful it was. A full-viewport region needed its own
          height PLUS its offset down the page before it cleared, which is more
          scroll than `/blog` has at any width — measured, the bar never
          appeared there at all. Half a screen is reachable on the shortest page
          we have and still puts the bar below the title block. */}
      <div
        id="hero-zone"
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 h-[45svh] w-px"
      />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
      <StickyCta track={TRACKS[current]} />
    </div>
  );
}
