/**
 * The item sheet's choice model (manifest D9; ported from #634/#649 `ordering/itemSelection.ts`),
 * kept apart from the UI so the rules that decide whether Add is allowed, and what the add request
 * carries, are plain functions.
 *
 * Two money rules hold here and nowhere else in the sheet (AGENTS.md invariants 1 and 3):
 *  - **The request never carries a price.** `toCartLineInput` builds the contract's
 *    `CartLineInput`: ids, quantities and the special request. The server prices the line.
 *  - **The phone never adds money up.** The header shows the chosen ABSOLUTE variant's own
 *    `price_cents`, or the item's base price ("From" when a DELTA choice can change it); a DELTA
 *    variant or an add-on shows its own signed amount beside the option. There is no base + delta
 *    + add-ons sum on the device: the line total arrives on the cart the server returns (G13).
 */
import type { Schema } from '@hg/api-client';

export type MenuItem = Schema['MenuItem'];
export type CartLineInput = Schema['CartLineInput'];
export type CartLine = Schema['CartLine'];
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
 * A group pre-selects only a variant the restaurant flagged default *and* that is available.
 * With no default, nothing is selected: silent auto-selection of the first option is prohibited
 * (C-16 rule 2). Add-ons are never pre-selected.
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

/**
 * The selection a cart line already holds, for the edit-line sheet (`CC/Cart-edit-line`): its
 * variants by group, its add-ons, quantity and special request. Ids the menu no longer has are
 * dropped, so the sheet never sends a choice it cannot show.
 */
export function selectionFromLine(item: MenuItem, line: CartLine): ItemSelection {
  const base = initialSelection(item);
  const variants: Record<string, string | null> = {};
  for (const g of item.variant_groups ?? []) {
    const chosen = (line.variants ?? []).find((v) => v.variant_group_id === g.id || g.variants.some((x) => x.id === v.variant_id));
    variants[g.id] = chosen && g.variants.some((x) => x.id === chosen.variant_id) ? chosen.variant_id : null;
  }
  const addons: Record<string, string[]> = {};
  for (const g of item.addon_groups ?? []) {
    addons[g.id] = (line.addons ?? []).map((a) => a.addon_id).filter((id) => g.addons.some((x) => x.id === id));
  }
  return {
    ...base,
    variants,
    addons,
    quantity: Math.max(1, Math.min(MAX_QUANTITY, line.quantity)),
    specialRequest: line.special_request ?? '',
  };
}

export function chooseVariant(sel: ItemSelection, groupId: string, variantId: string): ItemSelection {
  return { ...sel, variants: { ...sel.variants, [groupId]: variantId } };
}

