import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
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
    <div className="mx-auto box-border flex min-h-dvh max-w-[1280px] flex-col px-5 pt-4 lg:px-14 lg:pt-8">
      <SiteHeader current={current} />
      {/* A document page has no hero for the bar to follow, so the sentinel
          stands in for one: a full screen tall, positioned out of flow so it
          costs no layout. A 1px mark at the top would have the bar appear after
          a single pixel of scroll, over the masthead it should sit below. */}
      <div className="relative">
        <div
          id="hero-end"
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0 h-screen w-px"
        />
      </div>
      <main className="flex-1">{children}</main>
      <SiteFooter />
      <StickyCta track={TRACKS[current]} />
    </div>
  );
}
