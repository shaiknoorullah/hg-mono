/**
 * `SideNav` — the persistent left navigation of the restaurant console and the admin app
 * (owner-approved, decisions row 28 Sep; canvases `restaurant/live-orders/LiveBoard` and
 * `admin/orders/AdminNav`). Rebuilt on the shadcn-style `Sidebar` parts in `lib/ui/sidebar`.
 *
 * - Items are real links when they have an `href` (middle-click, copy link and history work);
 *   the current one carries `aria-current="page"` as well as its filled tile.
 * - The current page is a **filled tile**, never an edge bar or border (constitution gate 9).
 * - A count is folded into the accessible name ("Orders, 3 new"); the pill is decorative.
 * - Collapsing folds the rail to an icon rail (80px). Each item keeps a short visible label
 *   under its icon and its full accessible name; nothing becomes an unlabelled glyph.
 * - Sign out sits on the chrome at the foot of the rail (`onSignOut`).
 * - No arrow-key roving: a list of links is not a composite widget; Tab order is the order.
 *
 * The admin stub's names (#699) are accepted as aliases: `count`/`countLabel`/`countTone`,
 * `current`, a group's `heading`, `onCollapsedChange`, `railHeader`, `onNavigate`,
 * `collapseLabel`/`expandLabel` and `id`. A rail label may wrap (at most 72px wide) rather than
 * spill past the rail.
 *
 * The props of the pre-redesign `SideNav` (`groups`, `activeKey`, `collapsed`,
 * `onToggleCollapsed`, `header`, `footer`, `className`, `testId`) keep working unchanged.
 */

