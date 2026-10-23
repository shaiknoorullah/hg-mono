/**
 * TEMPORARY stub until @hg/ui-web/ds ships SideNav (ds-request issue TBD; tracked under #192).
 * Props follow the canvases' drawing (`ASS/AdminSidebar`, `ORD/AdminNavCollapsed`, manifest §1).
 *
 * The admin's primary navigation on the dark forest chrome (`bg-surface-chrome`,
 * `text-fg-on-accent`). Expanded it is 264px; collapsed it is a 72px rail that by default keeps a short
 * text label under every item, so nothing depends on a hover tooltip (`railLabels={false}` draws icons only, as the orders boards do). As `ASS/AdminSidebar`
 * draws it, a rail item is 76px wide and its label is caption size, at most 72px, centred, and
 * may break anywhere rather than spill past the rail ("Certificates", "Restaurant"). The current page is a
 * FILLED tile (the owner's inverted-tile rule: on-accent fill, chrome label, bold icon, bold label) with
 * `aria-current="page"`, never a border or side bar. A count is folded into the item's accessible
 * name ("Restaurant applications, 4 waiting"); no count shows until one is known, and zero
 * shows nothing. Every target is at least 44px and the focus ring is drawn for the chrome.
 */
import { useId, type MouseEvent, type ReactNode } from 'react';

import { Badge } from './adapters/Badge.adapter';
import { Icon, type AnyIconName } from './adapters/Icon.adapter';
import { boardBadge } from './internal/boardBadge';
import { cx } from './internal/cx';
import { FOCUS_ON_CHROME } from './internal/focus';

export interface SideNavItem {
  /** Stable key. */
  key: string;
  /** Full label, shown when expanded and used as the accessible name. */
  label: string;
  /** Short label shown under the icon in the 72px rail ("Halal", "Orders"). */
  shortLabel: string;
  href: string;
  /**
   * Solar icon. Items without one keep an empty slot of the same size so every label lines up
   * (`ASS/AdminSidebar` draws a dashed placeholder there: Solar glyphs to add, issue #198).
   */
  icon?: AnyIconName;
  /** Live count. `null`/`undefined` = not known yet (nothing shows); 0 shows nothing. */
  count?: number | null;
  /** Noun for the count in the accessible name: "waiting" -> "…, 4 waiting". */
  countLabel?: string;
  /** neutral (default) or warning (a breached or overdue count). Never red. */
  countTone?: 'neutral' | 'warning';
  /**
   * The chips the item draws, when it draws more than one (Refunds & disputes: failed refunds in
   * warning, open disputes in neutral, side by side; the rail draws the first). Without it the one
   * `count` is drawn. The accessible name still comes from `count` and `countLabel`.
   */
  badges?: readonly SideNavBadge[];
  /** This item is the current page: `aria-current="page"`, filled tile. */
  current?: boolean;
}

export interface SideNavBadge {
  count: number;
  tone?: 'neutral' | 'warning';
}

export interface SideNavGroup {
  key: string;
  /** Group heading ("Review", "Operate"); hidden visually in the rail, kept for AT. */
  heading?: string;
  items: SideNavItem[];
}

export interface SideNavProps {
  groups: SideNavGroup[];
  /** Rail (72px) when true; full (264px) when false. */
  collapsed: boolean;
  /**
   * Collapsed rail: a short label under each icon (default, `ASS/AdminSidebar`, the alerts and
   * staff boards) or icons only (`ORD/AdminNav`, the orders boards). Both keep the full name for
   * assistive technology.
   */
  railLabels?: boolean;
  /** Shows the collapse toggle when set. */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Accessible name of the <nav>. Default "Main". */
  label?: string;
  /** Header slot, expanded: Wordmark (tone chrome) + subtitle ("Operations · Ontario"). */
  header?: ReactNode;
  /** Header slot in the rail (a compact mark); default nothing. */
  railHeader?: ReactNode;
  /** Footer slot: What's new, System status, "Signed in as …", Sign out. */
  footer?: ReactNode;
  /**
   * Client-side navigation. Called on a plain left click (no modifier keys) after the default
   * is prevented, so the router can navigate; other clicks follow the href.
   */
  onNavigate?: (href: string, item: SideNavItem, event: MouseEvent<HTMLAnchorElement>) => void;
  /** Labels for the toggle. */
  collapseLabel?: string;
  expandLabel?: string;
  id?: string;
  className?: string;
  testId?: string;
}

