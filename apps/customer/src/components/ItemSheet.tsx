/**
 * The item sheet (C-15, C-16): the approved Item-* boards of the "Discover & Order" canvas.
 *
 * A bottom `Sheet` with the dish's photo (when it has one), its price, description and
 * allergens, the variant and add-on choices, quantity and a special request, and a sticky
 * footer that either adds to the cart or says — in a sentence — why it cannot.
 *
 * Every refusal from `addCartLine` leaves the cart unchanged and is explained in place:
 *  - `409 DIFFERENT_RESTAURANT` asks "Start a new cart?"; confirming sends the same line with
 *    `replace=true`, one atomic call. If that fails, the old cart is intact and the footer
 *    retries the same call with the same Idempotency-Key ("Item — new cart failed").
 *  - closed, unavailable, sold-out choices and validation each get their own inline alert.
 *
 * The request carries ids and quantities only (`toCartLineInput`); the price the customer
 * sees comes from the menu's own cents fields and is never summed on the phone.
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { cents, idempotencyKey } from '@hg/api-client';
import type { Schema } from '@hg/api-client';
import {
  Badge,
  Button,
  Checkbox,
  Icon,
  Input,
  Modal,
  Price,
  QuantityStepper,
  Radio,
  RadioGroup,
  Sheet,
  useTheme,
  useTypeStyle,
} from '@hg/ui-native';
import type { IconName, Restaurant } from '@hg/ui-native';

import { addCartLine, getCart, type Cart } from '../api/cart';
import { classifyAddError, failureCopy, type AddFailure } from '../ordering/addErrors';
import {
  MAX_QUANTITY,
  SPECIAL_REQUEST_MAX,
  addonLegend,
  blockReason,
  chooseVariant,
  headerPriceCents,
  initialSelection,
  setQuantity,
  toCartLineInput,
  toggleAddon,
  type ItemSelection,
  type MenuItem,
} from '../ordering/itemSelection';
import { InlineAlert } from './InlineAlert';
import { MediaFrame } from './MediaFrame';
import { opensPhrase } from './discover/format';

type InlineFailure = Exclude<AddFailure, { kind: 'differentRestaurant' }>;

export interface ItemSheetProps {
  item: MenuItem;
  restaurant: { name: string; availability: Restaurant['availability'] };
  onClose: () => void;
  /** The server's recomputed cart, and the line that was just added. */
  onAdded: (cart: Cart, line: Schema['CartLine'] | null) => void;
  onAddAddress: () => void;
  onChangeAddress: () => void;
  onFindOpen: () => void;
}

const ALLERGEN: Readonly<Record<string, string>> = {
  PEANUTS: 'Peanuts',
  TREE_NUTS: 'Tree nuts',
  SESAME: 'Sesame',
  MILK: 'Milk',
  EGGS: 'Eggs',
  FISH: 'Fish',
  CRUSTACEANS_MOLLUSCS: 'Crustaceans and molluscs',
  SOY: 'Soy',
  WHEAT_TRITICALE: 'Wheat',
  SULPHITES: 'Sulphites',
  MUSTARD: 'Mustard',
};

