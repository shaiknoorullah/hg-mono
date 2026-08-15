import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { isApiError, type Schema } from '@hg/api-client';
import { api, unwrapOrThrow } from '../lib/apiHelpers';
import { Button, Chip, FieldError, Input, Label } from './primitives';
import { IconClose } from '../lib/icons';

const DIETARY_TAGS: Exclude<Schema['DietaryTag'], 'HALAL_CERTIFIED'>[] = [
  'VEGETARIAN',
  'VEGAN',
  'GLUTEN_FREE',
  'DAIRY_FREE',
  'NUT_FREE',
  'SPICY',
  'KETO',
  'LOW_CARB',
];

const ALLERGEN_TAGS: Schema['AllergenTag'][] = [
  'PEANUTS',
  'TREE_NUTS',
  'SESAME',
  'MILK',
  'EGGS',
  'FISH',
  'CRUSTACEANS_MOLLUSCS',
  'SOY',
  'WHEAT_TRITICALE',
  'SULPHITES',
  'MUSTARD',
];

function TagToggle<T extends string>({ value, options, onChange, tone }: { value: T[]; options: readonly T[]; onChange: (next: T[]) => void; tone: 'accent' | 'warning' }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = value.includes(opt);
        return (
          <button
            type="button"
            key={opt}
            onClick={() => onChange(active ? value.filter((v) => v !== opt) : [...value, opt])}
            className={
              'rounded-[var(--r-pill)] px-2.5 py-1 text-[11px] font-bold transition-colors ' +
              (active
                ? tone === 'accent'
                  ? 'bg-[var(--accent-600)] text-white'
                  : 'bg-[var(--warning-600)] text-white'
                : 'bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] text-[var(--ink2)]')
            }
          >
            {opt.replace(/_/g, ' ')}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Deliberately structural rather than `Schema['MenuItemOwnerView']`: values read back
 * through `unwrapOrThrow` lose the `Cents` brand's `number` intersection member through
 * openapi-fetch's response-type machinery (see the note in OrdersPage.tsx/MenuPage.tsx),
 * so `price_cents` and friends are typed `unknown` here and read with `Number(...)`.
 */
interface EditableVariant {
  id: string;
  name: string;
  pricing_mode: Schema['VariantPricingMode'];
  price_cents?: unknown;
  delta_cents?: unknown;
}
interface EditableVariantGroup {
  id: string;
  name: string;
  required: boolean;
  variants: EditableVariant[];
}
export interface EditableMenuItem {
  id: string;
  name: string;
  price_cents: unknown;
  description?: string | null;
  ingredients_text?: string | null;
  prep_minutes?: number | null;
  dietary_tags?: Schema['DietaryTag'][];
  allergen_tags?: Schema['AllergenTag'][];
  variant_groups?: EditableVariantGroup[];
  pending_version?: unknown;
}

export function EditItemDialog({
  item,
  onClose,
  onSaved,
}: {
  item: EditableMenuItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState((Number(item.price_cents) / 100).toFixed(2));
  const [description, setDescription] = useState(item.description ?? '');
  const [ingredientsText, setIngredientsText] = useState(item.ingredients_text ?? '');
  const [prepMinutes, setPrepMinutes] = useState(item.prep_minutes ?? 20);
  const [dietaryTags, setDietaryTags] = useState<Exclude<Schema['DietaryTag'], 'HALAL_CERTIFIED'>[]>(
    (item.dietary_tags ?? []).filter((t): t is Exclude<Schema['DietaryTag'], 'HALAL_CERTIFIED'> => t !== 'HALAL_CERTIFIED'),
  );
  const [allergenTags, setAllergenTags] = useState<Schema['AllergenTag'][]>(item.allergen_tags ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const priceCents = Math.round(Number(price) * 100);
      if (!Number.isFinite(priceCents) || priceCents < 50 || priceCents > 50000) {
        throw new Error('Price must be between $0.50 and $500.00.');
      }
      await unwrapOrThrow(
        api.PATCH('/v1/restaurant/menu/items/{itemId}', {
          params: { path: { itemId: item.id } },
          body: {
            name,
            price_cents: priceCents,
            description: description || undefined,
            ingredients_text: ingredientsText || undefined,
            prep_minutes: prepMinutes,
            dietary_tags: dietaryTags,
            allergen_tags: allergenTags,
            allergens_declared: true,
          },
        }),
      );
      onSaved();
    } catch (e) {
      setError(isApiError(e) ? e.message : e instanceof Error ? e.message : 'Could not update this item.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[min(520px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--r)] bg-[var(--card)] p-6 shadow-[var(--shadow-3)]">
          <div className="mb-1 flex items-start justify-between">
            <Dialog.Title className="text-[16px] font-extrabold text-[var(--ink)]">Edit item</Dialog.Title>
            <Dialog.Close className="rounded-full p-1 text-[var(--ink3)] hover:bg-[var(--hair)]">
              <IconClose size={16} />
            </Dialog.Close>
          </div>
          <p className="mb-4 text-[12px] text-[var(--ink2)]">
            Price and prep time apply instantly. Name, description, ingredients and tags queue for admin review before
            customers see them — see the pending badge on the menu list.
          </p>

          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-name">Item name</Label>
              <Input id="edit-name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="edit-price">Price (CAD)</Label>
              <Input id="edit-price" required type="number" step="0.01" min="0.5" max="500" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="edit-prep">Prep time (min)</Label>
              <Input id="edit-prep" type="number" min={1} max={120} value={prepMinutes} onChange={(e) => setPrepMinutes(Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="edit-desc">Description</Label>
              <textarea
                id="edit-desc"
                rows={2}
                maxLength={600}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-[var(--r-sm)] border border-[var(--hair)] bg-[var(--card)] px-3 py-2 text-[13.5px] outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <Label htmlFor="edit-ingredients">Ingredients</Label>
              <textarea
                id="edit-ingredients"
                rows={2}
                maxLength={1000}
                value={ingredientsText}
                onChange={(e) => setIngredientsText(e.target.value)}
                className="w-full rounded-[var(--r-sm)] border border-[var(--hair)] bg-[var(--card)] px-3 py-2 text-[13.5px] outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <Label>Dietary tags</Label>
              <TagToggle value={dietaryTags} options={DIETARY_TAGS} onChange={setDietaryTags} tone="accent" />
              <p className="mt-1 text-[11px] text-[var(--ink3)]">Halal certified is platform-derived and can't be set here.</p>
            </div>
            <div>
              <Label>Allergens present</Label>
              <TagToggle value={allergenTags} options={ALLERGEN_TAGS} onChange={setAllergenTags} tone="warning" />
            </div>

            {item.variant_groups && item.variant_groups.length > 0 && (
              <div>
                <Label>Variants (read-only)</Label>
                <div className="space-y-2 rounded-[var(--r-sm)] border border-[var(--hair)] p-3">
                  {item.variant_groups.map((g) => (
                    <div key={g.id}>
                      <p className="text-[12px] font-bold text-[var(--ink2)]">
                        {g.name} {g.required && <Chip tone="neutral">Required</Chip>}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {g.variants.map((v) => (
                          <span key={v.id} className="rounded-[var(--r-pill)] bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] px-2 py-0.5 text-[11px] text-[var(--ink2)]">
                            {v.name}
                            {v.pricing_mode === 'DELTA' && v.delta_cents != null ? ` (+${(Number(v.delta_cents) / 100).toFixed(2)})` : ''}
                            {v.pricing_mode === 'ABSOLUTE' && v.price_cents != null ? ` (${(Number(v.price_cents) / 100).toFixed(2)})` : ''}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-[var(--ink3)]">
                  Variant editing isn't in the API contract yet — this app can only display what the backend already
                  has.
                </p>
              </div>
            )}

            <FieldError>{error}</FieldError>

            <Button className="w-full" loading={busy} onClick={submit} disabled={!name || !price}>
              Save changes
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