/**
 * The icon box of an item whose Solar glyph is not in the subset yet (#198): empty, the same size
 * as a glyph (20px, open and in the rail, as the board draws it), so labels align. Footer items
 * use it too.
 */
/** The box every rail control shares: radius-sm, a centred column, 4px above and below. */
const RAIL_BOX = 'relative flex flex-col items-center justify-center gap-0.5 rounded-sm border-0 bg-transparent px-0 py-1 text-fg-on-accent';

export function SideNavIconSlot(): React.JSX.Element {
  return <span aria-hidden="true" data-icon-slot="" className="inline-block size-5 shrink-0" />;
}

/** "Restaurant applications, 4 waiting". */
export function sideNavItemName(item: Pick<SideNavItem, 'label' | 'count' | 'countLabel'>): string {
  if (typeof item.count !== 'number' || item.count <= 0) return item.label;
  return item.countLabel ? `${item.label}, ${item.count} ${item.countLabel}` : `${item.label}, ${item.count}`;
}

/** What an item's badges draw: the explicit `badges`, else the one `count`. */
function badgesOf(item: SideNavItem): readonly SideNavBadge[] {
  if (item.badges) return item.badges.filter((b) => b.count > 0);
  if (typeof item.count !== 'number' || item.count <= 0) return [];
  return [{ count: item.count, tone: item.countTone ?? 'neutral' }];
}

/**
 * The count chips: the design system's Badge at its small size (`ASS/AdminSidebar` draws
 * `Badge size="sm"` after the label, side by side; the rail draws the first one at the item's top
 * right corner). Hidden from assistive technology: the count is in the item's name.
 */
function CountBadges({ item, rail }: { item: SideNavItem; rail: boolean }) {
  const all = badgesOf(item);
  const shown = rail ? all.slice(0, 1) : all;
  if (shown.length === 0) return null;
  return (
    <span aria-hidden="true" className={cx('inline-flex gap-1', rail && 'absolute end-0.5 top-0.5')}>
      {shown.map((b, i) => (
        <Badge
          key={i}
          variant={b.tone === 'warning' ? 'warning' : 'neutral'}
          size="sm"
          // The sidebar board draws the chip with a 4 px corner and a 14.3 px line, and the warning
          // chip's border in its lightest tint (`ASS/AdminSidebar`).
          style={boardBadge(b.tone === 'warning' ? 'warning' : 'neutral', '14.3px')}
        >
          {b.count > 99 ? '99+' : b.count}
        </Badge>
      ))}
    </span>
  );
}

function GroupHeading({ id, text, hidden }: { id: string; text: string; hidden: boolean }) {
  return (
    <h2 id={id} className={cx('m-0 px-3 pb-1 text-body-sm font-bold leading-normal tracking-[0.02em] text-fg-on-accent', hidden && 'sr-only')}>
      {text}
    </h2>
  );
}

