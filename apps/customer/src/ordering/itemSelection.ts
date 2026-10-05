/**
 * The item sheet's choice model (C-15, C-16), kept apart from the UI so the rules that decide
 * whether Add is allowed, and what the add request carries, are plain functions.
 *
 * Two money rules hold here and nowhere else in the sheet:
 *  - **The request never carries a price.** `toCartLineInput` builds the contract's
 *    `CartLineInput`: ids, quantities and the special request. The server prices the line.
 *  - **The phone never adds money up.** The header shows the chosen ABSOLUTE variant's own
 *    `price_cents`, or the item's base price; a DELTA variant or an add-on shows its own
 *    signed amount beside the option. There is no base + delta + add-ons sum on the device —
 *    the binding line total arrives on the cart the server returns.
 */
import type { Schema } from '@hg/api-client';

export type MenuItem = Schema['MenuItem'];
export type CartLineInput = Schema['CartLineInput'];
type VariantGroup = Schema['VariantGroup'];
type AddonGroup = Schema['AddonGroup'];

export const MAX_QUANTITY = 20;
export const SPECIAL_REQUEST_MAX = 140;

export interface ItemSelection {
  /** Variant group id → chosen variant id (or null: nothing chosen yet). */
  variants: Record<string, string | null>;
  /** Add-on group id → chosen add-on ids, in tap order. */
  addons: Record<string, string[]>;
  quantity: number;
  specialRequest: string;
}

/**
 * A required group pre-selects only a variant the restaurant flagged default *and* that is
 * available. With no default, nothing is selected: silent auto-selection of the first option
 * is prohibited (C-16 rule 2).
 */
export function initialSelection(item: MenuItem): ItemSelection {
  const variants: Record<string, string | null> = {};
  for (const g of item.variant_groups ?? []) {
    const d = g.variants.find((v) => v.is_default && v.is_available);
    variants[g.id] = d ? d.id : null;
  }
  const addons: Record<string, string[]> = {};
  for (const g of item.addon_groups ?? []) addons[g.id] = [];
  return { variants, addons, quantity: 1, specialRequest: '' };
}

export function chooseVariant(sel: ItemSelection, groupId: string, variantId: string): ItemSelection {
  return { ...sel, variants: { ...sel.variants, [groupId]: variantId } };
}

/** Ticking past `max_select` is refused here as well as disabled in the UI. */
export function toggleAddon(sel: ItemSelection, group: AddonGroup, addonId: string): ItemSelection {
  const current = sel.addons[group.id] ?? [];
  if (current.includes(addonId)) {
    return { ...sel, addons: { ...sel.addons, [group.id]: current.filter((a) => a !== addonId) } };
  }
  if (current.length >= group.max_select) return sel;
  return { ...sel, addons: { ...sel.addons, [group.id]: [...current, addonId] } };
}

export function setQuantity(sel: ItemSelection, quantity: number): ItemSelection {
  return { ...sel, quantity: Math.max(1, Math.min(MAX_QUANTITY, Math.trunc(quantity))) };
}

/** The header price: the chosen ABSOLUTE variant's own price, else the item's base price. */
export function headerPriceCents(item: MenuItem, sel: ItemSelection): number {
  for (const g of item.variant_groups ?? []) {
    const v = g.variants.find((x) => x.id === sel.variants[g.id]);
    if (v && v.pricing_mode === 'ABSOLUTE' && v.price_cents != null) return v.price_cents;
  }
  return item.price_cents;
}

/** "Choose a size" from a group named "Size"; "Choose a platter size" from "Platter size". */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

/**
 * Why Add is disabled, as the sentence the footer shows — or null when the line can be sent.
 * Checked in the order the customer meets the controls, so the reason names the first gap.
 */
export function blockReason(item: MenuItem, sel: ItemSelection): string | null {
  if (item.availability_state !== 'AVAILABLE') {
    return `${item.name} is out of stock.`;
  }
  const groups = item.variant_groups ?? [];
  // The contract's CartLineInput carries one `variant_id`, so a dish with two or more variant
  // groups cannot send all of its choices. Sending only one would drop the rest without the
  // customer knowing; refusing is the honest option until the contract changes.
  if (groups.length > 1) {
    return "This dish has more choices than the app can send yet. Ask the restaurant, or choose another dish.";
  }
  for (const g of groups) {
    if (g.required && !sel.variants[g.id]) {
      const name = g.name.toLowerCase();
      return `Choose ${article(name)} ${name} to add this to your cart`;
    }
  }
  for (const g of item.addon_groups ?? []) {
    const n = (sel.addons[g.id] ?? []).length;
    if (n < g.min_select) {
      return `Choose at least ${g.min_select} from ${g.name.toLowerCase()} to add this to your cart`;
    }
  }
  if (sel.specialRequest.trim().length > SPECIAL_REQUEST_MAX) {
    return `Keep the special request to ${SPECIAL_REQUEST_MAX} characters`;
  }
  return null;
}

/** The add request. Identifiers, quantities and the note — the DTO has no price field (G-3). */
export function toCartLineInput(item: MenuItem, sel: ItemSelection): CartLineInput {
  const groups: VariantGroup[] = item.variant_groups ?? [];
  const variantId = groups.length === 1 ? (sel.variants[groups[0]!.id] ?? null) : null;
  const addons = (item.addon_groups ?? []).flatMap((g) =>
    (sel.addons[g.id] ?? []).map((addon_id) => ({ addon_id, quantity: 1 })),
  );
  const note = sel.specialRequest.trim();
  return {
    menu_item_id: item.id,
    quantity: sel.quantity,
    ...(variantId ? { variant_id: variantId } : {}),
    ...(addons.length ? { addons } : {}),
    ...(note ? { special_request: note } : {}),
  };
}

/** "Extras · choose up to 2", "Sauce (required) · choose 1 or 2", "Extras · 2 of 2 chosen". */
export function addonLegend(group: AddonGroup, chosen: number): string {
  const name = group.min_select > 0 ? `${group.name} (required)` : group.name;
  if (group.min_select === 0 && chosen >= group.max_select && group.max_select > 1) {
    return `${name} · ${chosen} of ${group.max_select} chosen`;
  }
  if (group.min_select > 0) {
    return group.min_select === group.max_select
      ? `${name} · choose ${group.min_select}`
      : `${name} · choose ${group.min_select} to ${group.max_select}`;
  }
  return group.max_select === 1 ? `${name} · choose 1` : `${name} · choose up to ${group.max_select}`;
}

/** "Mixed grill · For two · Garlic toum" from the line the server returned. */
export function lineSummary(line: Schema['CartLine']): string {
  return [line.name, line.variant?.name, ...(line.addons ?? []).map((a) => a.name)]
    .filter(Boolean)
    .join(' · ');
}
