/**
 * D9 Item sheet, and the cart's edit-line sheet (manifest §2 D9; boards `DO/Item-*`,
 * `CC/Cart-edit-line`). A screen-level sheet owned by the restaurant page and the cart, composed
 * from design-system exports only; the inline alert, image frame and character counter below are
 * design-system gaps (manifest §4: InlineAlert, MediaFrame, Textarea) composed here, not exported.
 *
 * Reads: the dish comes from the menu the restaurant page already holds, or (edit line, deep link)
 * from `getRestaurantMenu` (there is no customer single-item read), with its loading, error and
 * "gone" states.
 *
 * Writes: `addCartLine` with ids, quantities and the special request only (`toCartLineInput`);
 * never a price. One Idempotency-Key per add attempt, reused when the same attempt is retried and
 * for "Start a new cart" (`replace=true`) after `409 DIFFERENT_RESTAURANT`. Edit line is
 * remove + add today (API gap G5): the new line is added first and the old one removed only after.
 *
 * Money: the header is the chosen ABSOLUTE variant's `price_cents` or the base ("From" when a DELTA
 * choice can change it); options show their own amounts. No line price before Add (G13).
 */
import * as React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { cents, idempotencyKey } from '@hg/api-client';

import {
  Badge,
  Button,
  Card,
  Checkbox,
  ErrorState,
  Icon,
  Input,
  Modal,
  Price,
  QuantityStepper,
  Radio,
  RadioGroup,
  Sheet,
  Skeleton,
  formatPrice,
  useTheme,
  useTypeStyle,
} from '../ds';
import { useConnectivity } from '../lib/connectivity';
import { useNow } from '../lib/now';
import { useQuery } from '../lib/query';
import { formatTime } from '../lib/time';
import {
  dietaryBadges,
  loadMenu,
  opensPhrase,
  outOfStockLine,
  type Availability,
  type Menu,
  type MenuItem,
} from '../restaurant/restaurant';
import {
  classifyAddError,
  differentRestaurantCopy,
  failureCopy,
  replaceFailedCopy,
  type AddFailure,
  type AlertIcon,
} from './addErrors';
import { addCartLine, getCart, removeLine, setLineQuantity, type Cart, type CartLine } from './cart';
import {
  MAX_QUANTITY,
  SPECIAL_REQUEST_MAX,
  addedLine,
  addonLegend,
  blockReason,
  chooseVariant,
  clearVariant,
  headerPrice,
  initialSelection,
  lineToCartLineInput,
  sameLine,
  selectionFromLine,
  setQuantity,
  toCartLineInput,
  toggleAddon,
  variantLegend,
  type ItemSelection,
} from './itemSelection';

export const ADDED_TOAST = 'Added to your cart';
export const GONE_TITLE = "This dish isn't on the menu any more";
export const OFFLINE_REASON = "You're offline. You can add this when you're back online.";

type InlineFailure = Exclude<AddFailure, { kind: 'differentRestaurant' } | { kind: 'gone' }>;

export interface ItemSheetProps {
  restaurantId: string;
  restaurantName: string;
  /** The restaurant's verdict against the selected address; null when not known (edit from cart). */
  availability: Availability | null;
  /** "Home": the selected address's name, for "doesn't deliver to Home". */
  addressName: string | null;
  /** The dish from the menu already on screen; otherwise it is read by id. */
  item?: MenuItem;
  menuItemId?: string;
  /** Edit an existing cart line (`CC/Cart-edit-line`). */
  editLine?: CartLine;
  onClose: () => void;
  /** The server's recomputed cart, and the line that was just added (null when not found). */
  onAdded: (cart: Cart, line: CartLine | null) => void;
  onAddAddress: () => void;
  onChangeAddress: () => void;
  onFindOpen: () => void;
}

/** Every listed dish in a menu, by id. HIDDEN and BLOCKED dishes are not listed: they are "gone". */
function findItem(menu: Menu, id: string): MenuItem | null {
  for (const c of menu.categories ?? []) {
    if (c.is_active === false) continue;
    const hit = (c.items ?? []).find((i) => i.id === id);
    if (hit) return hit.availability_state === 'AVAILABLE' || hit.availability_state === 'OUT_OF_STOCK' ? hit : null;
  }
  return null;
}

