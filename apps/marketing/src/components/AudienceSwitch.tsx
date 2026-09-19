import Link from 'next/link';
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from '@/components/ui/navigation-menu';
import { AUDIENCES, TRACKS, type Audience } from '@/lib/audiences';

/**
 * The three audience tracks, on shadcn's NavigationMenu.
 *
 * NavigationMenu rather than Tabs or ToggleGroup because these are three real
 * pages — separately indexable, separately shareable, separately targetable by
 * an ad — so the markup has to be links. `NavigationMenuLink asChild` wrapping
 * a next/link is the documented pattern for exactly that, and it keeps
 * `aria-current="page"` meaningful instead of faking selection state.
 *
 * The group sizes to its contents: 4px of padding around 44px pills is 52px.
 * A previous revision pinned it to the pills' own height and the row hung 5px
 * out of the bottom — the box model is the part a base component is supposed
 * to own, which is the reason this is no longer bespoke markup.
 *
 * On phones the row scrolls horizontally and bleeds to the right edge, so it is
 * visibly cut off rather than looking like a complete set of two.
 */
export function AudienceSwitch({ current, className = '' }: { current: Audience; className?: string }) {
  return (
    <NavigationMenu
      aria-label="I want to"
      // The default is a centred, max-content flex row with a dropdown viewport.
      // No triggers here, so the viewport is off and the row is laid out by the
      // list below.
      className={`-me-5 max-w-none justify-start overflow-x-auto overflow-y-hidden pe-5 lg:me-0 lg:flex-none lg:overflow-visible lg:pe-0 ${className}`}
      viewport={false}
    >
      <NavigationMenuList className="w-max flex-none justify-start gap-2 whitespace-nowrap lg:gap-1 lg:rounded-full lg:border lg:border-line-decorative lg:bg-surface-raised lg:p-1">
        {AUDIENCES.map((id) => {
          const track = TRACKS[id];
          const active = id === current;
          return (
            <NavigationMenuItem key={id} className="flex-none">
              <NavigationMenuLink
                asChild
                active={active}
                className={[
                  'inline-flex h-11 flex-none items-center justify-center rounded-full px-[18px]',
                  'text-label-lg font-semibold whitespace-nowrap transition-colors duration-[140ms]',
                  active
                    ? 'border border-action-secondary-bg bg-action-secondary-bg text-action-secondary-fg hover:bg-action-secondary-bg focus:bg-action-secondary-bg'
                    : 'border border-line-decorative bg-surface-raised text-mk-ink hover:bg-surface-sunken lg:border-transparent lg:bg-transparent',
                ].join(' ')}
              >
                <Link href={track.href} aria-current={active ? 'page' : undefined}>
                  {track.tab}
                </Link>
              </NavigationMenuLink>
            </NavigationMenuItem>
          );
        })}
      </NavigationMenuList>
    </NavigationMenu>
  );
}
