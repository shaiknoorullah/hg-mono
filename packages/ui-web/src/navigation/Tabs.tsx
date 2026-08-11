import * as RadixTabs from '@radix-ui/react-tabs';
import { useEffect, useRef, type ReactNode } from 'react';

import { Skeleton } from '../primitives/index.js';
import { cx } from '../feedback/internal.js';

/**
 * `Tabs` — in-page section switching (§29): menu categories, admin detail sections, the
 * restaurant queue columns collapsed onto a narrow screen.
 *
 * Radix owns the tabs pattern itself — roving tabindex, arrows, Home/End, the
 * `aria-controls`/`aria-labelledby` pairing — which is exactly the case where the brief
 * says to reach for it. What is added on top:
 *
 *  - **The active tab scrolls itself into view without stealing focus.** A tab strip that
 *    scrolls on focus is fine; one that grabs focus on a data refresh is not (a11y §4.2).
 *  - `manual` activation by default for `scrollable`, so arrowing across a long strip does
 *    not fire a network request per key press. `automatic` elsewhere.
 *  - A `loading` strip of skeleton pills with the real tab count, because the number of
 *    sections is known before their contents are.
 *  - Badges live inside the tab's accessible name.
 */

export type TabsVariant = 'underline' | 'pill';

export interface TabDefinition {
  key: string;
  label: string;
  badge?: number;
  badgeNoun?: string;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: readonly TabDefinition[];
  value: string;
  onChange: (key: string) => void;
  variant?: TabsVariant;
  /** Horizontal scroll for long strips (menu categories). */
  scrollable?: boolean;
  /** Sticks the strip to the top of its scroll container. */
  sticky?: boolean;
  /** Skeleton pills, in the real tab count. */
  loading?: boolean;
  /** Names the tablist. */
  label: string;
  /** `TabPanel` children. */
  children?: ReactNode;
  className?: string;
  testId?: string;
}

function tabAccessibleName(tab: TabDefinition): string | undefined {
  if (tab.badge === undefined || tab.badge <= 0) return undefined;
  return `${tab.label}, ${tab.badge} ${tab.badgeNoun ?? 'items'}`;
}

export function Tabs({
  tabs,
  value,
  onChange,
  variant = 'underline',
  scrollable = false,
  sticky = false,
  loading = false,
  label,
  children,
  className,
  testId = 'tabs',
}: TabsProps): ReactNode {
  const listRef = useRef<HTMLDivElement | null>(null);

  // Bring the active tab into view. `block: 'nearest'` so the page itself does not jump,
  // and no `focus()` anywhere — scrolling is not focusing.
  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>(`[data-tab-key="${value}"]`);
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [value]);

  if (loading) {
    return (
      <div
        data-testid={`${testId}-loading`}
        aria-busy="true"
        aria-label={`Loading ${label}`}
        className={cx('flex gap-2 p-2', className)}
      >
        {/* The real tab count: the number of sections is known before their contents. */}
        {tabs.map((tab) => (
          <Skeleton key={tab.key} variant="rect" width={96} height={36} />
        ))}
      </div>
    );
  }

  return (
    <RadixTabs.Root
      value={value}
      onValueChange={onChange}
      // Manual activation on a scrollable strip: arrowing must not fire a fetch per key.
      activationMode={scrollable ? 'manual' : 'automatic'}
      data-testid={testId}
      className={cx('flex min-w-0 flex-col', className)}
    >
      <RadixTabs.List
        ref={listRef}
        aria-label={label}
        loop
        className={cx(
          'flex min-w-0 flex-row items-center gap-1',
          variant === 'underline' && 'border-b border-line-decorative',
          scrollable && 'overflow-x-auto scrollbar-none',
          sticky && 'sticky top-0 z-[var(--hg-z-sticky)] bg-surface-base',
        )}
      >
        {tabs.map((tab) => (
          <RadixTabs.Trigger
            key={tab.key}
            value={tab.key}
            disabled={tab.disabled}
            data-tab-key={tab.key}
            data-testid={`${testId}-trigger-${tab.key}`}
            aria-label={tabAccessibleName(tab)}
            className={cx(
              'relative inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap px-4',
              'text-label-lg',
              'hg-focus-inset',
              'disabled:opacity-[var(--hg-state-disabled-opacity)]',
              variant === 'underline'
                ? cx(
                    'text-fg-secondary hover:text-fg-primary',
                    'data-[state=active]:font-semibold data-[state=active]:text-fg-primary',
                    'data-[state=active]:after:absolute data-[state=active]:after:inset-x-0',
                    'data-[state=active]:after:bottom-0 data-[state=active]:after:h-0.5',
                    'data-[state=active]:after:bg-action-primary-bg',
                  )
                : cx(
                    'rounded-full text-fg-secondary hover:bg-surface-subtle',
                    'data-[state=active]:bg-control-selected-bg data-[state=active]:font-semibold',
                    'data-[state=active]:text-fg-primary',
                  ),
            )}
          >
            <span>{tab.label}</span>
            {tab.badge !== undefined && tab.badge > 0 ? (
              <span
                aria-hidden="true"
                className="rounded-full bg-surface-subtle px-2 text-label-sm font-semibold tabular-nums text-fg-secondary"
              >
                {tab.badge > 99 ? '99+' : tab.badge}
              </span>
            ) : null}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>

      {children}
    </RadixTabs.Root>
  );
}

export interface TabPanelProps {
  tabKey: string;
  children: ReactNode;
  className?: string;
  /**
   * Keep the panel mounted while inactive. Scroll position is preserved per tab (§29),
   * which only works if the DOM survives the switch. Default true.
   */
  keepMounted?: boolean;
}

export function TabPanel({
  tabKey,
  children,
  className,
  keepMounted = true,
}: TabPanelProps): ReactNode {
  return (
    <RadixTabs.Content
      value={tabKey}
      forceMount={keepMounted ? true : undefined}
      data-testid={`tab-panel-${tabKey}`}
      className={cx(
        'min-w-0 hg-focus',
        keepMounted && 'data-[state=inactive]:hidden',
        className,
      )}
    >
      {children}
    </RadixTabs.Content>
  );
}