export function ItemSheet(props: ItemSheetProps): React.ReactElement {
  const { item, menuItemId, restaurantId, restaurantName, editLine, onClose } = props;
  const id = item?.id ?? menuItemId ?? editLine?.menu_item_id ?? '';
  // The dish the page already holds is shown at once; only a dish opened by id is read.
  const { query: read, reload } = useQuery<MenuItem | null>(async () => findItem(await loadMenu(restaurantId), id), [restaurantId, id], {
    enabled: !item,
  });
  const query: typeof read = item ? { kind: 'ready', data: item, asOf: 0, refreshing: false } : read;
  const [gone, setGone] = React.useState(false);
  const theme = useTheme();
  const title = editLine ? `Edit ${editLine.name}` : (item?.name ?? '');

  if (gone || (query.kind === 'ready' && query.data === null)) {
    return (
      <Sheet open onClose={onClose} title="Dish not available" snapPoints={[0.7]} testID="ItemSheet-gone">
        <View style={styles.centre}>
          <Icon name="info" size={48} color={theme.color.text.secondary} />
          <SheetMessage title={GONE_TITLE} body={`${restaurantName} has removed it. Your cart is unchanged.`} />
          <Button variant="primary" size="lg" fullWidth onPress={onClose} testID="ItemSheet-backToMenu">
            Back to the menu
          </Button>
        </View>
      </Sheet>
    );
  }
  if (query.kind === 'loading') {
    return (
      <Sheet
        open
        onClose={onClose}
        title={title || 'Loading the dish…'}
        snapPoints={[0.8]}
        footer={
          <Button variant="primary" size="lg" fullWidth disabled testID="ItemSheet-add">
            Add to cart
          </Button>
        }
        testID="ItemSheet-loading"
      >
        <View style={styles.stack} accessibilityLabel="Loading the dish…" aria-busy>
          <LoadingLine />
          <Skeleton variant="rect" width="100%" height={160} />
          <Skeleton variant="rect" width="40%" height={24} />
          <Skeleton variant="text" lines={3} />
        </View>
      </Sheet>
    );
  }
  if (query.kind === 'error') {
    return (
      <Sheet open onClose={onClose} title={title || 'Dish'} snapPoints={[0.7]} testID="ItemSheet-error">
        <ErrorState
          variant="inline"
          title="We couldn't load this dish"
          description="Check your connection and try again. Your cart is unchanged."
          onRetry={reload}
          action={{ label: 'Back to the menu', onPress: onClose, testID: 'ItemSheet-backToMenu' }}
          autoFocus
          testID="ItemSheet-errorState"
        />
      </Sheet>
    );
  }
  return <ReadySheet {...props} item={query.data!} onGone={() => setGone(true)} />;
}

function LoadingLine(): React.ReactElement {
  const theme = useTheme();
  const body = useTypeStyle('body.md');
  return (
    <Text accessibilityLiveRegion="polite" style={[body, { color: theme.color.text.secondary }]}>
      Loading the dish…
    </Text>
  );
}

