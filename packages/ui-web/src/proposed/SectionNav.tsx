/**
 * `SectionNav` (proposed, #192) — the second-level list of sections inside a page: restaurant
 * Settings (Profile, Halal certificate, Bank account …) and the menu's category list
 * ("SideNav … list variant for categories; SectionNav for settings", restaurant plan §4).
 *
 * A named `<nav>` of links on the page surface. The current section is a filled tile (the
 * selected tint) with a bold label and `aria-current`, never an edge stripe. Counts fold into
 * the accessible name.
 */

import type { CSSProperties, ReactNode } from 'react';

import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from '../lib/ui/sidebar.js';
import { cn } from '../lib/utils.js';

/** One section link. */
export interface SectionNavItem {
  key: string;
  label: string;
  href?: string;
  onSelect?: (key: string) => void;
  /** A count, folded into the accessible name. */
  count?: number;
  /** What the count counts ("to fix"). Default "items". */
  countNoun?: string;
  /** Visible supporting text under the label ("Expires 20 Oct"). */
  description?: string;
}

/** Props of `SectionNav`. */
export interface SectionNavProps {
  /** The landmark's name ("Settings sections"). */
  label: string;
  items: readonly SectionNavItem[];
  activeKey?: string;
  /** `page` when each section is its own route (default), `location` for in-page anchors. */
  current?: 'page' | 'location';
  className?: string;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
}

/** A vertical list of the sections of a page. */
export function SectionNav({
  label,
  items,
  activeKey,
  current = 'page',
  className,
  testId = 'SectionNav',
  style,
}: SectionNavProps): ReactNode {
  return (
    <nav aria-label={label} data-testid={testId} className={cn('w-60 shrink-0', className)} style={style}>
      <SidebarMenu>
        {items.map((item) => {
          const active = item.key === activeKey;
          const name =
            item.count !== undefined && item.count > 0 ? `${item.label}, ${item.count} ${item.countNoun ?? 'items'}` : undefined;
          const content = (
            <>
              <span className="grid min-w-0 flex-1">
                <span className="truncate">{item.label}</span>
                {item.description ? (
                  <span className="truncate text-body-sm font-normal text-fg-secondary">{item.description}</span>
                ) : null}
              </span>
              {item.count !== undefined && item.count > 0 ? <SidebarMenuBadge>{item.count}</SidebarMenuBadge> : null}
            </>
          );
          const shared = {
            tone: 'light' as const,
            active,
            'aria-current': active ? current : undefined,
            'aria-label': name,
            'data-testid': `${testId}-item-${item.key}`,
            onClick: () => item.onSelect?.(item.key),
          };
          return (
            <SidebarMenuItem key={item.key}>
              {item.href ? (
                <SidebarMenuButton {...shared} href={item.href}>
                  {content}
                </SidebarMenuButton>
              ) : (
                <SidebarMenuAction {...shared}>{content}</SidebarMenuAction>
              )}
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </nav>
  );
}
