/**
 * What the add-to-cart request carries for a dish, kept apart from the screen so the rules are
 * plain functions (C-15, C-16; #628, #629).
 *
 * A cart line carries one chosen variant per variant group (`variant_ids`), and the server checks
 * the line against the menu: a `required` variant group with no choice, or an add-on group below
 * its `min_select`, is refused `422 VALIDATION_FAILED`. So a dish that has such a group cannot be
 * added with the item id alone; the restaurant screen asks for those choices first, and only
 * those. Optional groups are left to the server's rules, as before: the line goes without them.
 *
 * The request never carries a price (G-3): ids and quantities only. The server prices the line.
 * The choice model follows #649's `ordering/itemSelection.ts`.
 */
import type { Schema } from '@hg/api-client';

export type MenuItem = Schema['MenuItem'];
export type CartLineInput = Schema['CartLineInput'];
type VariantGroup = Schema['VariantGroup'];
type AddonGroup = Schema['AddonGroup'];

export interface LineChoice {
  /** Required variant group id → chosen variant id, or null while nothing is chosen. */
  variants: Record<string, string | null>;
  /** Required add-on group id → chosen add-on ids, in tap order. */
  addons: Record<string, string[]>;
}

/** The variant groups the customer must choose from: every `required` one. */
export function requiredVariantGroups(item: MenuItem): VariantGroup[] {
  return (item.variant_groups ?? []).filter((g) => g.required);
}

/** The add-on groups the customer must choose from: every one with a `min_select` above zero. */
export function requiredAddonGroups(item: MenuItem): AddonGroup[] {
  return (item.addon_groups ?? []).filter((g) => g.min_select > 0);
}

/** Whether the dish needs a choice before it can be added. Without one, Add sends it at once. */
export function needsChoice(item: MenuItem): boolean {
  return requiredVariantGroups(item).length > 0 || requiredAddonGroups(item).length > 0;
}

/**
 * A required group starts on the variant the restaurant flagged default, when it is available.
 * With no default, nothing is chosen: silent auto-selection of the first option is prohibited
 * (C-16 rule 2).
 */
export function initialChoice(item: MenuItem): LineChoice {
  const variants: Record<string, string | null> = {};
  for (const g of requiredVariantGroups(item)) {
    const d = g.variants.find((v) => v.is_default && v.is_available);
    variants[g.id] = d ? d.id : null;
  }
  const addons: Record<string, string[]> = {};
  for (const g of requiredAddonGroups(item)) addons[g.id] = [];
  return { variants, addons };
}

export function chooseVariant(choice: LineChoice, groupId: string, variantId: string): LineChoice {
  return { ...choice, variants: { ...choice.variants, [groupId]: variantId } };
}

/** Ticking past `max_select` is refused here as well as disabled on screen. */
export function toggleAddon(choice: LineChoice, group: AddonGroup, addonId: string): LineChoice {
  const current = choice.addons[group.id] ?? [];
  if (current.includes(addonId)) {
    return { ...choice, addons: { ...choice.addons, [group.id]: current.filter((a) => a !== addonId) } };
  }
  if (current.length >= group.max_select) return choice;
  return { ...choice, addons: { ...choice.addons, [group.id]: [...current, addonId] } };
}

/** The first choice still missing, as the sentence the sheet shows; null when the line can go. */
export function missingChoice(item: MenuItem, choice: LineChoice): string | null {
  for (const g of requiredVariantGroups(item)) {
    if (!choice.variants[g.id]) return `Choose a ${g.name.toLowerCase()}`;
  }
  for (const g of requiredAddonGroups(item)) {
    if ((choice.addons[g.id] ?? []).length < g.min_select) {
      return `Choose at least ${g.min_select} from ${g.name.toLowerCase()}`;
    }
  }
  return null;
}

/**
 * The add request: the item, a quantity, one chosen variant per required group in the menu's
 * group order (`variant_ids`, never the deprecated `variant_id`) and the chosen add-ons. No price.
 */
export function toCartLineInput(item: MenuItem, choice: LineChoice, quantity = 1): CartLineInput {
  const variantIds = requiredVariantGroups(item)
    .map((g) => choice.variants[g.id])
    .filter((v): v is string => Boolean(v));
  const addons = requiredAddonGroups(item).flatMap((g) =>
    (choice.addons[g.id] ?? []).map((addon_id) => ({ addon_id, quantity: 1 })),
  );
  return {
    menu_item_id: item.id,
    quantity,
    ...(variantIds.length ? { variant_ids: variantIds } : {}),
    ...(addons.length ? { addons } : {}),
  };
}