function SheetMessage({ title, body }: { title: string; body: string }): React.ReactElement {
  const theme = useTheme();
  const heading = useTypeStyle('heading.md');
  const text = useTypeStyle('body.md');
  return (
    <View style={styles.message}>
      <Text accessibilityRole="header" style={[heading, styles.centreText, { color: theme.color.text.primary }]}>
        {title}
      </Text>
      <Text style={[text, styles.centreText, { color: theme.color.text.secondary }]}>{body}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ ready */

type Gate = { text: string; action?: { label: string; icon: 'search' | 'plus' | 'map'; onPress: () => void } };

function ReadySheet({
  item,
  restaurantName,
  availability,
  addressName,
  editLine,
  onClose,
  onAdded,
  onAddAddress,
  onChangeAddress,
  onFindOpen,
  onGone,
}: ItemSheetProps & { item: MenuItem; onGone: () => void }): React.ReactElement {
  const theme = useTheme();
  const body = useTypeStyle('body.md');
  const bodySm = useTypeStyle('body.sm');
  const label = useTypeStyle('label.lg');
  const { online } = useConnectivity();
  const now = useNow(60_000);

  const [sel, setSel] = React.useState<ItemSelection>(() => (editLine ? selectionFromLine(item, editLine) : initialSelection(item)));
  const [adding, setAdding] = React.useState(false);
  const [failure, setFailure] = React.useState<InlineFailure | null>(null);
  const [decision, setDecision] = React.useState<{ name: string | null; count: number | null } | null>(null);
  /** Once "Start a new cart" was chosen, every retry is a replace. */
  const [replacing, setReplacing] = React.useState(false);
  const [replaceFailed, setReplaceFailed] = React.useState(false);
  const [oldCart, setOldCart] = React.useState<{ name: string | null; count: number | null } | null>(null);
  const [soldOutVariants, setSoldOutVariants] = React.useState<ReadonlySet<string>>(new Set());
  const [ranOutAddon, setRanOutAddon] = React.useState<string | null>(null);
  const [soldOutAddons, setSoldOutAddons] = React.useState<ReadonlySet<string>>(new Set());
  const [closedNow, setClosedNow] = React.useState(false);
  const [unavailableNow, setUnavailableNow] = React.useState(false);

  /**
   * The current attempt's Idempotency-Key, tied to what it sends. The same line sent again (a retry,
   * or the replace after "Start a new cart") reuses it; a changed line is a new attempt.
   */
  const attempt = React.useRef<{ signature: string; key: string } | null>(null);
  const keyFor = (signature: string): string => {
    if (!attempt.current || attempt.current.signature !== signature) attempt.current = { signature, key: idempotencyKey() };
    return attempt.current.key;
  };

  const groups = item.variant_groups ?? [];
  const addonGroups = item.addon_groups ?? [];
  const price = headerPrice(item, sel);
  const diet = dietaryBadges(item.dietary_tags);
  const allergens = item.allergen_tags ?? [];
  const stockLine = outOfStockLine(item);
  const restock = item.availability_state === 'OUT_OF_STOCK' && item.out_of_stock_until ? formatTime(item.out_of_stock_until) : null;

  // The restaurant's own verdict first: the dead-end Add is replaced by the way forward.
  const opens = availability ? opensPhrase(availability.opens_at, now) : null;
  let gate: Gate | null = null;
  if (closedNow) {
    gate = { text: '', action: { label: 'Find an open restaurant', icon: 'search', onPress: onFindOpen } };
  } else if (unavailableNow) {
    gate = { text: `${restaurantName} can't take orders right now.` };
  } else if (availability && !editLine) {
    switch (availability.state) {
      case 'OPEN':
        break;
      case 'NO_ADDRESS':
        gate = {
          text: `Add a delivery address to order from ${restaurantName}.`,
          action: { label: 'Add an address', icon: 'plus', onPress: onAddAddress },
        };
        break;
      case 'CLOSED_HOURS':
        gate = {
          text: `${restaurantName} is closed.${opens ? ` It ${opens}.` : ''}`,
          action: { label: 'Find an open restaurant', icon: 'search', onPress: onFindOpen },
        };
        break;
      case 'PAUSED':
        gate = { text: `${restaurantName} has paused new orders. Check back later.` };
        break;
      case 'OUT_OF_RANGE':
        gate = {
          text: `${restaurantName} doesn't deliver to ${addressName ?? 'your address'}. Change your address to order.`,
          action: { label: 'Change address', icon: 'map', onPress: onChangeAddress },
        };
        break;
      default:
        gate = { text: `${restaurantName} can't take orders right now.` };
    }
  }
  const locked = Boolean(gate);
  // Closed, paused, out of range or refused: the choices stay readable, the quantity cannot move.
  const frozen = closedNow || unavailableNow || (locked && availability?.state !== 'NO_ADDRESS');
  const reason = gate?.text || (!online ? OFFLINE_REASON : blockReason(item, sel, restock));

  async function submit(): Promise<void> {
    if (adding || locked || reason) return;
    const input = toCartLineInput(item, sel);
    setAdding(true);
    setFailure(null);
    try {
      if (editLine) {
        const original = lineToCartLineInput(editLine);
        let cart: Cart;
        if (sameLine(original, input)) {
          // Same choices: only the quantity can have changed.
          cart = input.quantity === editLine.quantity ? await getCart() : await setLineQuantity(editLine.id, input.quantity);
        } else {
          // G5: add the new line first, then remove the old one, so a failed add leaves the cart as it was.
          cart = await addCartLine(input, { idempotencyKey: keyFor(JSON.stringify(input)) });
          try {
            cart = await removeLine(editLine.id);
          } catch {
            // The new line is in; the old one stays until the customer removes it from the cart.
          }
        }
        onAdded(cart, addedLine(cart.lines, input));
        return;
      }
      const cart = await addCartLine(input, { idempotencyKey: keyFor(JSON.stringify(input)), replace: replacing });
      onAdded(cart, addedLine(cart.lines, input));
    } catch (e) {
      const f = classifyAddError(e);
      if (f.kind === 'differentRestaurant') {
        let { restaurantName: name, itemCount: count } = f;
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
      } else if (f.kind === 'gone') {
        onGone();
      } else {
        if (replacing) setReplaceFailed(true);
        if (f.kind === 'restaurantClosed') setClosedNow(true);
        if (f.kind === 'restaurantUnavailable') setUnavailableNow(true);
        if (f.kind === 'variantUnavailable') {
          const chosen = f.variantId ?? null;
          if (chosen) {
            setSoldOutVariants((s) => new Set([...s, chosen]));
            setSel((s) => clearVariant(s, chosen));
          }
        }
        if (f.kind === 'addonUnavailable' && f.addonId) setRanOutAddon(f.addonId);
        setFailure(f);
      }
    } finally {
      setAdding(false);
    }
  }

  function startNewCart(): void {
    setOldCart(decision);
    setDecision(null);
    setReplacing(true);
  }

  // Fire the replace once the sheet has switched to it; the attempt's key is reused (same line).
  React.useEffect(() => {
    if (replacing && !replaceFailed) void submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replacing]);

  const variantOut = failure?.kind === 'variantUnavailable' ? (failure.variantId ?? null) : null;
  const outGroup = variantOut ? groups.find((g) => g.variants.some((v) => v.id === variantOut)) : undefined;
  const opensSentence = opens ? `It ${opens}.` : null;
  const alert: { icon: AlertIcon; title: string; body: string } | null = failure
    ? replaceFailed && (failure.kind === 'other' || failure.kind === 'offline')
      ? { icon: 'error', title: "We couldn't start a new cart", body: replaceFailedCopy(oldCart) }
      : failureCopy(failure, {
          itemName: item.name,
          restaurantName,
          groupName: outGroup?.name ?? null,
          variantName: outGroup?.variants.find((v) => v.id === variantOut)?.name ?? null,
          addonName: addonGroups.flatMap((g) => g.addons).find((a) => a.id === ranOutAddon)?.name ?? null,
          opensSentence,
        })
    : null;

  const addLabel = editLine
    ? 'Update item'
    : replacing
      ? 'Start a new cart and add'
      : sel.quantity > 1
        ? `Add ${sel.quantity} to cart`
        : 'Add to cart';

  const footer = (
    <View style={styles.footer}>
      {reason ? (
        <Text testID="ItemSheet-reason" nativeID="add-reason" style={[body, { color: theme.color.text.primary }]}>
          {reason}
        </Text>
      ) : null}
      {gate?.action ? (
        <Button
          variant="primary"
          size="lg"
          fullWidth
          onPress={gate.action.onPress}
          iconStart={<Icon name={gate.action.icon} size={20} color={theme.color.text.onBrand} />}
          accessibilityHint={reason || alert?.title}
          testID="ItemSheet-gateAction"
        >
          {gate.action.label}
        </Button>
      ) : (
        <Button
          variant="primary"
          size="lg"
          fullWidth
          onPress={() => void submit()}
          loading={adding}
          disabled={locked || Boolean(reason)}
          iconStart={editLine ? undefined : <Icon name="cart" size={20} color={theme.color.text.onBrand} />}
          accessibilityHint={reason ?? undefined}
          testID="ItemSheet-add"
        >
          {addLabel}
        </Button>
      )}
    </View>
  );

  return (
    <>
      <Sheet open onClose={onClose} title={editLine ? `Edit ${item.name}` : item.name} snapPoints={[0.92]} footer={footer} testID="ItemSheet">
        {alert ? <InlineAlert icon={alert.icon} title={alert.title} body={alert.body} /> : null}

        {item.image_url ? <ItemImage uri={item.image_url} /> : null}

        <View style={styles.stack}>
          <View style={styles.inline} testID="ItemSheet-header">
            {price.from ? <Text style={[label, { color: theme.color.text.secondary }]}>From</Text> : null}
            <Price cents={cents(price.cents)} size="lg" testID="ItemSheet-price" />
          </View>
          {stockLine || diet.length ? (
            <View style={styles.wrap}>
              {stockLine ? (
                <Badge
                  variant="neutral"
                  size="md"
                  label={stockLine}
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
              {[item.description, item.prep_minutes ? `Usually ready in about ${item.prep_minutes} minutes.` : null]
                .filter(Boolean)
                .join(' ')}
            </Text>
          ) : null}
          {item.ingredients_text ? (
            <Text style={[bodySm, { color: theme.color.text.secondary }]}>{`Ingredients: ${item.ingredients_text}`}</Text>
          ) : null}
        </View>

        <View style={styles.stack}>
          <Text accessibilityRole="header" style={[label, { color: theme.color.text.primary }]}>
            Allergens
          </Text>
          {allergens.length ? (
            <View style={styles.wrap} testID="ItemSheet-allergens">
              {allergens.map((a) => (
                <Badge key={a} variant="warning" size="md" label={allergenLabel(a)} />
              ))}
            </View>
          ) : (
            // An empty list is "not provided", never "no allergens".
            <Text style={[body, { color: theme.color.text.secondary }]}>
              Allergen information not provided by this restaurant. If you have an allergy, contact them before you order.
            </Text>
          )}
        </View>

        {item.availability_state === 'AVAILABLE'
          ? groups.map((g) => {
              const groupOut = outGroup?.id === g.id && !sel.variants[g.id];
              return (
                <RadioGroup
                  key={g.id}
                  name={g.id}
                  label={variantLegend(g)}
                  required={g.required}
                  value={sel.variants[g.id] ?? null}
                  onChange={(v) => setSel((s) => chooseVariant(s, g.id, v))}
                  disabled={closedNow}
                  errorText={groupOut ? `Choose another ${g.name.toLowerCase()} to continue.` : undefined}
                  testID={`ItemSheet-variants-${g.id}`}
                >
                  {g.variants.map((v) => {
                    const out = !v.is_available || soldOutVariants.has(v.id);
                    return (
                      <Radio
                        key={v.id}
                        value={v.id}
                        label={v.name}
                        // RadioGroup has no option Price slot yet (ds-request): the ABSOLUTE price is
                        // the option's description, a server value through the DS formatter.
                        description={v.pricing_mode === 'ABSOLUTE' && v.price_cents != null ? formatPrice(cents(v.price_cents)) : undefined}
                        priceDeltaCents={v.pricing_mode === 'DELTA' && v.delta_cents ? v.delta_cents : undefined}
                        disabled={out}
                        disabledReason={out ? 'Sold out' : undefined}
                        testID={`ItemSheet-variant-${v.id}`}
                      />
                    );
                  })}
                </RadioGroup>
              );
            })
          : null}

        {item.availability_state === 'AVAILABLE'
          ? addonGroups.map((g) => {
              const chosen = sel.addons[g.id] ?? [];
              const full = chosen.length >= g.max_select;
              return (
                <View key={g.id} accessibilityLabel={g.name} style={styles.group} testID={`ItemSheet-addons-${g.id}`}>
                  <Text accessibilityRole="header" style={[label, { color: theme.color.text.primary }]}>
                    {addonLegend(g, chosen.length)}
                  </Text>
                  {g.min_select > 0 ? (
                    <Text style={[bodySm, { color: theme.color.text.secondary }]}>{`Choose at least ${g.min_select}.`}</Text>
                  ) : null}
                  {g.addons.map((a) => {
                    const checked = chosen.includes(a.id);
                    const outOfStock = !a.is_available || soldOutAddons.has(a.id);
                    const capped = !checked && full;
                    const ranOut = ranOutAddon === a.id && checked;
                    return (
                      <View key={a.id}>
                        <Checkbox
                          label={a.name}
                          checked={checked}
                          onChange={() => {
                            if (ranOutAddon === a.id && checked) {
                              setSoldOutAddons((s) => new Set([...s, a.id]));
                              setRanOutAddon(null);
                            }
                            setSel((s) => toggleAddon(s, g, a.id));
                          }}
                          priceDeltaCents={a.price_cents > 0 ? a.price_cents : undefined}
                          disabled={closedNow || (!checked && (outOfStock || capped))}
                          disabledReason={outOfStock ? 'Out of stock' : capped ? `Up to ${g.max_select} — untick one to swap` : undefined}
                          error={ranOut}
                          testID={`ItemSheet-addon-${a.id}`}
                        />
                        {ranOut ? (
                          <Text style={[bodySm, styles.indent, { color: theme.color.text.primary }]} testID={`ItemSheet-addonError-${a.id}`}>
                            Just ran out. Untick it to continue.
                          </Text>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              );
            })
          : null}

        {item.availability_state === 'AVAILABLE' ? (
          <View style={[styles.quantity, { borderTopColor: theme.color.border.decorative }]}>
            <View style={styles.quantityRow}>
              <Text style={[label, { color: theme.color.text.primary }]}>Quantity</Text>
              <QuantityStepper
                value={sel.quantity}
                min={1}
                max={MAX_QUANTITY}
                onChange={(q) => setSel((s) => setQuantity(s, q))}
                size="lg"
                disabled={frozen}
                itemName={item.name}
                maxReason={`Maximum ${MAX_QUANTITY}`}
                testID="ItemSheet-quantity"
              />
            </View>
            {sel.quantity >= MAX_QUANTITY ? (
              <Text style={[bodySm, styles.end, { color: theme.color.text.secondary }]} testID="ItemSheet-max">
                {`Maximum ${MAX_QUANTITY}`}
              </Text>
            ) : null}
          </View>
        ) : null}

        {item.availability_state === 'AVAILABLE' ? (
          <View style={styles.group}>
            <Input
              label="Special request (optional)"
              value={sel.specialRequest}
              onChange={(t) => setSel((s) => ({ ...s, specialRequest: t }))}
              helperText="The kitchen sees this. For allergies, contact the restaurant before you order."
              maxLength={SPECIAL_REQUEST_MAX}
              disabled={closedNow}
              testID="ItemSheet-special"
            />
            {/* Textarea with a worded counter is a design-system gap; the count is a server limit. */}
            <Text
              style={[bodySm, styles.end, { color: theme.color.text.secondary }]}
              accessibilityLiveRegion={SPECIAL_REQUEST_MAX - sel.specialRequest.length <= 20 ? 'polite' : 'none'}
              testID="ItemSheet-specialCount"
            >
              {`${sel.specialRequest.length} of ${SPECIAL_REQUEST_MAX} characters used`}
            </Text>
          </View>
        ) : null}
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
          { label: 'Start a new cart', onPress: startNewCart, destructive: true, testID: 'ItemSheet-startNewCart' },
        ]}
        testID="ItemSheet-differentRestaurant"
      />
    </>
  );
}

/* ----------------------------------------------------- composed sections */

/** InlineAlert (Proposed, manifest §4): an outlined card with a glyph, title and body. Never red. */
function InlineAlert({ icon, title, body }: { icon: AlertIcon; title: string; body: string }): React.ReactElement {
  const theme = useTheme();
  const heading = useTypeStyle('heading.sm');
  const text = useTypeStyle('body.sm');
  return (
    <Card variant="outlined" padding={12} testID="ItemSheet-alert">
      <View style={styles.alertRow} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <Icon name={icon} size={22} color={theme.color.text.secondary} />
        <View style={styles.alertBody}>
          <Text style={[heading, { color: theme.color.text.primary }]} testID="ItemSheet-alertTitle">
            {title}
          </Text>
          <Text style={[text, { color: theme.color.text.secondary }]} testID="ItemSheet-alertBody">
            {body}
          </Text>
        </View>
      </View>
    </Card>
  );
}

/** MediaFrame is a design-system gap: the dish photo at 16:9, decorative. */
function ItemImage({ uri }: { uri: string }): React.ReactElement | null {
  const theme = useTheme();
  const [failed, setFailed] = React.useState(false);
  if (failed) return null;
  return (
    <View
      style={[styles.image, { backgroundColor: theme.color.surface.sunken }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setFailed(true)} />
    </View>
  );
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

function allergenLabel(tag: string): string {
  if (ALLERGEN[tag]) return ALLERGEN[tag]!;
  const words = tag.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const styles = StyleSheet.create({
  centre: { alignItems: 'center', gap: 16, paddingVertical: 16 },
  centreText: { textAlign: 'center' },
  message: { gap: 8 },
  stack: { gap: 8 },
  inline: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  group: { gap: 4 },
  indent: { paddingStart: 40 },
  quantity: { gap: 4, paddingTop: 12, borderTopWidth: 1 },
  quantityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  end: { alignSelf: 'flex-end' },
  footer: { gap: 8 },
  alertRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  alertBody: { flex: 1, gap: 4 },
  image: { width: '100%', aspectRatio: 16 / 9, borderRadius: 16, overflow: 'hidden' },
});
