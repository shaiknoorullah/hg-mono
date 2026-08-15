import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import { idempotencyKey, isApiError, type Schema } from '@hg/api-client';
import { api, unwrapOrThrow } from '../lib/apiHelpers';
import { Button, FieldError, Input, Label } from './primitives';
import { IconClose } from '../lib/icons';

export function AddItemDialog({
  categories,
  onClose,
  onCreated,
}: {
  categories: Schema['MenuCategory'][];
  onClose: () => void;
  onCreated: () => void;
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
      setError(isApiError(e) ? e.message : e instanceof Error ? e.message : 'Could not add this item.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(460px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--r)] bg-[var(--card)] p-6 shadow-[var(--shadow-3)]">
          <div className="mb-4 flex items-start justify-between">
            <Dialog.Title className="text-[16px] font-extrabold text-[var(--ink)]">Add menu item</Dialog.Title>
            <Dialog.Close className="rounded-full p-1 text-[var(--ink3)] hover:bg-[var(--hair)]">
              <IconClose size={16} />
            </Dialog.Close>
          </div>

          <div className="space-y-4">
            <div>
              <Label>Category</Label>
              <Tabs.Root value={mode} onValueChange={(v) => setMode(v as 'existing' | 'new')}>
                <Tabs.List className="mb-2 flex gap-2">
                  <Tabs.Trigger
                    value="existing"
                    disabled={categories.length === 0}
                    className="rounded-[var(--r-pill)] px-3 py-1.5 text-[12px] font-bold text-[var(--ink2)] data-[state=active]:bg-[var(--accent-50)] data-[state=active]:text-[var(--accent-700)] disabled:opacity-40"
                  >
                    Existing
                  </Tabs.Trigger>
                  <Tabs.Trigger
                    value="new"
                    className="rounded-[var(--r-pill)] px-3 py-1.5 text-[12px] font-bold text-[var(--ink2)] data-[state=active]:bg-[var(--accent-50)] data-[state=active]:text-[var(--accent-700)]"
                  >
                    New category
                  </Tabs.Trigger>
                </Tabs.List>
                <Tabs.Content value="existing">
                  <select
                    className="h-11 w-full rounded-[var(--r-sm)] border border-[var(--hair)] bg-[var(--card)] px-3 text-[14px] outline-none focus:border-[var(--primary)]"
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Tabs.Content>
                <Tabs.Content value="new">
                  <Input value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="e.g. Grills" />
                </Tabs.Content>
              </Tabs.Root>
            </div>

            <div>
              <Label htmlFor="item-name">Item name</Label>
              <Input id="item-name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} placeholder="Chicken Shawarma Plate" />
            </div>
            <div>
              <Label htmlFor="item-price">Price (CAD)</Label>
              <Input id="item-price" required type="number" step="0.01" min="0.5" max="500" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="14.99" />
            </div>
            <div>
              <Label htmlFor="item-desc">Description</Label>
              <textarea
                id="item-desc"
                rows={2}
                maxLength={600}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-[var(--r-sm)] border border-[var(--hair)] bg-[var(--card)] px-3 py-2 text-[13.5px] outline-none focus:border-[var(--primary)]"
              />
            </div>

            <FieldError>{error}</FieldError>

            <Button className="w-full" loading={busy} onClick={submit} disabled={!name || !price}>
              Add item
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
