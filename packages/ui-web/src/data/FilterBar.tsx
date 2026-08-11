import { useRef, type ReactNode } from 'react';

import { Button, Input, Select } from '../primitives/index.js';
import { cx } from '../feedback/internal.js';

/**
 * `FilterBar` — what sits between the nav and the `DataTable` on every admin queue
 * (patterns §4.1).
 *
 * The behaviours that matter here are the ones the table depends on:
 *
 *  - **Filters are preserved across a retry.** The error path in `DataTable` says "filters
 *    preserved so Retry is one click"; that only holds if the filter state lives out here
 *    and is passed in, which is why this component is fully controlled.
 *  - **"Clear filters" is a real, prominent action**, rendered only when something is
 *    actually applied, and it is the same action the filtered-to-nothing empty state
 *    offers. The two must do the same thing.
 *  - The applied filters are **visible as removable chips**, so "why is this table empty"
 *    is answerable without opening every dropdown.
 *  - The chip row is arrow-key navigable and never traps focus (§10).
 *  - The result count is a polite live region — after applying a filter, that count is the
 *    only feedback a screen-reader user gets, and focus must stay in the control.
 */

export type FilterValue = string | readonly string[] | null;

export interface FilterOption {
  value: string;
  label: string;
  description?: string;
}

export interface FilterDefinition {
  key: string;
  label: string;
  kind: 'select' | 'multiselect' | 'text' | 'date';
  options?: readonly FilterOption[];
  placeholder?: string;
}

export interface SavedView {
  key: string;
  label: string;
}

export interface FilterBarProps {
  filters: readonly FilterDefinition[];
  /** Fully controlled. The caller owns this so it survives a retry. */
  value: Readonly<Record<string, FilterValue>>;
  onChange: (key: string, value: FilterValue) => void;
  onClear: () => void;
  /** Free-text search across the queue. */
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    label?: string;
  };
  /** Saved views per queue (onboarding, halal, refunds, cases). */
  savedViews?: readonly SavedView[];
  activeView?: string;
  onViewChange?: (key: string) => void;
  /** Announced politely after a filter change. */
  resultCount?: number | null;
  resultUnit?: string;
  /** True while the query is in flight. Controls stay usable (loading ≠ disabled). */
  busy?: boolean;
  sticky?: boolean;
  className?: string;
  testId?: string;
}

function isApplied(value: FilterValue): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  return String(value).length > 0;
}

function describe(filter: FilterDefinition, value: FilterValue): string {
  if (Array.isArray(value)) {
    const labels = value.map(
      (entry) => filter.options?.find((option) => option.value === entry)?.label ?? entry,
    );
    return labels.join(', ');
  }
  const raw = String(value);
  return filter.options?.find((option) => option.value === raw)?.label ?? raw;
}

