/**
 * The add request for a dish with variant groups (C-16, #628): one chosen variant per required
 * group, sent as `variant_ids`; a required group with no default starts empty and blocks Add
 * (never the first option silently); a dish with no required choice adds at once, as before.
 */
import manyChoices from '../../../../../contracts/fixtures/catalogue/menu_item_many_variants_and_addons.json';
import {
  chooseVariant,
  initialChoice,
  missingChoice,
  needsChoice,
  toCartLineInput,
  type MenuItem,
} from '../lineChoice';

const platter = manyChoices.payload as unknown as MenuItem;

const plain: MenuItem = { ...platter, variant_groups: [], addon_groups: [] };

test('a dish with no required choice adds at once with the item id and a quantity alone', () => {
  expect(needsChoice(plain)).toBe(false);
  expect(toCartLineInput(plain, initialChoice(plain))).toEqual({ menu_item_id: plain.id, quantity: 1 });
});

test('a required group with no default starts empty and blocks Add, never the first option', () => {
  const group = platter.variant_groups![0]!;
  const noDefault: MenuItem = {
    ...platter,
    addon_groups: [],
    variant_groups: [{ ...group, variants: group.variants.map((v) => ({ ...v, is_default: false })) }],
  };
  const choice = initialChoice(noDefault);
  expect(needsChoice(noDefault)).toBe(true);
  expect(choice.variants[group.id]).toBeNull();
  expect(missingChoice(noDefault, choice)).toBe(`Choose a ${group.name.toLowerCase()}`);
  expect(toCartLineInput(noDefault, choice)).not.toHaveProperty('variant_ids');

  const chosen = chooseVariant(choice, group.id, group.variants[1]!.id);
  expect(missingChoice(noDefault, chosen)).toBeNull();
  expect(toCartLineInput(noDefault, chosen)).toEqual({
    menu_item_id: noDefault.id,
    quantity: 1,
    variant_ids: [group.variants[1]!.id],
  });
});

test('one variant per required group, in the menu’s group order, and no price field', () => {
  const sauces = platter.addon_groups!.find((g) => g.min_select > 0)!;
  const choice = { ...initialChoice(platter), addons: { [sauces.id]: [sauces.addons[0]!.id] } };
  const line = toCartLineInput(platter, choice);
  expect(line.variant_ids).toEqual(
    platter.variant_groups!.map((g) => g.variants.find((v) => v.is_default)!.id),
  );
  expect(line).not.toHaveProperty('variant_id');
  expect(JSON.stringify(line)).not.toMatch(/price|cents|total/i);
});