/** Clears a variant wherever it is chosen (it just sold out). */
export function clearVariant(sel: ItemSelection, variantId: string): ItemSelection {
  return {
    ...sel,
    variants: Object.fromEntries(Object.entries(sel.variants).map(([g, v]) => [g, v === variantId ? null : v])),
  };
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

export interface HeaderPrice {
  /** A server value, as given: the chosen ABSOLUTE variant's `price_cents` or the item's base. */
  cents: number;
  /** "From": a DELTA choice on this item can change the line price, so the base is a floor. */
  from: boolean;
}

/**
 * The header price (boards `DO/Item-ready`, `DO/Item-delta-variant`):
 *  - ABSOLUTE: the chosen variant's own `price_cents` replaces the base; before a choice, the base.
 *  - DELTA: "From" + the item's base `price_cents`, and it stays the same when a size is chosen.
 * Never base + delta on the phone.
 */
export function headerPrice(item: MenuItem, sel: ItemSelection): HeaderPrice {
  const groups = item.variant_groups ?? [];
  const from = groups.some((g) => g.variants.some((v) => v.pricing_mode === 'DELTA' && (v.delta_cents ?? 0) !== 0));
  for (const g of groups) {
    const v = g.variants.find((x) => x.id === sel.variants[g.id]);
    if (v && v.pricing_mode === 'ABSOLUTE' && v.price_cents != null) return { cents: v.price_cents, from };
  }
  return { cents: item.price_cents, from };
}

/** "Choose a size", "Choose an extra". */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

/**
 * Why Add is disabled, as the sentence the footer shows (boards `DO/Item-choose`,
 * `DO/Item-required-addon`, `DO/Item-out-of-stock`), or null when the line can be sent. Checked in
 * the order the customer meets the controls, so the reason names the first gap.
 */
export function blockReason(item: MenuItem, sel: ItemSelection, restockPhrase: string | null = null): string | null {
  if (item.availability_state !== 'AVAILABLE') {
    return restockPhrase ? `${item.name} is out of stock. It's back at ${restockPhrase}.` : `${item.name} is out of stock.`;
  }
  for (const g of item.variant_groups ?? []) {
    if (g.required && !sel.variants[g.id]) {
      const name = g.name.toLowerCase();
      return `Choose ${article(name)} ${name} to add this to your cart`;
    }
  }
  for (const g of item.addon_groups ?? []) {
    const n = (sel.addons[g.id] ?? []).length;
    if (n < g.min_select) {
      return `Choose at least ${g.min_select} ${g.name.toLowerCase()} to add this to your cart`;
    }
  }
  if (sel.specialRequest.trim().length > SPECIAL_REQUEST_MAX) {
    return `Keep the special request to ${SPECIAL_REQUEST_MAX} characters`;
  }
  return null;
}

/** Every chosen variant id, one per group, in the menu's group order. */
export function chosenVariantIds(item: MenuItem, sel: ItemSelection): string[] {
  const groups: VariantGroup[] = item.variant_groups ?? [];
  return groups.map((g) => sel.variants[g.id]).filter((v): v is string => Boolean(v));
}

/**
 * The add request: identifiers, quantities and the note. The DTO has no price field (G-3) and
 * none is ever added here. `variant_ids` carries one chosen variant per group (#644), so a dish
 * with a size *and* a rice choice sends both.
 */
export function toCartLineInput(item: MenuItem, sel: ItemSelection): CartLineInput {
  const variantIds = chosenVariantIds(item, sel);
  const addons = (item.addon_groups ?? []).flatMap((g) => (sel.addons[g.id] ?? []).map((addon_id) => ({ addon_id, quantity: 1 })));
  const note = sel.specialRequest.trim();
  return {
    menu_item_id: item.id,
    quantity: sel.quantity,
    ...(variantIds.length ? { variant_ids: variantIds } : {}),
    ...(addons.length ? { addons } : {}),
    ...(note ? { special_request: note } : {}),
  };
}

/**
 * The add request that puts a removed line back exactly (Undo, `CC/Cart-line-removed`): the same
 * variants, add-ons, quantity and special request, still ids only.
 */
export function lineToCartLineInput(line: CartLine): CartLineInput {
  const variantIds = (line.variants ?? []).map((v) => v.variant_id);
  const addons = (line.addons ?? []).map((a) => ({ addon_id: a.addon_id, quantity: a.quantity }));
  const note = line.special_request?.trim();
  return {
    menu_item_id: line.menu_item_id,
    quantity: line.quantity,
    ...(variantIds.length ? { variant_ids: variantIds } : {}),
    ...(addons.length ? { addons } : {}),
    ...(note ? { special_request: note } : {}),
  };
}

/** The line identity the server uses: item, sorted variants, sorted add-ons, special request. */
function identity(input: CartLineInput): string {
  const v = [...(input.variant_ids ?? [])].sort().join(',');
  const a = (input.addons ?? [])
    .map((x) => `${x.addon_id}x${x.quantity ?? 1}`)
    .sort()
    .join(',');
  return `${input.menu_item_id}|${v}|${a}|${input.special_request ?? ''}`;
}

/** Whether two add requests describe the same line (only the quantity may differ). */
export function sameLine(a: CartLineInput, b: CartLineInput): boolean {
  return identity(a) === identity(b);
}

/**
 * "Extras · choose up to 2", "Sauce (required) · choose 1 or 2", "Extras · 2 of 2 chosen"
 * (boards `DO/Item-ready`, `-required-addon`, `-max-error`).
 */
export function addonLegend(group: AddonGroup, chosen: number): string {
  const name = group.min_select > 0 ? `${group.name} (required)` : group.name;
  if (group.min_select === 0 && chosen >= group.max_select && group.max_select > 1) {
    return `${name} · ${chosen} of ${group.max_select} chosen`;
  }
  if (group.min_select > 0) {
    if (group.min_select === group.max_select) return `${name} · choose ${group.min_select}`;
    const join = group.max_select === group.min_select + 1 ? 'or' : 'to';
    return `${name} · choose ${group.min_select} ${join} ${group.max_select}`;
  }
  return group.max_select === 1 ? `${name} · choose 1` : `${name} · choose up to ${group.max_select}`;
}

/** "Size (required)" for a required variant group (board `DO/Item-ready`). */
export function variantLegend(group: VariantGroup): string {
  return group.required ? `${group.name} (required)` : group.name;
}

/**
 * "Mixed charcoal grill · For one · Extra garlic sauce", the "Added to your cart" toast built from
 * the line the server returned (board `DO/Item-added`).
 */
export function lineSummary(line: CartLine): string {
  return [line.name, ...(line.variants ?? []).map((v) => v.variant_name), ...(line.addons ?? []).map((a) => a.name)]
    .filter(Boolean)
    .join(' · ');
}

/** Finds the line the server added or incremented, to name it in the confirmation. */
export function addedLine(lines: readonly CartLine[], input: CartLineInput): CartLine | null {
  const matches = lines.filter((l) => l.menu_item_id === input.menu_item_id);
  return matches.find((l) => sameLine(lineToCartLineInput(l), input)) ?? matches[matches.length - 1] ?? null;
}
