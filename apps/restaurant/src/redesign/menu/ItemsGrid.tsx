/**
 * The items grid (MH `PartMenuGrid`, spec §1.2): one category, or search / filter results across
 * categories. Compact 44 px rows; a row that must explain a state grows to fit. With a panel
 * open the grid is narrow: Price and Review fold into the Item cell.
 */
import { cents } from '@hg/api-client';
import type { ReactNode } from 'react';
import { Badge, Button, DataTable, Icon, IconButton, Price, type DataTableColumn } from '../ds';
import { AvailabilityCell, type RowStatus } from './AvailabilityCell';
import {
  type LengthChoice,
  type MenuAccess,
  type MenuCategoryRow,
  type MenuItem,
  itemCountLabel,
  itemName,
  optionGroupCount,
  pendingRename,
  reviewOf,
} from './model';

export interface GridRow {
  item: MenuItem;
  category: MenuCategoryRow;
}

export interface ItemsGridProps {
  /** `heading` id, so the section is named by it. */
  headingId: string;
  title: string;
  /** The count line under the title; omitted while loading. */
  count: number | null;
  badges?: ReactNode;
  explanation?: ReactNode;
  rows: GridRow[];
  loading: boolean;
  /** Search or filter results: rows say which category they are in. */
  results: boolean;
  narrow: boolean;
  access: MenuAccess;
  lockId: string;
  detailsFor: string | null;
  editingId: string | null;
  statusOf: (itemId: string) => RowStatus | undefined;
  choiceOf: (itemId: string) => LengthChoice | undefined;
  menuOpenFor: string | null;
  setMenuOpenFor: (itemId: string | null) => void;
  onSwitch: (row: GridRow, on: boolean) => void;
  onLength: (row: GridRow, choice: 'hour' | 'indefinite') => void;
  onDetails: (row: GridRow, opener: HTMLElement | null) => void;
  onEdit: (row: GridRow, opener: HTMLElement | null) => void;
  restocked: Map<string, string>;
  now: number;
  timeZone: string;
  supportHref: string;
  emptyState: ReactNode;
}

function ReviewCell({ item }: { item: MenuItem }) {
  const r = reviewOf(item);
  return (
    <div className="flex flex-col items-start gap-0.5 py-0.5">
      <Badge label={r.label} variant={r.variant} appearance={r.outline ? 'outline' : 'tint'} size="sm" icon={r.icon} />
      {r.sub ? <span className="text-[13px] text-fg-secondary">{r.sub}</span> : null}
    </div>
  );
}

