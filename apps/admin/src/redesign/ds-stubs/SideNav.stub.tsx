/**
 * TEMPORARY stub until @hg/ui-web/ds ships SideNav (ds-request issue TBD; tracked under #192).
 * Props follow the canvases' drawing (`ASS/AdminSidebar`, `ORD/AdminNavCollapsed`, manifest §1).
 *
 * The admin's primary navigation on the dark forest chrome (`bg-surface-chrome`,
 * `text-fg-on-accent`). Expanded it is 264px; collapsed it is an 80px rail that keeps a short
 * text label under every item, so nothing depends on a hover tooltip. As `ASS/AdminSidebar`
 * draws it, a rail item is 76px wide and its label is caption size, at most 72px, centred, and
 * may break anywhere rather than spill past the rail ("Certificates", "Restaurant"). The current page is a
 * FILLED tile (inverted: on-accent fill, chrome label, bold icon, bold label) with
 * `aria-current="page"`, never a left border. A count is folded into the item's accessible
 * name ("Restaurant applications, 4 waiting"); no count shows until one is known, and zero
 * shows nothing. Every target is at least 44px and the focus ring is drawn for the chrome.
 */
import { useId, type MouseEvent, type ReactNode } from 'react';

import { Icon, type AnyIconName } from './adapters/Icon.adapter';
import { cx } from './internal/cx';
import { FOCUS_ON_CHROME } from './internal/focus';

export interface SideNavItem {
  /** Stable key. */
  key: string;
  /** Full label, shown when expanded and used as the accessible name. */
  label: string;
  /** Short label shown under the icon in the 80px rail ("Halal", "Orders"). */
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
  /** This item is the current page: `aria-current="page"`, filled tile. */
  current?: boolean;
}

export interface SideNavGroup {
  key: string;
  /** Group heading ("Review", "Operate"); hidden visually in the rail, kept for AT. */
  heading?: string;
  items: SideNavItem[];
}

export interface SideNavProps {
  groups: SideNavGroup[];
  /** Rail (80px) when true; full (264px) when false. */
  collapsed: boolean;
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
export function SideNavIconSlot(): React.JSX.Element {
  return <span aria-hidden="true" data-icon-slot="" className="inline-block size-5 shrink-0" />;
}

/** "Restaurant applications, 4 waiting". */
export function sideNavItemName(item: Pick<SideNavItem, 'label' | 'count' | 'countLabel'>): string {
  if (typeof item.count !== 'number' || item.count <= 0) return item.label;
  return item.countLabel ? `${item.label}, ${item.count} ${item.countLabel}` : `${item.label}, ${item.count}`;
}

function CountPill({ item, rail }: { item: SideNavItem; rail: boolean }) {
  if (typeof item.count !== 'number' || item.count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-sm px-1.5 text-label-sm font-semibold',
        item.countTone === 'warning' ? 'bg-feedback-warning-tint text-feedback-warning-tint-text' : 'bg-surface-base text-fg-primary',
        rail && 'absolute end-2 top-1',
      )}
    >
      {item.count > 99 ? '99+' : item.count}
    </span>
  );
}

export function SideNav({
  groups,
  collapsed,
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

  return (
    <nav
      id={id}
      aria-label={label}
      data-testid={testId}
      data-collapsed={collapsed || undefined}
      className={cx(
        'flex h-full shrink-0 flex-col bg-surface-chrome text-fg-on-accent',
        collapsed ? 'w-20' : 'w-[264px]',
        className,
      )}
    >
      <div className={cx('flex items-start gap-2 px-3', collapsed ? 'flex-col items-center pt-1' : 'justify-between pt-3')}>
        <div className={cx('min-w-0', collapsed ? 'flex justify-center' : 'flex-1 px-1')}>{collapsed ? railHeader : header}</div>
        {onCollapsedChange ? (
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-controls={listId}
            aria-label={collapsed ? expandLabel : collapseLabel}
            onClick={() => onCollapsedChange(!collapsed)}
            className={cx('inline-flex size-11 shrink-0 items-center justify-center rounded-md text-fg-on-accent hover:bg-[var(--hg-state-hover-overlay)]', FOCUS_ON_CHROME)}
          >
            <Icon name={collapsed ? 'chevron-right' : 'back'} size="md" />
          </button>
        ) : null}
      </div>

      {/* The item list scrolls in its own region above the footer; the rail is spaced tighter so
          every item fits a 1024x768 window without scrolling. */}
      <div id={listId} className={cx('flex min-h-0 flex-1 flex-col overflow-y-auto', collapsed ? 'gap-1.5 px-0.5 py-2' : 'gap-3 px-3 py-3')}>
        {groups.map((group) => {
          const headingId = `${listId}-${group.key}`;
          return (
            <div key={group.key} role="group" aria-labelledby={group.heading ? headingId : undefined}>
              {group.heading ? (
                <p
                  id={headingId}
                  className={cx('px-2 pb-1 text-label-sm font-semibold text-fg-on-accent', collapsed && 'sr-only')}
                >
                  {group.heading}
                </p>
              ) : null}
              {collapsed && group.heading ? <hr aria-hidden="true" className="mx-3 mt-0 mb-0.5 border-line-decorative opacity-40" /> : null}
              <ul className="flex flex-col gap-1">
                {group.items.map((item) => {
                  const current = Boolean(item.current);
                  return (
                    <li key={item.key}>
                      <a
                        href={item.href}
                        aria-current={current ? 'page' : undefined}
                        aria-label={sideNavItemName(item)}
                        data-nav-key={item.key}
                        onClick={(event) => {
                          if (!onNavigate) return;
                          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                          event.preventDefault();
                          onNavigate(item.href, item, event);
                        }}
                        className={cx(
                          'relative flex min-h-11 rounded-md no-underline',
                          FOCUS_ON_CHROME,
                          collapsed
                            ? 'min-h-12 flex-col items-center justify-center gap-0.5 px-0.5 py-1 text-center text-caption'
                            : 'items-center gap-3 px-3 py-2 text-body-md',
                          current
                            ? 'bg-fg-on-accent text-surface-chrome font-semibold'
                            : 'text-fg-on-accent hover:bg-[var(--hg-state-hover-overlay)]',
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
                              ? 'w-full max-w-[72px] text-center leading-tight [overflow-wrap:anywhere]'
                              : 'min-w-0 flex-1',
                            collapsed && (current ? 'font-bold' : 'font-medium'),
                          )}
                        >
                          {collapsed ? item.shortLabel : item.label}
                        </span>
                        <CountPill item={item} rail={collapsed} />
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
        <div className={cx('flex shrink-0 flex-col border-t border-line-decorative/40', collapsed ? 'items-center gap-1 px-0.5 py-2' : 'gap-2 px-3 py-3')}>
          {footer}
        </div>
      ) : null}
    </nav>
  );
}