export function FilterBar({
  filters,
  value,
  onChange,
  onClear,
  search,
  savedViews,
  activeView,
  onViewChange,
  resultCount,
  resultUnit = 'records',
  busy = false,
  sticky = false,
  className,
  testId = 'filter-bar',
}: FilterBarProps): ReactNode {
  const chipRowRef = useRef<HTMLUListElement | null>(null);

  const applied = filters.filter((filter) => isApplied(value[filter.key] ?? null));
  const anyApplied = applied.length > 0 || (search?.value ?? '').length > 0;

  /* Arrow keys move within the chip row; Tab leaves it. Focus is never trapped. */
  function onChipKeyDown(event: React.KeyboardEvent<HTMLUListElement>): void {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const chips = Array.from(
      chipRowRef.current?.querySelectorAll<HTMLButtonElement>('[data-chip]') ?? [],
    );
    const index = chips.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next = chips[(index + delta + chips.length) % chips.length];
    next?.focus();
  }

  return (
    <div
      data-testid={testId}
      data-busy={busy || undefined}
      className={cx(
        'flex flex-col gap-3 border-b border-line-decorative bg-surface-base p-3',
        sticky && 'sticky top-0 z-[var(--hg-z-sticky)]',
        className,
      )}
    >
      {savedViews?.length ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Saved views">
          {savedViews.map((view) => (
            <button
              key={view.key}
              type="button"
              aria-pressed={activeView === view.key}
              data-testid={`${testId}-view-${view.key}`}
              onClick={() => onViewChange?.(view.key)}
              className={cx(
                'inline-flex min-h-11 items-center rounded-full border px-3',
                'text-label-md',
                'hg-focus',
                activeView === view.key
                  ? 'border-line-brand bg-control-selected-bg font-semibold text-fg-primary'
                  : 'border-line-interactive text-fg-secondary hover:bg-surface-subtle',
              )}
            >
              {view.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        {search ? (
          <div className="min-w-64 flex-1">
            <Input
              variant="search"
              label={search.label ?? 'Search'}
              value={search.value}
              onChange={search.onChange}
              placeholder={search.placeholder}
              loading={busy}
            />
          </div>
        ) : null}

        {filters.map((filter) => {
          const current = value[filter.key] ?? null;

          if (filter.kind === 'text') {
            return (
              <div key={filter.key} className="min-w-48">
                <Input
                  label={filter.label}
                  value={typeof current === 'string' ? current : ''}
                  onChange={(next: string) => onChange(filter.key, next || null)}
                  placeholder={filter.placeholder}
                />
              </div>
            );
          }

          if (filter.kind === 'date') {
            return (
              <div key={filter.key} className="min-w-48">
                <Input
                  label={filter.label}
                  variant="text"
                  inputMode="numeric"
                  value={typeof current === 'string' ? current : ''}
                  onChange={(next: string) => onChange(filter.key, next || null)}
                  placeholder={filter.placeholder ?? 'YYYY-MM-DD'}
                />
              </div>
            );
          }

          if (filter.kind === 'multiselect') {
            const selected = Array.isArray(current) ? current : [];
            return (
              <fieldset key={filter.key} className="min-w-48">
                <legend className="text-label-md font-semibold text-fg-secondary">
                  {filter.label}
                </legend>
                <div className="mt-1 flex flex-wrap gap-1">
                  {filter.options?.map((option) => {
                    const on = selected.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={on}
                        data-testid={`${testId}-${filter.key}-${option.value}`}
                        onClick={() =>
                          onChange(
                            filter.key,
                            on
                              ? selected.filter((entry) => entry !== option.value)
                              : [...selected, option.value],
                          )
                        }
                        className={cx(
                          'inline-flex min-h-11 items-center gap-1 rounded-full border px-3',
                          'text-label-md',
                          'hg-focus',
                          on
                            ? 'border-line-brand bg-control-selected-bg font-semibold text-fg-primary'
                            : 'border-line-interactive text-fg-secondary hover:bg-surface-subtle',
                        )}
                      >
                        {/* Selected is border + fill + a check glyph, never fill alone. */}
                        {on ? (
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            width={12}
                            height={12}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={3}
                            strokeLinecap="round"
                          >
                            <path d="m5 13 4 4 10-10" />
                          </svg>
                        ) : null}
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            );
          }

          return (
            <div key={filter.key} className="min-w-48">
              <Select
                label={filter.label}
                value={typeof current === 'string' ? current : ''}
                onChange={(next: string) => onChange(filter.key, next || null)}
                placeholder={filter.placeholder ?? 'Any'}
                options={filter.options ?? []}
              />
            </div>
          );
        })}

        {anyApplied ? (
          <Button variant="tertiary" size="md" onPress={onClear}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {applied.length ? (
        <ul
          ref={chipRowRef}
          role="list"
          aria-label="Applied filters"
          onKeyDown={onChipKeyDown}
          className="flex flex-wrap items-center gap-2"
        >
          {applied.map((filter) => (
            <li key={filter.key}>
              <button
                type="button"
                data-chip
                data-testid={`${testId}-chip-${filter.key}`}
                aria-label={`Remove filter ${filter.label}: ${describe(filter, value[filter.key] ?? null)}`}
                onClick={() => onChange(filter.key, null)}
                className={cx(
                  'inline-flex min-h-8 items-center gap-2 rounded-full border border-line-interactive px-3',
                  'text-label-md text-fg-secondary hover:bg-surface-subtle',
                  'hg-focus',
                  // 32px chip, 44px hit area.
                  'relative after:absolute after:-inset-1.5 after:content-[""]',
                )}
              >
                <span className="font-semibold text-fg-primary">{filter.label}:</span>
                <span className="truncate">{describe(filter, value[filter.key] ?? null)}</span>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  width={12}
                  height={12}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <p
        aria-live="polite"
        data-testid={`${testId}-result-count`}
        className="text-body-sm tabular-nums text-fg-secondary"
      >
        {resultCount == null ? '' : `${resultCount} ${resultUnit}`}
      </p>
    </div>
  );
}
