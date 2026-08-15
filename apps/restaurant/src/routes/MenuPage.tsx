import { useMemo, useState } from 'react';
import * as Switch from '@radix-ui/react-switch';
import { isApiError, type Schema } from '@hg/api-client';
import { api, unwrapOrThrow } from '../lib/apiHelpers';
import { useAsync } from '../lib/useAsync';
import { Button, Card, Chip, EmptyState, ErrorState, PageLoading } from '../components/primitives';
import { IconEdit, IconMenuBook, IconPlus } from '../lib/icons';
import { AddItemDialog } from '../components/AddItemDialog';
import { EditItemDialog, type EditableMenuItem } from '../components/EditItemDialog';

/**
 * See the note in `OrdersPage.tsx`: values read back through `unwrapOrThrow` lose the
 * `Cents` brand's `number` intersection member through openapi-fetch's response-type
 * machinery, even though they are plain numbers at runtime — `Number()` is a no-op here.
 */
function money(value: unknown) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(Number(value) / 100);
}

export function MenuPage() {
  const { status, data, error, reload } = useAsync(() => unwrapOrThrow(api.GET('/v1/restaurant/menu', {})), []);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<EditableMenuItem | null>(null);

  const categories = data?.categories ?? [];
  const selected = useMemo(
    () => categories.find((c) => c.id === (activeCategory ?? categories[0]?.id)),
    [categories, activeCategory],
  );

  if (status === 'loading') return <PageLoading label="Loading your menu…" />;
  if (status === 'error') {
    return (
      <div className="p-6">
        <ErrorState description={error ?? undefined} onRetry={reload} />
      </div>
    );
  }

  async function toggleAvailability(item: { id: string; availability_state: Schema['MenuItemAvailabilityState'] }) {
    setBusyItem(item.id);
    try {
      const next = item.availability_state === 'AVAILABLE' ? 'OUT_OF_STOCK' : 'AVAILABLE';
      await unwrapOrThrow(
        api.PUT('/v1/restaurant/menu/items/{itemId}/availability', {
          params: { path: { itemId: item.id } },
          body: { availability_state: next },
        }),
      );
      reload();
    } catch (e) {
      // Surfaced inline rather than a global toast — keeps the failing row identifiable.
      alert(isApiError(e) ? e.message : 'Could not update availability.'); // eslint-disable-line no-alert
    } finally {
      setBusyItem(null);
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-extrabold text-[var(--ink)]">Menu</h1>
          <p className="text-[13px] text-[var(--ink2)]">Out-of-stock and hidden items stay listed — they just can't be added to a cart.</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <IconPlus size={15} /> Add item
        </Button>
      </header>

      {categories.length === 0 ? (
        <EmptyState
          icon={<IconMenuBook size={32} />}
          title="No categories yet"
          description="Add your first category and item to get one step closer to going live."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <IconPlus size={15} /> Add your first item
            </Button>
          }
        />
      ) : (
        <div className="flex gap-6">
          <nav className="w-[190px] flex-none space-y-1">
            {categories
              .slice()
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={
                    'flex w-full items-center justify-between rounded-[var(--r-sm)] px-3 py-2.5 text-left text-[13px] font-bold transition-colors ' +
                    ((activeCategory ?? categories[0]?.id) === cat.id
                      ? 'bg-[var(--accent-50)] text-[var(--accent-700)]'
                      : 'text-[var(--ink2)] hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]')
                  }
                >
                  <span className="truncate">{cat.name}</span>
                  {!cat.is_active && <Chip tone="neutral">Off</Chip>}
                </button>
              ))}
          </nav>

          <div className="min-w-0 flex-1 space-y-3">
            {(selected?.items ?? []).length === 0 && (
              <EmptyState title="No items in this category" description="Add an item to fill it in." />
            )}
            {(selected?.items ?? []).map((item) => (
              <Card key={item.id} className="flex items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[14px] font-bold text-[var(--ink)]">{item.name}</p>
                    {item.availability_state === 'BLOCKED' && <Chip tone="danger">Blocked by admin</Chip>}
                    {item.availability_state === 'HIDDEN' && <Chip tone="neutral">Hidden</Chip>}
                    {item.dietary_tags?.includes('HALAL_CERTIFIED') && <Chip tone="halal">Halal certified</Chip>}
                    {item.pending_version && <Chip tone="warning">Edit pending review</Chip>}
                    {(item.variant_groups?.length ?? 0) > 0 && (
                      <Chip tone="neutral">
                        {item.variant_groups!.length} variant group{item.variant_groups!.length === 1 ? '' : 's'}
                      </Chip>
                    )}
                  </div>
                  <p className="truncate text-[12.5px] text-[var(--ink2)]">{item.description}</p>
                  <p className="mt-1 text-[13px] font-extrabold text-[var(--ink)]">{money(item.price_cents)}</p>
                </div>
                <div className="flex flex-none items-center gap-3">
                  <span className="text-[11.5px] font-bold text-[var(--ink2)]">
                    {item.availability_state === 'AVAILABLE' ? 'Available' : 'Out of stock'}
                  </span>
                  <Switch.Root
                    checked={item.availability_state === 'AVAILABLE'}
                    disabled={busyItem === item.id || item.availability_state === 'BLOCKED' || item.availability_state === 'HIDDEN'}
                    onCheckedChange={() => toggleAvailability(item)}
                    className="relative h-6 w-11 rounded-full bg-[var(--hair)] outline-none transition-colors data-[state=checked]:bg-[var(--accent-600)] disabled:opacity-50"
                  >
                    <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow-[var(--shadow-1)] transition-transform duration-200 data-[state=checked]:translate-x-[22px]" />
                  </Switch.Root>
                  <button
                    onClick={() => setEditItem(item)}
                    className="rounded-[var(--r-sm)] p-2 text-[var(--ink3)] transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-[var(--ink)]"
                    aria-label={`Edit ${item.name}`}
                  >
                    <IconEdit size={16} />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {addOpen && (
        <AddItemDialog
          categories={categories}
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            setAddOpen(false);
            reload();
          }}
        />
      )}

      {editItem && (
        <EditItemDialog
          item={editItem}
          onClose={() => setEditItem(null)}
          onSaved={() => {
            setEditItem(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