export function ItemsGrid(props: ItemsGridProps) {
  const {
    headingId,
    title,
    count,
    badges,
    explanation,
    rows,
    loading,
    results,
    narrow,
    access,
    lockId,
    detailsFor,
    editingId,
    statusOf,
    choiceOf,
    menuOpenFor,
    setMenuOpenFor,
    onSwitch,
    onLength,
    onDetails,
    onEdit,
    restocked,
    now,
    timeZone,
    supportHref,
    emptyState,
  } = props;

  const columns: DataTableColumn<GridRow>[] = [
    {
      key: 'details',
      header: 'Details',
      width: '56px',
      cell: (row: GridRow) => {
        const name = itemName(row.item);
        const open = detailsFor === row.item.id;
        return (
          <IconButton
            icon={<Icon name="back" size={18} weight={open ? 'bold' : 'linear'} className={open ? '-rotate-90' : 'rotate-180'} />}
            accessibilityLabel={open ? `Details open for ${name}` : `Show details for ${name}`}
            aria-expanded={open}
            aria-controls={open ? 'item-panel' : undefined}
            onClick={(e) => onDetails(row, e.currentTarget)}
            size="sm"
          />
        );
      },
    },
    {
      key: 'item',
      header: 'Item',
      textValue: (row: GridRow) => itemName(row.item),
      cell: (row: GridRow) => {
        const item = row.item;
        const r = reviewOf(item);
        const rename = pendingRename(item);
        const groups = optionGroupCount(item);
        return (
          <div className="flex min-w-0 flex-col gap-0.5 py-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[15px] font-semibold text-fg-primary">{itemName(item) || 'Unnamed item'}</span>
              {editingId === item.id ? <Badge label="Editing" variant="brand" size="sm" /> : null}
              {detailsFor === item.id ? <Badge label="Details open" appearance="outline" size="sm" /> : null}
            </div>
            {results ? <span className="text-[13px] text-fg-secondary">In {row.category.name}</span> : null}
            {rename ? <span className="text-[13px] text-fg-secondary">Under review: {rename}</span> : null}
            {groups ? <span className="text-[13px] text-fg-secondary">{groups === 1 ? '1 option group' : `${groups} option groups`}</span> : null}
            {narrow ? (
              <div className="flex flex-wrap items-center gap-2">
                <Price cents={cents(item.price_cents)} size="sm" />
                {r.kind !== 'approved' ? (
                  <Badge label={r.label} variant={r.variant} appearance={r.outline ? 'outline' : 'tint'} size="sm" icon={r.icon} />
                ) : null}
                {r.kind !== 'approved' && r.sub ? <span className="text-[13px] text-fg-secondary">{r.sub}</span> : null}
              </div>
            ) : null}
          </div>
        );
      },
    },
    ...(narrow
      ? []
      : [
          {
            key: 'price',
            header: 'Price',
            width: '96px',
            align: 'end' as const,
            contentClass: 'money' as const,
            cell: (row: GridRow) => <Price cents={cents(row.item.price_cents)} size="md" />,
          },
        ]),
    {
      key: 'availability',
      header: 'Availability',
      width: narrow ? '210px' : '300px',
      cell: (row: GridRow) => (
        <AvailabilityCell
          item={row.item}
          categoryName={row.category.name}
          categoryActive={row.category.is_active}
          access={access}
          lockId={lockId}
          status={statusOf(row.item.id)}
          choice={choiceOf(row.item.id)}
          menuOpen={menuOpenFor === row.item.id}
          onMenuOpenChange={(open) => setMenuOpenFor(open ? row.item.id : null)}
          onSwitch={(on) => onSwitch(row, on)}
          onLength={(c) => onLength(row, c)}
          restockedAt={restocked.get(row.item.id)}
          now={now}
          timeZone={timeZone}
          supportHref={supportHref}
        />
      ),
    },
    ...(narrow ? [] : [{ key: 'review', header: 'Review', width: '190px', cell: (row: GridRow) => <ReviewCell item={row.item} /> }]),
    ...(access === 'view-only'
      ? []
      : [
          {
            key: 'edit',
            header: access === 'locked' ? 'View' : 'Edit',
            width: '80px',
            cell: (row: GridRow) => {
              const name = itemName(row.item);
              const view = access === 'locked' || row.item.availability_state === 'BLOCKED';
              return (
                <Button
                  variant="ghost"
                  size="sm"
                  accessibilityLabel={view ? `View ${name}` : `Edit ${name}`}
                  onClick={(e) => onEdit(row, e.currentTarget)}
                >
                  {view ? 'View' : 'Edit'}
                </Button>
              );
            },
          },
        ]),
  ];

  return (
    <section aria-labelledby={headingId} className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id={headingId} className="text-[20px] font-semibold leading-7 text-fg-primary">
            {title}
          </h2>
          {count !== null ? <span className="text-[14px] text-fg-secondary">{itemCountLabel(count)}</span> : null}
          {badges}
        </div>
        {explanation}
      </div>
      <div
        role="region"
        aria-label={`${title} items, scrolls on its own`}
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-y-auto rounded-md outline-none"
      >
        <DataTable<GridRow>
          caption={`${title} items`}
          columns={columns}
          rows={loading ? [] : rows}
          getRowId={(row) => row.item.id}
          getRowLabel={(row) => itemName(row.item)}
          loading={loading}
          density="compact"
          stickyHeader
          emptyState={emptyState}
          entityPlural="items"
          testId="menu-grid"
        />
      </div>
    </section>
  );
}
