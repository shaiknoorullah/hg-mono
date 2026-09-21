import Link from 'next/link';
import { AudienceSwitch } from '@/components/AudienceSwitch';
import { Wordmark } from '@/components/Wordmark';
import { SwapLabel } from '@/components/SwapLabel';
import { Button } from '@/components/ui/button';
import { TRACKS, type Audience } from '@/lib/audiences';

/**
 * No hamburger.
 *
 * The phone artboard had one, but there is nothing behind it yet — the site is
 * three pages and the audience switch already reaches all three. A menu control
 * that opens an empty menu is worse than no menu control, so it arrives with
 * the pages it would list.
 */
export function SiteHeader({ current }: { current: Audience }) {
  return (
    <header className="flex flex-col gap-3 lg:h-13 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
      {/* 30px below lg, 34 above: the script mark carries its ascenders and the
          swash descender inside the box, so it needs more box than the 22px
          Bricolage wordmark it replaces to read at the same size. Still inside
          the 44px row, and the link keeps h-11 so the tap target does not
          shrink to the artwork. */}
      <Link href="/" className="inline-flex h-11 flex-none items-center self-start no-underline">
        <Wordmark id="wordmark-header" height={30} className="lg:hidden" />
        <Wordmark id="wordmark-header-lg" height={34} className="hidden lg:block" />
      </Link>

      <AudienceSwitch current={current} />

      {/* Desktop only: on phones this would crowd the wordmark, and the form is
          a scroll away rather than a page away. asChild keeps it a real <a> —
          a button that navigates is not a button. */}
      <Button
        asChild
        className="group hidden h-12 flex-none rounded-md px-[22px] text-label-lg font-bold no-underline transition-[transform,background-color] duration-[180ms] ease-[var(--hg-ease-spring)] hover:-translate-y-0.5 hover:bg-action-primary-bg-pressed motion-reduce:hover:translate-y-0 lg:inline-flex"
      >
        <Link href="#waitlist">
          <SwapLabel>{TRACKS[current].headerCta}</SwapLabel>
        </Link>
      </Button>
    </header>
  );
}
