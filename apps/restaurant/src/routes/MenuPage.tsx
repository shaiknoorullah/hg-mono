import { useMemo, useState } from 'react';
import * as Switch from '@radix-ui/react-switch';
import { isApiError, type Schema } from '@hg/api-client';
import { Button, Card, EmptyState, ErrorState, Icon, IconButton, cx } from '@hg/ui-web';
import { api, unwrapOrThrow } from '../lib/apiHelpers';
import { useAsync } from '../lib/useAsync';
import { PageLoading } from '../components/PageLoading';
import { StatusChip } from '../components/StatusChip';
import { IconEdit, IconMenuBook } from '../lib/icons';
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
          <h1 className="text-heading-md font-extrabold text-fg-primary">Menu</h1>
          <p className="text-body-sm text-fg-secondary">Out-of-stock and hidden items stay listed — they just can't be added to a cart.</p>
        </div>
        <Button iconStart={<Icon name="plus" size={15} />} onPress={() => setAddOpen(true)}>
          Add item
        </Button>
      </header>

      {categories.length === 0 ? (
        <EmptyState
          illustration={<IconMenuBook size={32} />}
          title="No categories yet"
          description="Add your first category and item to get one step closer to going live."
          primaryAction={{ label: 'Add your first item', onPress: () => setAddOpen(true) }}
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
                  className={cx(
                    'flex w-full items-center justify-between rounded-sm px-3 py-2.5 text-start text-label-md font-bold hg-focus-inset',
                    (activeCategory ?? categories[0]?.id) === cat.id
                      ? 'bg-[var(--hg-state-selected-tint)] text-fg-primary'
                      : 'text-fg-secondary hover:bg-surface-subtle',
                  )}
                >
                  <span className="truncate">{cat.name}</span>
                  {!cat.is_active && <StatusChip tone="neutral">Off</StatusChip>}
                </button>
              ))}
          </nav>

          <div className="min-w-0 flex-1 space-y-3">
            {(selected?.items ?? []).length === 0 && (
              <EmptyState title="No items in this category" description="Add an item to fill it in." variant="inline" />
            )}
            {(selected?.items ?? []).map((item) => (
              <Card key={item.id} className="flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-label-lg font-bold text-fg-primary">{item.name}</p>
                    {item.availability_state === 'BLOCKED' && <StatusChip tone="danger">Blocked by admin</StatusChip>}
                    {item.availability_state === 'HIDDEN' && <StatusChip tone="neutral">Hidden</StatusChip>}
                    {/* Not `HalalBadge`: every listing on this platform is already halal-certified
                        (the certification tier's job is proving that claim once, not tagging
                        individual items), so this is a plain informational label, never a
                        second, redundant green seal (RULE H-1 / lint L-4). */}
                    {item.dietary_tags?.includes('HALAL_CERTIFIED') && <StatusChip tone="neutral">Halal certified</StatusChip>}
                    {item.pending_version && <StatusChip tone="warning">Edit pending review</StatusChip>}
                    {(item.variant_groups?.length ?? 0) > 0 && (
                      <StatusChip tone="neutral">
                        {item.variant_groups!.length} variant group{item.variant_groups!.length === 1 ? '' : 's'}
                      </StatusChip>
                    )}
                  </div>
                  <p className="truncate text-body-sm text-fg-secondary">{item.description}</p>
                  <p className="mt-1 text-label-md font-extrabold text-fg-primary">{money(item.price_cents)}</p>
                </div>
                <div className="flex flex-none items-center gap-3">
                  <span className="text-label-sm font-bold text-fg-secondary">
                    {item.availability_state === 'AVAILABLE' ? 'Available' : 'Out of stock'}
                  </span>
                  <Switch.Root
                    checked={item.availability_state === 'AVAILABLE'}
                    disabled={busyItem === item.id || item.availability_state === 'BLOCKED' || item.availability_state === 'HIDDEN'}
                    onCheckedChange={() => toggleAvailability(item)}
                    className="relative h-6 w-11 rounded-full bg-surface-subtle outline-none transition-colors data-[state=checked]:bg-action-primary-bg disabled:opacity-50"
                  >
                    <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow-e1 transition-transform duration-200 data-[state=checked]:translate-x-[22px]" />
                  </Switch.Root>
                  <IconButton
                    variant="plain"
                    size="sm"
                    accessibilityLabel={`Edit ${item.name}`}
                    icon={<IconEdit size={16} />}
                    onPress={() => setEditItem(item)}
                  />
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