export function SideNav({
  groups,
  collapsed,
  railLabels = true,
  onCollapsedChange,
  label = 'Main',
  header,
  railHeader,
  footer,
  onNavigate,
  collapseLabel = 'Collapse navigation',
  expandLabel = 'Expand navigation',
  id,
  className,
  testId = 'SideNav',
}: SideNavProps): React.JSX.Element {
  const auto = useId();
  const listId = `${id ?? auto}-items`;
  const labelled = collapsed && railLabels;

  return (
    <nav
      id={id}
      aria-label={label}
      data-testid={testId}
      data-collapsed={collapsed || undefined}
      className={cx(
        'box-border flex h-full shrink-0 flex-col gap-2 bg-surface-chrome py-4 text-fg-on-accent',
        collapsed ? 'w-18 items-center' : 'w-[264px] px-3',
        className,
      )}
    >
      {/* Expanded: the wordmark and subtitle with the collapse toggle. Rail: only the expand toggle. */}
      {collapsed ? (
        <>
          {railHeader}
          {onCollapsedChange ? (
            <button
              type="button"
              aria-expanded={false}
              aria-controls={listId}
              aria-label={expandLabel}
              onClick={() => onCollapsedChange(false)}
              className={cx(RAIL_BOX, 'w-[68px] min-h-12 hover:bg-[var(--hg-state-hover-overlay)]', FOCUS_ON_CHROME)}
            >
              <Icon name="menu" size="md" />
            </button>
          ) : null}
        </>
      ) : (
        // 32 px below the header: the sidebar board leaves that gap before the first group.
        <div className="flex items-start gap-2 pb-8 pt-1 ps-1.5">
          <div className="flex min-w-0 grow flex-col gap-1.5">{header}</div>
          {onCollapsedChange ? (
            <button
              type="button"
              aria-expanded
              aria-controls={listId}
              aria-label={collapseLabel}
              onClick={() => onCollapsedChange(true)}
              className={cx(RAIL_BOX, 'size-11 shrink-0 hover:bg-[var(--hg-state-hover-overlay)]', FOCUS_ON_CHROME)}
            >
              <Icon name="back" size="md" />
            </button>
          ) : null}
        </div>
      )}

      {/* The item list scrolls in its own region above the footer. */}
      <div
        id={listId}
        className={cx(
          'flex min-h-0 grow flex-col overflow-y-auto',
          collapsed ? (railLabels ? 'items-center gap-1' : 'items-center gap-3 px-3') : 'gap-3',
        )}
      >
        {groups.map((group) => {
          const headingId = `${listId}-${group.key}`;
          return (
            <div key={group.key} role="group" aria-labelledby={group.heading ? headingId : undefined} className={cx('flex flex-col gap-0.5', collapsed && 'items-center gap-1')}>
              {group.heading ? <GroupHeading id={headingId} text={group.heading} hidden={collapsed} /> : null}
              <ul className={cx('m-0 flex list-none flex-col gap-0.5 p-0', collapsed && 'items-center gap-1')}>
                {group.items.map((item) => {
                  const current = Boolean(item.current);
                  return (
                    <li key={item.key} className={cx('m-0', !collapsed && 'flex flex-col')}>
                      <a
                        href={item.href}
                        aria-current={current ? 'page' : undefined}
                        aria-label={sideNavItemName(item)}
                        data-nav-key={item.key}
                        title={collapsed && !railLabels ? item.label : undefined}
                        onClick={(event) => {
                          if (!onNavigate) return;
                          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                          event.preventDefault();
                          onNavigate(item.href, item, event);
                        }}
                        className={cx(
                          'relative flex min-h-11 rounded-sm no-underline',
                          FOCUS_ON_CHROME,
                          // The current item is an inverted tile on the chrome (owner rule, 1 Oct 2026): filled
                          // with the on-accent colour, label and icon in the chrome colour, bold. Never an
                          // outline, a border or a side bar.
                          collapsed
                            ? railLabels
                              ? 'min-h-12 w-[68px] flex-col items-center justify-center gap-0.5 px-0 py-1 text-center text-caption leading-[1.2]'
                              : 'items-center justify-center px-3'
                            : 'w-full items-center gap-2.5 px-3 text-start text-body-md leading-[1.3]',
                          current
                            ? 'bg-fg-on-accent font-bold text-surface-chrome'
                            : 'font-medium text-fg-on-accent hover:bg-[var(--hg-state-hover-overlay)]',
                        )}
                      >
                        {item.icon ? (
                          <Icon name={item.icon} size="md" weight={current ? 'bold' : 'linear'} />
                        ) : (
                          <SideNavIconSlot />
                        )}
                        <span
                          aria-hidden="true"
                          data-rail-label={collapsed || undefined}
                          className={cx(
                            collapsed
                              ? railLabels
                                ? 'w-full max-w-[64px] text-center [overflow-wrap:anywhere]'
                                : 'sr-only'
                              : 'min-w-0 flex-1',
                            labelled && (current ? 'font-bold' : 'font-medium'),
                          )}
                        >
                          {collapsed ? item.shortLabel : item.label}
                        </span>
                        <CountBadges item={item} rail={collapsed} />
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      {footer ? (
        <div className={cx('flex shrink-0 flex-col gap-1', collapsed ? 'items-center gap-2' : 'px-1.5 pt-3')}>{footer}</div>
      ) : null}
    </nav>
  );
}
