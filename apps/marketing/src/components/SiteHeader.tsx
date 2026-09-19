import Link from 'next/link';
import { AudienceSwitch } from '@/components/AudienceSwitch';
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
      <Link
        href="/"
        className="inline-flex h-11 flex-none items-center self-start font-display text-[22px] leading-none font-extrabold tracking-[-0.03em] text-fg-primary no-underline"
      >
        Halal Goes
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