function tagLabel(tag: string): string {
  const words = tag.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** HALAL_CERTIFIED is never a dietary badge: halal is shown only by the restaurant's seal. */
export function dietaryBadges(tags: readonly string[] | undefined): string[] {
  return (tags ?? []).filter((t) => t !== 'HALAL_CERTIFIED').map(tagLabel);
}

/** Finds the line the server added or incremented, to name it in the confirmation. */
function addedLine(cart: Cart, item: MenuItem, sel: ItemSelection): Schema['CartLine'] | null {
  const variantId = Object.values(sel.variants)[0] ?? null;
  const lines = cart.lines.filter((l) => l.menu_item_id === item.id);
  return lines.find((l) => (l.variant?.variant_id ?? null) === variantId) ?? lines[lines.length - 1] ?? null;
}

export function ItemSheet({
  item,
  restaurant,
  onClose,
  onAdded,
  onAddAddress,
  onChangeAddress,
  onFindOpen,
}: ItemSheetProps): React.ReactElement {
  const theme = useTheme();
  const body = useTypeStyle('body.md');
  const bodySm = useTypeStyle('body.sm');
  const label = useTypeStyle('label.lg');

  const [sel, setSel] = React.useState<ItemSelection>(() => initialSelection(item));
  const [adding, setAdding] = React.useState(false);
  const [failure, setFailure] = React.useState<InlineFailure | null>(null);
  const [decision, setDecision] = React.useState<{ name: string | null; count: number | null } | null>(
    null,
  );
  /** Set once "Start a new cart" was chosen: retries reuse this key (same intent). */
  const [replaceKey, setReplaceKey] = React.useState<string | null>(null);
  const [replaceFailed, setReplaceFailed] = React.useState(false);
  /** The cart the customer chose to replace, to name it if the replace fails. */
  const [oldCart, setOldCart] = React.useState<{ name: string | null; count: number | null } | null>(
    null,
  );
  const [soldOutVariants, setSoldOutVariants] = React.useState<ReadonlySet<string>>(new Set());
  const [closedNow, setClosedNow] = React.useState(false);

  const groups = item.variant_groups ?? [];
  const addonGroups = item.addon_groups ?? [];
  // After a refusal that no choice can fix, Add stays off and the alert above says why.
  const reason =
    failure?.kind === 'itemUnavailable'
      ? `${item.name} isn't available right now.`
      : failure?.kind === 'restaurantUnavailable'
        ? `${restaurant.name} can't take orders right now.`
        : blockReason(item, sel);
  const allergens = item.allergen_tags ?? [];
  const diet = dietaryBadges(item.dietary_tags);

  async function submit(replace: boolean): Promise<void> {
    if (adding || reason) return;
    setAdding(true);
    setFailure(null);
    try {
      const cart = await addCartLine(toCartLineInput(item, sel), {
        replace,
        idempotencyKey: replace ? (replaceKey ?? undefined) : undefined,
      });
      onAdded(cart, addedLine(cart, item, sel));
    } catch (e) {
      const f = classifyAddError(e);
      if (f.kind === 'differentRestaurant') {
        let { restaurantName: name, lineCount: count } = f;
        if (!name || count === null) {
          // The details are documented but optional on the wire; the cart itself knows both.
          try {
            const cart = await getCart();
            name = name ?? cart.restaurant?.name ?? null;
            count = count ?? cart.item_count ?? cart.lines.length;
          } catch {
            /* the dialog still works without them */
          }
        }
        setDecision({ name, count });
      } else {
        if (replace) setReplaceFailed(true);
        if (f.kind === 'restaurantClosed') setClosedNow(true);
        if (f.kind === 'variantUnavailable') {
          const chosen = f.variantId ?? Object.values(sel.variants).find(Boolean) ?? null;
          if (chosen) {
            setSoldOutVariants((s) => new Set([...s, chosen]));
            setSel((s) => ({
              ...s,
              variants: Object.fromEntries(
                Object.entries(s.variants).map(([g, v]) => [g, v === chosen ? null : v]),
              ),
            }));
          }
        }
        setFailure(f);
      }
    } finally {
      setAdding(false);
    }
  }

  function startNewCart(): void {
    setOldCart(decision);
    setDecision(null);
    setReplaceKey(idempotencyKey());
  }

  // Fire the replace once the key for it exists, so a retry can reuse exactly that key.
  React.useEffect(() => {
    if (replaceKey && !replaceFailed) void submit(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaceKey]);

  const failureText = failure
    ? failureCopy(failure, {
        itemName: item.name,
        restaurantName: restaurant.name,
        variantName:
          failure.kind === 'variantUnavailable'
            ? (groups.flatMap((g) => g.variants).find((v) => soldOutVariants.has(v.id))?.name ?? null)
            : null,
        addonName:
          failure.kind === 'addonUnavailable' && failure.addonId
            ? (addonGroups.flatMap((g) => g.addons).find((a) => a.id === failure.addonId)?.name ?? null)
            : null,
      })
    : null;

  const footer = (
    <Footer
      item={item}
      restaurant={restaurant}
      closedNow={closedNow}
      reason={reason}
      adding={adding}
      quantity={sel.quantity}
      replaceFailed={replaceFailed}
      onAdd={() => void submit(replaceFailed)}
      onAddAddress={onAddAddress}
      onChangeAddress={onChangeAddress}
      onFindOpen={onFindOpen}
    />
  );

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        title={item.name}
        snapPoints={[0.92]}
        footer={footer}
        testID="ItemSheet"
      >
        {failureText ? (
          <InlineAlert
            testID="ItemSheet-alert"
            icon={failureText.icon}
            title={
              replaceFailed && failure?.kind === 'other'
                ? "We couldn't start a new cart"
                : failureText.title
            }
            body={
              replaceFailed && failure?.kind === 'other'
                ? replaceFailedCopy(oldCart)
                : failureText.body
            }
          />
        ) : null}

        {item.image_url ? (
          <MediaFrame uri={item.image_url} aspectRatio={16 / 9} radius={16} caption />
        ) : null}

        <View style={styles.stack}>
          <Price cents={cents(headerPriceCents(item, sel))} size="lg" testID="ItemSheet-price" />
          {item.availability_state !== 'AVAILABLE' || diet.length ? (
            <View style={styles.wrap}>
              {item.availability_state !== 'AVAILABLE' ? (
                <Badge
                  variant="neutral"
                  size="md"
                  label={outOfStockLabel(item)}
                  icon={<Icon name="clock" size={14} color={theme.color.text.secondary} />}
                />
              ) : null}
              {diet.map((d) => (
                <Badge key={d} variant="outline" size="md" label={d} />
              ))}
            </View>
          ) : null}
          {item.description || item.prep_minutes ? (
            <Text style={[body, { color: theme.color.text.secondary }]}>
              {[
                item.description,
                item.prep_minutes ? `Usually ready in about ${item.prep_minutes} minutes.` : null,
              ]
                .filter(Boolean)
                .join(' ')}
            </Text>
          ) : null}
          {item.ingredients_text ? (
            <Text style={[bodySm, { color: theme.color.text.secondary }]}>
              {`Ingredients: ${item.ingredients_text}`}
            </Text>
          ) : null}
        </View>

        <View style={styles.stack}>
          <Text style={[label, { color: theme.color.text.primary }]}>Allergens</Text>
          {allergens.length ? (
            <View style={styles.wrap} accessibilityLabel={`Contains ${allergens.map((a) => ALLERGEN[a] ?? tagLabel(a)).join(', ')}`}>
              {allergens.map((a) => (
                <Badge key={a} variant="warning" size="md" label={ALLERGEN[a] ?? tagLabel(a)} />
              ))}
            </View>
          ) : (
            // An empty list is "not provided", never "no allergens" (C-15 rule 4).
            <Text style={[body, { color: theme.color.text.secondary }]}>
              Allergen information not provided by this restaurant. If you have an allergy, contact
              them before you order.
            </Text>
          )}
        </View>

        {groups.map((g) => (
          <RadioGroup
            key={g.id}
            name={g.id}
            label={g.required ? `${g.name} (required)` : g.name}
            value={sel.variants[g.id] ?? null}
            onChange={(v) => setSel((s) => chooseVariant(s, g.id, v))}
            testID={`ItemSheet-variants-${g.id}`}
          >
            {g.variants.map((v) => {
              const out = !v.is_available || soldOutVariants.has(v.id);
              return (
                <Radio
                  key={v.id}
                  value={v.id}
                  label={v.name}
                  priceCents={v.pricing_mode === 'ABSOLUTE' && v.price_cents != null ? v.price_cents : undefined}
                  priceDeltaCents={
                    v.pricing_mode === 'DELTA' && v.delta_cents ? v.delta_cents : undefined
                  }
                  disabled={out}
                  disabledReason={out ? 'Sold out' : undefined}
                  testID={`ItemSheet-variant-${v.id}`}
                />
              );
            })}
          </RadioGroup>
        ))}

        {addonGroups.map((g) => {
          const chosen = sel.addons[g.id] ?? [];
          const full = chosen.length >= g.max_select;
          return (
            <View key={g.id} accessibilityRole="list" accessibilityLabel={g.name} style={styles.group}>
              <Text style={[label, { color: theme.color.text.primary }]}>{addonLegend(g, chosen.length)}</Text>
              {g.min_select > 0 ? (
                <Text style={[bodySm, { color: theme.color.text.secondary }]}>
                  {`Choose at least ${g.min_select}.`}
                </Text>
              ) : null}
              {g.addons.map((a) => {
                const checked = chosen.includes(a.id);
                const outOfStock = !a.is_available;
                const capped = !checked && full;
                const ranOut =
                  failure?.kind === 'addonUnavailable' && failure.addonId === a.id && checked;
                return (
                  <Checkbox
                    key={a.id}
                    label={a.name}
                    checked={checked}
                    onChange={() => setSel((s) => toggleAddon(s, g, a.id))}
                    priceDeltaCents={a.price_cents > 0 ? a.price_cents : undefined}
                    disabled={outOfStock || capped}
                    disabledReason={
                      outOfStock
                        ? 'Out of stock'
                        : capped
                          ? `Up to ${g.max_select} — untick one to swap`
                          : undefined
                    }
                    error={ranOut}
                    testID={`ItemSheet-addon-${a.id}`}
                  />
                );
              })}
            </View>
          );
        })}

        <View style={[styles.quantity, { borderTopColor: theme.color.border.decorative }]}>
          <View style={styles.quantityRow}>
            <Text style={[label, { color: theme.color.text.primary }]}>Quantity</Text>
            <QuantityStepper
              value={sel.quantity}
              min={1}
              max={MAX_QUANTITY}
              onChange={(q) => setSel((s) => setQuantity(s, q))}
              size="md"
              itemName={item.name}
              maxReason={`Maximum ${MAX_QUANTITY}`}
              testID="ItemSheet-quantity"
            />
          </View>
          {sel.quantity >= MAX_QUANTITY ? (
            <Text style={[bodySm, styles.end, { color: theme.color.text.secondary }]}>
              {`Maximum ${MAX_QUANTITY}`}
            </Text>
          ) : null}
        </View>

        <Input
          label="Special request (optional)"
          value={sel.specialRequest}
          onChange={(t) => setSel((s) => ({ ...s, specialRequest: t }))}
          placeholder="For example: no onions"
          helperText="The kitchen sees this. For allergies, contact the restaurant before you order."
          maxLength={SPECIAL_REQUEST_MAX}
          characterCount
          testID="ItemSheet-special"
        />
      </Sheet>

      <Modal
        open={decision !== null}
        onClose={() => setDecision(null)}
        variant="confirm"
        destructive
        title="Start a new cart?"
        description={differentRestaurantCopy(decision)}
        actions={[
          { label: 'Keep my cart', onPress: () => setDecision(null), testID: 'ItemSheet-keepCart' },
          {
            label: 'Start a new cart',
            onPress: startNewCart,
            destructive: true,
            testID: 'ItemSheet-startNewCart',
          },
        ]}
        testID="ItemSheet-differentRestaurant"
      />
    </>
  );
}

/** "Your cart has 2 items from Karahi House. A cart holds one restaurant at a time, …" */
export function differentRestaurantCopy(d: { name: string | null; count: number | null } | null): string {
  const what =
    d?.count != null ? `${d.count} ${d.count === 1 ? 'item' : 'items'}` : 'items';
  const from = d?.name ? ` from ${d.name}` : ' from another restaurant';
  return `Your cart has ${what}${from}. A cart holds one restaurant at a time, so starting a new cart removes them.`;
}

/** "Your Karahi House cart is unchanged (2 items). Try again, or keep that cart." */
function replaceFailedCopy(old: { name: string | null; count: number | null } | null): string {
  const which = old?.name ? `${old.name} cart` : 'cart';
  const count = old?.count != null ? ` (${old.count} ${old.count === 1 ? 'item' : 'items'})` : '';
  return `Your ${which} is unchanged${count}. Try again, or keep that cart.`;
}

function outOfStockLabel(item: MenuItem): string {
  if (!item.out_of_stock_until) return 'Out of stock';
  const d = new Date(item.out_of_stock_until);
  if (Number.isNaN(d.getTime())) return 'Out of stock';
  const h = d.getHours();
  const time = `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
  return `Out of stock · back at ${time}`;
}

function Footer({
  item,
  restaurant,
  closedNow,
  reason,
  adding,
  quantity,
  replaceFailed,
  onAdd,
  onAddAddress,
  onChangeAddress,
  onFindOpen,
}: {
  item: MenuItem;
  restaurant: ItemSheetProps['restaurant'];
  closedNow: boolean;
  reason: string | null;
  adding: boolean;
  quantity: number;
  replaceFailed: boolean;
  onAdd: () => void;
  onAddAddress: () => void;
  onChangeAddress: () => void;
  onFindOpen: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const body = useTypeStyle('body.md');
  const a = restaurant.availability;

  // The restaurant's own verdict comes first: the dead-end Add is replaced by the way forward.
  let gate: { text: string; action?: { label: string; icon: IconName; onPress: () => void } } | null =
    null;
  if (closedNow) {
    gate = {
      text: `${restaurant.name} is closed.`,
      action: { label: 'Find an open restaurant', icon: 'search', onPress: onFindOpen },
    };
  } else if (a.state === 'NO_ADDRESS') {
    gate = {
      text: `Add a delivery address to order from ${restaurant.name}.`,
      action: { label: 'Add an address', icon: 'plus', onPress: onAddAddress },
    };
  } else if (a.state === 'CLOSED_HOURS') {
    const opens = opensPhrase(a.opens_at);
    gate = {
      text: `${restaurant.name} is closed.${opens ? ` It ${opens}.` : ''}`,
      action: { label: 'Find an open restaurant', icon: 'search', onPress: onFindOpen },
    };
  } else if (a.state === 'PAUSED') {
    gate = { text: `${restaurant.name} has paused new orders. Check back later.` };
  } else if (a.state === 'OUT_OF_RANGE') {
    gate = {
      text: `${restaurant.name} doesn't deliver to your address. Change your address to order.`,
      action: { label: 'Change address', icon: 'map', onPress: onChangeAddress },
    };
  } else if (a.state !== 'OPEN') {
    gate = { text: `${restaurant.name} can't take orders right now.` };
  }

  const text = gate?.text ?? reason;
  const label = replaceFailed
    ? 'Start a new cart and add'
    : quantity > 1
      ? `Add ${quantity} to cart`
      : 'Add to cart';

  return (
    <View style={styles.footer}>
      {text ? (
        <Text testID="ItemSheet-reason" style={[body, { color: theme.color.text.primary }]}>
          {text}
        </Text>
      ) : null}
      {gate?.action ? (
        <Button
          variant="primary"
          size="lg"
          fullWidth
          onPress={gate.action.onPress}
          iconStart={<Icon name={gate.action.icon} size={20} color={theme.color.text.onBrand} />}
          testID="ItemSheet-gateAction"
        >
          {gate.action.label}
        </Button>
      ) : (
        <Button
          variant="primary"
          size="lg"
          fullWidth
          onPress={onAdd}
          loading={adding}
          disabled={Boolean(gate) || Boolean(reason)}
          iconStart={<Icon name="cart" size={20} color={theme.color.text.onBrand} />}
          accessibilityHint={text ?? undefined}
          accessibilityLabel={`${label}: ${item.name}`}
          testID="ItemSheet-add"
        >
          {label}
        </Button>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  group: { gap: 4 },
  quantity: { gap: 4, paddingTop: 12, borderTopWidth: 1 },
  quantityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  end: { alignSelf: 'flex-end' },
  footer: { gap: 8 },
});
