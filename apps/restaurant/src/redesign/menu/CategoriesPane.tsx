/**
 * The categories pane (MH, Proposed SideNav list variant, spec §1.1): one link per category with
 * its note and item count; selecting one shows only its items. It collapses to 56 px whenever a
 * panel or the editor is open. No rename, reorder or delete (Needs API #149).
 */
import { Link } from 'react-router-dom';
import { Icon, IconButton, Skeleton } from '../ds';
import { type MenuCategoryRow, categoryNote } from './model';

export interface CategoriesPaneProps {
  categories: MenuCategoryRow[] | null;
  /** Count per category to show (search results count only matches). */
  countOf: (c: MenuCategoryRow) => number;
  selectedId: string | null;
  /** Search or filter is on: no category is selected; the collapsed label reads "Search". */
  searching: boolean;
  collapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  hrefFor: (categoryId: string) => string;
  /** A category was chosen (the page leaves search and filter so it opens). */
  onSelect?: (categoryId: string) => void;
}

export function CategoriesPane({ categories, countOf, selectedId, searching, collapsed, onCollapse, onExpand, hrefFor, onSelect }: CategoriesPaneProps) {
  if (collapsed) {
    const selected = categories?.find((c) => c.id === selectedId);
    return (
      <nav
        aria-label="Menu categories, collapsed"
        className="flex w-14 shrink-0 flex-col items-center gap-3 rounded-md border border-line-decorative bg-surface-raised py-2"
      >
        <IconButton icon={<Icon name="back" size={18} className="rotate-180" />} accessibilityLabel="Show categories" onPress={onExpand} size="sm" />
        <span className="text-[14px] font-semibold text-fg-secondary [writing-mode:vertical-rl]">
          {searching ? 'Search' : (selected?.name ?? '')}
        </span>
      </nav>
    );
  }
  return (
    <nav
      aria-label="Menu categories"
      className="flex w-[216px] shrink-0 flex-col overflow-hidden rounded-md border border-line-decorative bg-surface-raised"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <span className="text-[14px] font-semibold text-fg-secondary">Categories</span>
        <IconButton icon={<Icon name="back" size={18} />} accessibilityLabel="Collapse categories" onPress={onCollapse} size="sm" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {categories === null ? (
          <div aria-hidden="true" className="flex flex-col gap-2 px-1.5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} variant="rect" height={36} />
            ))}
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {categories.map((c) => {
              const current = !searching && c.id === selectedId;
              const note = categoryNote(c);
              const n = countOf(c);
              return (
                <li key={c.id}>
                  <Link
                    to={hrefFor(c.id)}
                    onClick={() => onSelect?.(c.id)}
                    aria-current={current ? 'true' : undefined}
                    className={`hg-focus flex min-h-11 items-center gap-2 rounded-md px-2.5 py-1.5 text-[15px] text-fg-primary hover:bg-surface-subtle ${
                      current ? 'bg-brand-50 font-bold' : ''
                    }`}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{c.name}</span>
                      {note ? <span className="text-[13px] font-normal text-fg-secondary">{note}</span> : null}
                    </span>
                    <span className="shrink-0 tabular-nums text-fg-secondary">
                      <span className="sr-only">, </span>
                      {n}
                      <span className="sr-only">{n === 1 ? ' item' : ' items'}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </nav>
  );
}
