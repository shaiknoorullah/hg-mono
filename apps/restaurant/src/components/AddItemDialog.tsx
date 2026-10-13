import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import { idempotencyKey, isApiError, type Schema } from '@hg/api-client';
import { Button, Icon, IconButton, Input, Select, Textarea, cx } from '@hg/ui-web';
import { api, unwrapOrThrow } from '../lib/apiHelpers';
import { menuLockFromError, type MenuLockState } from './MenuLockedNotice';

export function AddItemDialog({
  categories,
  onClose,
  onCreated,
  onLocked,
}: {
  categories: Schema['MenuCategory'][];
  onClose: () => void;
  onCreated: () => void;
  /** A save refused with `403 MENU_LOCKED`: the page shows the locked-menu notice instead of an error. */
  onLocked: (state: MenuLockState) => void;
}) {
  const [mode, setMode] = useState<'existing' | 'new'>(categories.length ? 'existing' : 'new');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      let targetCategoryId = categoryId;
      if (mode === 'new') {
        if (newCategoryName.trim().length < 1) throw new Error('Name the category first.');
        const cat = await unwrapOrThrow(
          api.POST('/v1/restaurant/menu/categories', {
            params: { header: { 'Idempotency-Key': idempotencyKey() } },
            body: { name: newCategoryName },
          }),
        );
        targetCategoryId = cat.id;
      }
      if (!targetCategoryId) throw new Error('Choose a category.');
      const priceCents = Math.round(Number(price) * 100);
      if (!Number.isFinite(priceCents) || priceCents < 50 || priceCents > 50000) {
        throw new Error('Price must be between $0.50 and $500.00.');
      }
      await unwrapOrThrow(
        api.POST('/v1/restaurant/menu/items', {
          params: { header: { 'Idempotency-Key': idempotencyKey() } },
          body: { category_id: targetCategoryId, name, price_cents: priceCents, description: description || undefined },
        }),
      );
      onCreated();
    } catch (e) {
      const refused = menuLockFromError(e);
      if (refused) {
        onLocked(refused);
        return;
      }
      setError(isApiError(e) ? e.message : e instanceof Error ? e.message : 'Could not add this item.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-(--hg-z-modal) bg-surface-scrim" />
        <Dialog.Content className="fixed start-1/2 top-1/2 z-(--hg-z-modal) w-[min(460px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line-decorative bg-surface-raised p-6 shadow-e4">
          <div className="mb-4 flex items-start justify-between">
            <Dialog.Title className="text-heading-sm font-semibold text-fg-primary">Add menu item</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton variant="plain" size="sm" accessibilityLabel="Close" icon={<Icon name="close" size={16} />} />
            </Dialog.Close>
          </div>

          <div className="space-y-4">
            <div>
              <Tabs.Root value={mode} onValueChange={(v) => setMode(v as 'existing' | 'new')}>
                <Tabs.List className="mb-2 flex gap-2">
                  <Tabs.Trigger
                    value="existing"
                    disabled={categories.length === 0}
                    className={cx(
                      'rounded-full px-3 py-1.5 text-label-sm font-bold text-fg-secondary disabled:opacity-40',
                      'data-[state=active]:bg-[var(--hg-state-selected-tint)] data-[state=active]:text-fg-primary',
                    )}
                  >
                    Existing category
                  </Tabs.Trigger>
                  <Tabs.Trigger
                    value="new"
                    className={cx(
                      'rounded-full px-3 py-1.5 text-label-sm font-bold text-fg-secondary',
                      'data-[state=active]:bg-[var(--hg-state-selected-tint)] data-[state=active]:text-fg-primary',
                    )}
                  >
                    New category
                  </Tabs.Trigger>
                </Tabs.List>
                <Tabs.Content value="existing">
                  <Select
                    label="Category"
                    labelHidden
                    value={categoryId}
                    onChange={setCategoryId}
                    options={categories.map((c) => ({ value: c.id, label: c.name }))}
                  />
                </Tabs.Content>
                <Tabs.Content value="new">
                  <Input label="New category name" labelHidden value={newCategoryName} onChange={setNewCategoryName} placeholder="e.g. Grills" />
                </Tabs.Content>
              </Tabs.Root>
            </div>

            <Input label="Item name" required minLength={2} value={name} onChange={setName} placeholder="Chicken Shawarma Plate" />
            <Input
              label="Price (CAD)"
              required
              variant="numeric"
              value={price}
              onChange={setPrice}
              placeholder="14.99"
              helperText="Between $0.50 and $500.00."
            />
            <Textarea label="Description" rows={2} maxLength={600} value={description} onChange={setDescription} />

            {error ? (
              <p role="alert" className="text-body-sm text-feedback-danger-text">
                {error}
              </p>
            ) : null}

            <Button fullWidth loading={busy} onPress={() => void submit()} disabled={!name || !price}>
              Add item
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
