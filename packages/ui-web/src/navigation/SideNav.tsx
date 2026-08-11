import type { ReactNode } from 'react';

import { cx } from '../feedback/internal.js';

/**
 * `SideNav` — the persistent left navigation on the two operational web surfaces
 * (patterns §4.1: "Persistent left nav → filter bar → `DataTable` → a side sheet").
 *
 * Navigation rules that apply here:
 *  - Items are **real links** when they have an `href`, so middle-click, copy-link and the
 *    browser's own history all work. `aria-current="page"` marks the active one — never
 *    colour alone.
 *  - A **badge is inside the item's accessible name** ("Halal queue, 4 waiting"), never a
 *    separate node an AT user has to reconcile with the label (§28).
 *  - Collapsing hides the label *visually only*. The accessible name is unchanged, which
 *    is what stops a collapsed rail from degrading into unlabelled glyphs.
 *  - No arrow-key roving. A11y §4.3 lists the composites that take arrows —
 *    `RadioGroup`, `Tabs`, `BottomNav`, the `DataTable` grid, `Select`, chip rows — and a
 *    link list is not one of them. Tab order is the navigation.
 */

export interface SideNavItem {
  key: string;
  label: string;
  href?: string;
  onSelect?: (key: string) => void;
  /** Decorative. `aria-hidden` — the label carries the name. */
  icon?: ReactNode;
  /** A count, or `'dot'` for "something is here". Folded into the accessible name. */
  badge?: number | 'dot';
  /** What the badge counts, for the accessible name. Default "waiting". */
  badgeNoun?: string;
  disabled?: boolean;
  /** Why it is disabled. Surfaced in `aria-describedby`, never left to be guessed. */
  disabledReason?: string;
}

export interface SideNavGroup {
  key: string;
  /** Group heading. Rendered, not just an `aria-label` — sighted users need it too. */
  label?: string;
  items: readonly SideNavItem[];
}

export interface SideNavProps {
  groups: readonly SideNavGroup[];
  /** The `key` of the active item. */
  activeKey?: string;
  collapsed?: boolean;
  onToggleCollapsed?: (collapsed: boolean) => void;
  header?: ReactNode;
  footer?: ReactNode;
  className?: string;
  testId?: string;
}

function badgeLabel(item: SideNavItem): string {
  if (item.badge === undefined) return item.label;
  if (item.badge === 'dot') return `${item.label}, has updates`;
  if (item.badge <= 0) return item.label;
  return `${item.label}, ${item.badge} ${item.badgeNoun ?? 'waiting'}`;
}

export function SideNav({
  groups,
  activeKey,
  collapsed = false,
  onToggleCollapsed,
  header,
  footer,
  className,
  testId = 'side-nav',
}: SideNavProps): ReactNode {
  return (
    <div
      data-testid={testId}
      data-collapsed={collapsed || undefined}
      className={cx(
        'flex h-full shrink-0 flex-col border-e border-line-decorative bg-surface-base',
        collapsed ? 'w-16' : 'w-64',
        className,
      )}
    >
      {header ? <div className="p-3">{header}</div> : null}

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {groups.map((group) => (
          <div key={group.key} className="mb-4 last:mb-0">
            {group.label && !collapsed ? (
              <h2 className="px-3 pb-1 text-label-sm uppercase tracking-wide text-fg-tertiary">
                {group.label}
              </h2>
            ) : null}
            <ul role="list" aria-label={collapsed ? group.label : undefined} className="flex flex-col">
              {group.items.map((item) => {
                const active = item.key === activeKey;
                const name = badgeLabel(item);
                const describedById = item.disabledReason ? `${testId}-${item.key}-reason` : undefined;

                const content = (
                  <>
                    {item.icon ? (
                      <span aria-hidden="true" className="shrink-0">
                        {item.icon}
                      </span>
                    ) : null}
                    <span className={cx('min-w-0 flex-1 truncate', collapsed && 'sr-only')}>
                      {item.label}
                    </span>
                    {item.badge !== undefined && item.badge !== 'dot' && item.badge > 0 ? (
                      <span
                        aria-hidden="true"
                        className="ms-auto shrink-0 rounded-full bg-action-primary-bg px-2 text-label-sm font-semibold text-action-primary-fg tabular-nums"
                      >
                        {item.badge > 99 ? '99+' : item.badge}
                      </span>
                    ) : null}
                    {item.badge === 'dot' ? (
                      <span
                        aria-hidden="true"
                        className="ms-auto size-2 shrink-0 rounded-full bg-action-primary-bg"
                      />
                    ) : null}
                  </>
                );

                const shared = cx(
                  'relative flex min-h-11 w-full items-center gap-3 px-3 py-2 text-start',
                  'text-label-lg',
                  'hg-focus-inset',
                  active
                    ? 'bg-control-selected-bg font-semibold text-fg-primary before:absolute before:inset-y-1 before:start-0 before:w-1 before:rounded-e-full before:bg-action-primary-bg'
                    : 'text-fg-secondary hover:bg-surface-subtle',
                  item.disabled && 'pointer-events-none opacity-[var(--hg-state-disabled-opacity)]',
                );

                return (
                  <li key={item.key}>
                    {item.href && !item.disabled ? (
                      <a
                        href={item.href}
                        aria-label={name === item.label ? undefined : name}
                        aria-current={active ? 'page' : undefined}
                        aria-describedby={describedById}
                        data-testid={`${testId}-item-${item.key}`}
                        onClick={() => item.onSelect?.(item.key)}
                        className={shared}
                      >
                        {content}
                      </a>
                    ) : (
                      <button
                        type="button"
                        aria-label={name === item.label ? undefined : name}
                        aria-current={active ? 'page' : undefined}
                        aria-disabled={item.disabled || undefined}
                        aria-describedby={describedById}
                        data-testid={`${testId}-item-${item.key}`}
                        onClick={() => !item.disabled && item.onSelect?.(item.key)}
                        className={shared}
                      >
                        {content}
                      </button>
                    )}
                    {item.disabledReason ? (
                      <span id={describedById} className="sr-only">
                        {item.disabledReason}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {footer ? <div className="border-t border-line-decorative p-3">{footer}</div> : null}

      {onToggleCollapsed ? (
        <button
          type="button"
          data-testid={`${testId}-collapse`}
          aria-expanded={!collapsed}
          onClick={() => onToggleCollapsed(!collapsed)}
          className={cx(
            'flex min-h-11 items-center gap-2 border-t border-line-decorative px-3 text-start',
            'text-label-md text-fg-tertiary',
            'hg-focus-inset',
          )}
        >
          {collapsed ? 'Expand navigation' : 'Collapse navigation'}
        </button>
      ) : null}
    </div>
  );
}