import { useId, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarFooterButton,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from '../lib/ui/sidebar.js';
import { cn } from '../lib/utils.js';
import { Icon, type DsIconName } from './index.js';

/** One navigation destination. */
export interface SideNavItem {
  key: string;
  /** The full name ("Live orders"). */
  label: string;
  /** Shown under the icon when the rail is collapsed ("Orders"); defaults to `label`. */
  shortLabel?: string;
  href?: string;
  onSelect?: (key: string) => void;
  /** A design-system icon name, or a node. Decorative: the label carries the name. */
  icon?: DsIconName | ReactNode;
  /** A count, or `'dot'` for "something is here". Folded into the accessible name. */
  badge?: number | 'dot';
  /** What the count counts, for the accessible name ("new", "open"). Default "waiting". */
  badgeNoun?: string;
  /** Still focusable (`aria-disabled`), so the reason can be read. */
  disabled?: boolean;
  /** Why it is disabled; read through `aria-describedby`. */
  disabledReason?: string;
  /** Alias of `badge` (admin): `null`/undefined = not known yet, 0 shows nothing. */
  count?: number | null;
  /** Alias of `badgeNoun` (admin). */
  countLabel?: string;
  /** `neutral` (default) or `warning` for a breached or overdue count. Never red. */
  countTone?: 'neutral' | 'warning';
  /** Alias of `activeKey === key` (admin): this item is the current page. */
  current?: boolean;
}

/** A titled group of items. */
export interface SideNavGroup {
  key: string;
  /** Visible heading (hidden on the collapsed rail, where a rule separates groups). */
  label?: string;
  /** Alias of `label` (admin). */
  heading?: string;
  items: readonly SideNavItem[];
}

/** Props of `SideNav`. */
export interface SideNavProps {
  groups: readonly SideNavGroup[];
  /** The `key` of the current page. */
  activeKey?: string;
  /** Controlled collapsed state. Leave undefined to let the rail keep its own. */
  collapsed?: boolean;
  /** Uncontrolled initial state. */
  defaultCollapsed?: boolean;
  onToggleCollapsed?: (collapsed: boolean) => void;
  /** Alias of `onToggleCollapsed` (admin). */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** The toggle's names. Defaults "Collapse menu" and "Expand menu". */
  collapseLabel?: string;
  expandLabel?: string;
  /** Shown at the top of the collapsed rail instead of `brand` (a compact mark). */
  railHeader?: ReactNode;
  /**
   * Client-side navigation: called on a plain left click of an `href` item (no modifier keys),
   * after the default is prevented, so a router can navigate. Other clicks follow the href.
   */
  onNavigate?: (href: string, item: SideNavItem, event: MouseEvent<HTMLAnchorElement>) => void;
  /** The landmark's id. */
  id?: string;
  /** Shows the Collapse/Expand control. Default: true when uncontrolled or `onToggleCollapsed` is set. */
  collapsible?: boolean;
  /** `chrome` (restaurant and admin, default) or `light` (the pre-redesign glass rail). */
  tone?: 'chrome' | 'light';
  /** The landmark's name. Default "Main". */
  label?: string;
  /** The brand mark at the top (a Wordmark); shown in both widths. */
  brand?: ReactNode;
  /** Extra content under the brand (product name, restaurant). Hidden when collapsed. */
  header?: ReactNode;
  /** Content above Sign out (who is signed in). Shown in both widths, centred on the rail. */
  footer?: ReactNode;
  /** Renders the on-chrome Sign out button at the foot. */
  onSignOut?: () => void;
  /** Default "Sign out". */
  signOutLabel?: string;
  className?: string;
  /** data-testid; defaults to the component name. Items get `${testId}-item-${key}`. */
  testId?: string;
  style?: CSSProperties;
}

function countOf(item: SideNavItem): number | 'dot' | undefined {
  if (item.badge !== undefined) return item.badge;
  return typeof item.count === 'number' ? item.count : undefined;
}

function accessibleName(item: SideNavItem): string {
  const badge = countOf(item);
  const noun = item.badgeNoun ?? item.countLabel;
  if (badge === undefined) return item.label;
  if (badge === 'dot') return `${item.label}, has updates`;
  if (badge <= 0) return item.label;
  // The admin's `count` without a noun reads "Orders, 4"; `badge` keeps its "waiting" default.
  if (noun === undefined && item.badge === undefined) return `${item.label}, ${badge}`;
  return `${item.label}, ${badge} ${noun ?? 'waiting'}`;
}

function glyph(icon: SideNavItem['icon'], active: boolean): ReactNode {
  if (icon === undefined || icon === null) return null;
  return (
    <span aria-hidden="true" className="inline-flex shrink-0">
      {typeof icon === 'string' ? <Icon name={icon as DsIconName} size="lg" weight={active ? 'bold' : 'linear'} /> : icon}
    </span>
  );
}

/** The persistent left navigation, collapsible to an icon rail. */
export function SideNav({
  groups,
  activeKey,
  collapsed: collapsedProp,
  defaultCollapsed = false,
  onToggleCollapsed,
  onCollapsedChange,
  collapseLabel = 'Collapse menu',
  expandLabel = 'Expand menu',
  railHeader,
  onNavigate,
  id,
  collapsible,
  tone = 'chrome',
  label = 'Main',
  brand,
  header,
  footer,
  onSignOut,
  signOutLabel = 'Sign out',
  className,
  testId = 'SideNav',
  style,
}: SideNavProps): ReactNode {
  const [own, setOwn] = useState(defaultCollapsed);
  const controlled = collapsedProp !== undefined;
  const collapsed = controlled ? collapsedProp : own;
  const showToggle =
    collapsible ?? (!controlled || onToggleCollapsed !== undefined || onCollapsedChange !== undefined);
  const top = collapsed && railHeader !== undefined ? railHeader : brand;
  const listId = useId();

  const toggle = (): void => {
    const next = !collapsed;
    if (!controlled) setOwn(next);
    onToggleCollapsed?.(next);
    onCollapsedChange?.(next);
  };

  return (
    <Sidebar
      id={id}
      aria-label={label}
      tone={tone}
      collapsed={collapsed}
      data-testid={testId}
      className={className}
      style={style}
    >
      {top || (header && !collapsed) ? (
        <SidebarHeader className={cn(collapsed && 'items-center px-2')}>
          {top}
          {header && !collapsed ? <div className="text-body-sm">{header}</div> : null}
        </SidebarHeader>
      ) : null}

      <SidebarContent id={listId} className={cn(collapsed && 'px-0.5')}>
        {groups.map((group, index) => {
          const groupLabel = group.label ?? group.heading;
          return (
          <SidebarGroup key={group.key}>
            {groupLabel && !collapsed ? <SidebarGroupLabel>{groupLabel}</SidebarGroupLabel> : null}
            {collapsed && index > 0 ? (
              <span aria-hidden="true" className="mx-2 my-1 h-px bg-current opacity-40" />
            ) : null}
            <SidebarMenu aria-label={groupLabel}>
              {group.items.map((item) => {
                const active = item.current ?? item.key === activeKey;
                const badge = countOf(item);
                const name = accessibleName(item);
                const reasonId = item.disabledReason ? `${testId}-${item.key}-reason` : undefined;
                const visible = collapsed ? (item.shortLabel ?? item.label) : item.label;
                const count =
                  typeof badge === 'number' && badge > 0 ? (
                    <SidebarMenuBadge collapsed={collapsed} tone={item.countTone}>
                      {badge > 99 ? '99+' : badge}
                    </SidebarMenuBadge>
                  ) : badge === 'dot' ? (
                    <SidebarMenuBadge collapsed={collapsed} tone={item.countTone} className="size-2 min-w-2 p-0" />
                  ) : null;
                const content = (
                  <>
                    {glyph(item.icon, active)}
                    <span className={cn('min-w-0', collapsed ? 'max-w-18 hyphens-auto [overflow-wrap:anywhere] leading-tight' : 'flex-1 truncate')}>{visible}</span>
                    {count}
                  </>
                );
                const shared = {
                  tone,
                  active,
                  collapsed,
                  'aria-label': name === visible ? undefined : name,
                  'aria-current': active ? ('page' as const) : undefined,
                  'aria-describedby': reasonId,
                  'data-testid': `${testId}-item-${item.key}`,
                };
                return (
                  <SidebarMenuItem key={item.key}>
                    {item.href && !item.disabled ? (
                      <SidebarMenuButton
                        {...shared}
                        href={item.href}
                        onClick={(event) => {
                          item.onSelect?.(item.key);
                          const plain =
                            event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
                          if (onNavigate && item.href && plain) {
                            event.preventDefault();
                            onNavigate(item.href, item, event);
                          }
                        }}
                      >
                        {content}
                      </SidebarMenuButton>
                    ) : (
                      <SidebarMenuAction
                        {...shared}
                        aria-disabled={item.disabled || undefined}
                        onClick={() => {
                          if (!item.disabled) item.onSelect?.(item.key);
                        }}
                      >
                        {content}
                      </SidebarMenuAction>
                    )}
                    {item.disabledReason ? (
                      <span id={reasonId} className="sr-only">
                        {item.disabledReason}
                      </span>
                    ) : null}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
          );
        })}
      </SidebarContent>

      {footer || onSignOut || showToggle ? (
        <SidebarFooter className={cn(tone === 'light' && 'border-line-decorative', collapsed && 'items-center')}>
          {/* Shown in both widths, as the pre-redesign SideNav and the admin stub do: the admin
              puts System status and "Signed in as" here, and they must not vanish on the rail. */}
          {footer ? (
            <div className={cn('text-body-sm', collapsed ? 'flex w-full flex-col items-center gap-1 px-0.5 text-center' : 'px-2')}>
              {footer}
            </div>
          ) : null}
          {onSignOut ? (
            <SidebarFooterButton tone={tone} data-testid={`${testId}-sign-out`} onClick={onSignOut}>
              {signOutLabel}
            </SidebarFooterButton>
          ) : null}
          {showToggle ? (
            <SidebarFooterButton
              tone={tone}
              emphasis="plain"
              aria-expanded={!collapsed}
              aria-controls={listId}
              aria-label={collapsed ? expandLabel : collapseLabel}
              data-testid={`${testId}-collapse`}
              onClick={toggle}
            >
              <span aria-hidden="true" className={cn('inline-flex', collapsed && '-scale-x-100 rtl:scale-x-100')}>
                <Icon name="back" size="md" />
              </span>
              {collapsed ? null : <span aria-hidden="true">{collapseLabel}</span>}
            </SidebarFooterButton>
          ) : null}
        </SidebarFooter>
      ) : null}
    </Sidebar>
  );
}
