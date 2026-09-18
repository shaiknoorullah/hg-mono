import Link from 'next/link';
import { AUDIENCES, TRACKS, type Audience } from '@/lib/audiences';

/**
 * The three audience tracks, as links rather than tabs.
 *
 * Each one is a real page, so this is navigation and is marked up as such:
 * <nav> + aria-current="page", not a button group with aria-pressed. A visitor
 * who lands on /riders from an ad sees the rider track selected without any
 * client JavaScript running.
 *
 * On phones the row scrolls horizontally and bleeds to the right edge, so it is
 * visibly cut off rather than looking like a complete set of two.
 */
export function AudienceSwitch({ current, className = '' }: { current: Audience; className?: string }) {
  return (
    <nav
      aria-label="I want to"
      className={`-me-5 flex h-11 gap-2 overflow-x-auto overflow-y-hidden pe-5 whitespace-nowrap md:me-0 md:gap-1 md:overflow-visible md:rounded-full md:border md:border-line-decorative md:bg-surface-raised md:p-1 md:pe-1 ${className}`}
    >
      {AUDIENCES.map((id) => {
        const track = TRACKS[id];
        const active = id === current;
        return (
          <Link
            key={id}
            href={track.href}
            aria-current={active ? 'page' : undefined}
            className={[
              // 44px minimum touch target, everywhere.
              'inline-flex h-11 flex-none items-center rounded-full px-[18px] text-label-lg font-semibold',
              'transition-colors duration-[140ms]',
              active
                ? 'border border-action-secondary-bg bg-action-secondary-bg text-action-secondary-fg'
                : 'border border-line-decorative bg-surface-raised text-accent-600 hover:bg-surface-sunken md:border-transparent md:bg-transparent',
            ].join(' ')}
          >
            {track.tab}
          </Link>
        );
      })}
    </nav>
  );
}
