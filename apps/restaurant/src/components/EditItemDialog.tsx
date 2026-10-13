import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { isApiError, type Schema } from '@hg/api-client';
import { Button, Chip, Icon, IconButton, Input, Textarea } from '@hg/ui-web';
import { api, unwrapOrThrow } from '../lib/apiHelpers';
import { menuLockFromError, type MenuLockState } from './MenuLockedNotice';

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

/**
 * Real filter chips (`02-components.md` §10 `variant="filter"`) rather than the app's old
 * hand-rolled toggle buttons — this is exactly the shape `@hg/ui-web`'s `Chip` primitive is
 * for. `warning` tone for allergens (matches its danger-adjacent meaning); dietary tags use
 * `neutral`, since there is no `accent` tone on this component (only `neutral | warning | veg
 * | nonveg` — see `Chip`'s own header on why solid-green tones are deliberately absent).
 */
function TagToggle<T extends string>({
  value,
  options,
  onChange,
  tone,
}: {
  value: T[];
  options: readonly T[];
  onChange: (next: T[]) => void;
  tone: 'neutral' | 'warning';
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = value.includes(opt);
        return (
          <Chip
            key={opt}
            variant="filter"
            tone={tone}
            size="sm"
            label={opt.replace(/_/g, ' ')}
            selected={active}
            onPress={() => onChange(active ? value.filter((v) => v !== opt) : [...value, opt])}
          />
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
  onLocked,
}: {
  item: EditableMenuItem;
  onClose: () => void;
  onSaved: () => void;
  /** A save refused with `403 MENU_LOCKED`: the page shows the locked-menu notice instead of an error. */
  onLocked: (state: MenuLockState) => void;
}) {
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState((Number(item.price_cents) / 100).toFixed(2));
  const [description, setDescription] = useState(item.description ?? '');
  const [ingredientsText, setIngredientsText] = useState(item.ingredients_text ?? '');
  const [prepMinutes, setPrepMinutes] = useState(String(item.prep_minutes ?? 20));
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
            prep_minutes: Number(prepMinutes) || undefined,
            dietary_tags: dietaryTags,
            allergen_tags: allergenTags,
            allergens_declared: true,
          },
        }),
      );
      onSaved();
    } catch (e) {
      const refused = menuLockFromError(e);
      if (refused) {
        onLocked(refused);
        return;
      }
      setError(isApiError(e) ? e.message : e instanceof Error ? e.message : 'Could not update this item.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-(--hg-z-modal) bg-surface-scrim" />
        <Dialog.Content className="fixed start-1/2 top-1/2 z-(--hg-z-modal) max-h-[88vh] w-[min(520px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-line-decorative bg-surface-raised p-6 shadow-e4">
          <div className="mb-1 flex items-start justify-between">
            <Dialog.Title className="text-heading-sm font-semibold text-fg-primary">Edit item</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton variant="plain" size="sm" accessibilityLabel="Close" icon={<Icon name="close" size={16} />} />
            </Dialog.Close>
          </div>
          <p className="mb-4 text-body-sm text-fg-secondary">
            Price and prep time apply instantly. Name, description, ingredients and tags queue for admin review before
            customers see them — see the pending badge on the menu list.
          </p>

          <div className="space-y-4">
            <Input label="Item name" required minLength={2} value={name} onChange={setName} />
            <Input label="Price (CAD)" required variant="numeric" value={price} onChange={setPrice} />
            <Input label="Prep time (min)" variant="numeric" value={prepMinutes} onChange={setPrepMinutes} />
            <Textarea label="Description" rows={2} maxLength={600} value={description} onChange={setDescription} />
            <Textarea label="Ingredients" rows={2} maxLength={1000} value={ingredientsText} onChange={setIngredientsText} />

            <div>
              <p className="mb-1.5 text-label-md text-fg-secondary">Dietary tags</p>
              <TagToggle value={dietaryTags} options={DIETARY_TAGS} onChange={setDietaryTags} tone="neutral" />
              <p className="mt-1 text-caption text-fg-tertiary">Halal certified is platform-derived and can't be set here.</p>
            </div>
            <div>
              <p className="mb-1.5 text-label-md text-fg-secondary">Allergens present</p>
              <TagToggle value={allergenTags} options={ALLERGEN_TAGS} onChange={setAllergenTags} tone="warning" />
            </div>

            {item.variant_groups && item.variant_groups.length > 0 && (
              <div>
                <p className="mb-1.5 text-label-md text-fg-secondary">Variants (read-only)</p>
                <div className="space-y-2 rounded-sm border border-line-decorative p-3">
                  {item.variant_groups.map((g) => (
                    <div key={g.id}>
                      <p className="flex items-center gap-1.5 text-label-sm font-bold text-fg-secondary">
                        {g.name} {g.required && <Chip variant="static" tone="neutral" size="sm" label="Required" />}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {g.variants.map((v) => (
                          <span key={v.id} className="rounded-full bg-surface-subtle px-2 py-0.5 text-label-sm text-fg-secondary">
                            {v.name}
                            {v.pricing_mode === 'DELTA' && v.delta_cents != null ? ` (+${(Number(v.delta_cents) / 100).toFixed(2)})` : ''}
                            {v.pricing_mode === 'ABSOLUTE' && v.price_cents != null ? ` (${(Number(v.price_cents) / 100).toFixed(2)})` : ''}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-1 text-caption text-fg-tertiary">
                  Variant editing isn't in the API contract yet — this app can only display what the backend already
                  has.
                </p>
              </div>
            )}

            {error ? (
              <p role="alert" className="text-body-sm text-feedback-danger-text">
                {error}
              </p>
            ) : null}

            <Button fullWidth loading={busy} onPress={() => void submit()} disabled={!name || !price}>
              Save changes
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
