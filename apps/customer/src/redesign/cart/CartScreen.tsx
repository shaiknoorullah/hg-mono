/**
 * C1 Cart (manifest §2 C1; boards `CC/Cart-*`; logic ported from #639 `CartScreen` and #649).
 *
 * Reads: `getCart` (the server's cart, rendered as given), `listAddresses` (to name the address the
 * cart is priced for), `getActiveOrder` (one order at a time: the limit shows before checkout), and
 * `createQuote`/`getQuote` when the cart has an address and is quotable: the same rows and labels
 * as checkout ("Items subtotal", "Delivery fee", "Service fee" even at $0.00, "Total"). Without an
 * address, or while the cart cannot be priced, it shows "Items (estimate)" from
 * `indicative_subtotal_cents`.
 *
 * Writes: `updateCartLine` (quantity 1–20), `removeCartLine` (with Undo, which re-adds the same line
 * through `addCartLine` with its own Idempotency-Key), `clearCart` (after a confirm), and the
 * edit-line sheet (remove + add, API gap G5). Every write returns the recomputed cart and the screen
 * renders that; nothing is priced, summed or compared on the phone (below the minimum comes only
 * from `blocking_reasons`). Requests carry ids and quantities only.
 *
 * Halal: the restaurant's badge comes only from `halal.display_state` through `presentHalal`. A
 * lapsed certificate (EXPIRED) is the cool-slate seal and a neutral banner, and only + and checkout
 * turn off; a restaurant that can't take orders for any other reason gets no badge and no cause.
 *
 * Page sections (restaurant card, line rows, sticky footer, money rows) are composed here from
 * design-system exports; StickyFooter, InlineAlert and the Price-in-Button slot are design-system
 * gaps (manifest §4) and are not exported from the app.
 */
import * as React from 'react';
import { AccessibilityInfo, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cents, idempotencyKey, isApiError } from '@hg/api-client';

import {
  AppBar,
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  HalalBadge,
  Icon,
  Modal,
  Price,
  QuantityStepper,
  Skeleton,
  Toast,
  elevationStyle,
  formatPrice,
  spokenPrice,
  useTheme,
  useTypeStyle,
} from '../ds';
import { useNav } from '../navigation/context';
import { useFocusOnMount } from '../signin/a11y';
import { useConnectivity } from '../lib/connectivity';
import { presentHalal } from '../lib/halal';
import { getNow, useNow } from '../lib/now';
import { errorCodeOf } from '../lib/query';
import { formatShortDate, formatTime } from '../lib/time';
import { addressName, opensPhrase } from '../restaurant/restaurant';
import { ItemSheet } from '../ordering/ItemSheet';
import {
  addCartLine,
  clearCart,
  createCartQuote,
  getActiveOrder,
  getCart,
  listAddresses,
  quoteKeyFor,
  readQuote,
  rememberCart,
  rememberQuote,
  rememberedCart,
  rememberedQuote,
  removeLine,
  setLineQuantity,
  type ActiveOrder,
  type Address,
  type Cart,
  type CartLine,
  type Quote,
} from '../ordering/cart';
import { lineToCartLineInput } from '../ordering/itemSelection';
import {
  MAX_LINE_QUANTITY,
  activeOrderSentence,
  blockedLinesNotice,
  canQuote,
  cartState,
  closedUntil,
  itemsText,
  lineFlag,
  lineOptions,
  priceChange,
  requestText,
  safeCents,
  type CartState,
} from '../ordering/lines';

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; code: string | null }
  | { kind: 'ready'; cart: Cart; asOf: number };

type QuoteState =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'ready'; quote: Quote }
  | { kind: 'failed'; code: string | null };

/** A refused quote that changes the board, on top of what the cart itself says. */
type QuoteBlock = 'belowMinimum' | 'restaurantClosed' | 'restaurantUnavailable' | 'orderingPaused' | 'outOfRange' | 'province';

const QUOTE_BLOCKS: Readonly<Record<string, QuoteBlock>> = {
  BELOW_MINIMUM_ORDER: 'belowMinimum',
  RESTAURANT_CLOSED: 'restaurantClosed',
  RESTAURANT_UNAVAILABLE: 'restaurantUnavailable',
  ORDERING_PAUSED: 'orderingPaused',
  ADDRESS_OUT_OF_RANGE: 'outOfRange',
  PROVINCE_NOT_SERVED: 'province',
};

export const OFFLINE_FOOTER = "You're offline. Check out when you're back online.";

export function CartScreen(): React.ReactElement {
  const nav = useNav();
  const theme = useTheme();
  const { online } = useConnectivity();

  const [load, setLoad] = React.useState<Load>({ kind: 'loading' });
  const [addresses, setAddresses] = React.useState<Address[]>([]);
  const [activeOrder, setActiveOrder] = React.useState<ActiveOrder | null>(null);
  const [quote, setQuote] = React.useState<QuoteState>({ kind: 'none' });
  const [mutating, setMutating] = React.useState<string | null>(null);
  const [mutationFailed, setMutationFailed] = React.useState(false);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [editLine, setEditLine] = React.useState<CartLine | null>(null);
  const [removed, setRemoved] = React.useState<CartLine | null>(null);
  const [undoFailed, setUndoFailed] = React.useState<string | null>(null);

  const live = React.useRef(true);
  React.useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );
  const quoteSeq = React.useRef(0);
  /** One Idempotency-Key per pricing attempt (cart, lines, quantities and address); a retry reuses it. */
  const quoteKeys = React.useRef(new Map<string, string>());
  const lastTotal = React.useRef<number | null>(null);
  const activeRef = React.useRef<ActiveOrder | null>(null);

  const price = React.useCallback((cart: Cart, active: ActiveOrder | null) => {
    const seq = ++quoteSeq.current;
    const state = cartState(cart, active);
    const addressId = cart.delivery_address_id;
    if (!canQuote(cart, state) || !addressId) {
      setQuote({ kind: 'none' });
      return;
    }
    const key = quoteKeyFor(cart, addressId);
    setQuote({ kind: 'loading' });
    const remembered = rememberedQuote(key, getNow());
    const run = async (): Promise<Quote> => {
      if (remembered) {
        try {
          return await readQuote(remembered.id);
        } catch {
          /* price it again below */
        }
      }
      let idem = quoteKeys.current.get(key);
      if (!idem) {
        idem = idempotencyKey();
        quoteKeys.current.set(key, idem);
      }
      return createCartQuote(cart, addressId, idem);
    };
    run()
      .then((q) => {
        if (!live.current || seq !== quoteSeq.current) return;
        rememberQuote(key, q);
        setQuote({ kind: 'ready', quote: q });
        const total = safeCents(q.total_cents);
        if (lastTotal.current !== null && total !== null && total !== lastTotal.current) {
          // "Total updated: …", once, when the new quote arrives (CC/Cart-line-updating).
          AccessibilityInfo.announceForAccessibility?.(`Total updated: ${spokenPrice(total)}`);
        }
        lastTotal.current = total;
      })
      .catch((e: unknown) => {
        if (!live.current || seq !== quoteSeq.current) return;
        setQuote({ kind: 'failed', code: errorCodeOf(e) });
      });
  }, []);

  const show = React.useCallback(
    (cart: Cart) => {
      const asOf = getNow();
      rememberCart(cart, asOf);
      setLoad({ kind: 'ready', cart, asOf });
      price(cart, activeRef.current);
    },
    [price],
  );

  const reload = React.useCallback(() => {
    setLoad({ kind: 'loading' });
    setMutationFailed(false);
    void Promise.all([
      getCart(),
      listAddresses().catch(() => [] as Address[]),
      getActiveOrder().catch(() => null),
    ])
      .then(([cart, addrs, active]) => {
        if (!live.current) return;
        setAddresses(addrs);
        activeRef.current = active;
        setActiveOrder(active);
        show(cart);
      })
      .catch((e: unknown) => {
        if (!live.current) return;
        const cached = rememberedCart();
        // Offline with a cart this session already read: show it, read only, "as of" its time.
        if (!isApiError(e) && cached) {
          setLoad({ kind: 'ready', cart: cached.cart, asOf: cached.asOf });
          return;
        }
        setLoad({ kind: 'error', code: errorCodeOf(e) });
      });
  }, [show]);

  React.useEffect(() => reload(), [reload]);

  /** Every write returns the recomputed cart; a failure keeps the screen, says so and re-reads. */
  const mutate = React.useCallback(
    async (key: string, run: () => Promise<Cart>): Promise<boolean> => {
      setMutating(key);
      setMutationFailed(false);
      try {
        const cart = await run();
        if (live.current) show(cart);
        return true;
      } catch {
        if (!live.current) return false;
        setMutationFailed(true);
        try {
          const cart = await getCart();
          if (live.current) show(cart);
        } catch {
          /* keep what is on screen; the banner says the change did not go through */
        }
        return false;
      } finally {
        if (live.current) setMutating(null);
      }
    },
    [show],
  );

  const remove = React.useCallback(
    async (line: CartLine) => {
      setUndoFailed(null);
      if (await mutate(line.id, () => removeLine(line.id))) setRemoved(line);
    },
    [mutate],
  );

  const undo = React.useCallback(async () => {
    const line = removed;
    setRemoved(null);
    if (!line) return;
    setMutating('__undo__');
    try {
      const cart = await addCartLine(lineToCartLineInput(line), { idempotencyKey: idempotencyKey() });
      if (live.current) show(cart);
    } catch (e) {
      if (live.current) setUndoFailed(undoFailedCopy(line.name, errorCodeOf(e)));
    } finally {
      if (live.current) setMutating(null);
    }
  }, [removed, show]);

  const restaurantName = load.kind === 'ready' ? (load.cart.restaurant?.name ?? null) : null;

  const appBar = (title: string) => (
    <AppBar
      tone="cream"
      title={title}
      isPageHeading={false}
      back={{ onPress: nav.back, previousTitle: restaurantName ?? undefined }}
      loading={load.kind === 'loading' || mutating !== null}
    />
  );

  if (load.kind === 'loading') {
    return (
      <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="Cart-loading">
        {appBar('')}
        <LoadingBody />
      </View>
    );
  }

  if (load.kind === 'error') {
    return (
      <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="Cart-error">
        {appBar('Your cart')}
        <View style={styles.centre}>
          <ErrorState
            variant="page"
            title="We couldn't load your cart"
            description="Your items are saved on our side. Check your connection and try again."
            onRetry={reload}
            autoFocus
            testID="Cart-errorState"
          />
        </View>
      </View>
    );
  }

  const { cart, asOf } = load;

  if (cart.lines.length === 0) {
    return (
      <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="Cart-empty">
        {appBar('Your cart')}
        <View style={styles.centre}>
          <EmptyState
            variant="page"
            headingLevel={1}
            autoFocus
            illustration={<Icon name="cart" size={48} color={theme.color.text.secondary} />}
            title="Your cart is empty"
            description="Add dishes from a certified restaurant to start an order."
            primaryAction={{ label: 'Find a restaurant', onPress: () => nav.open({ name: 'home' }), testID: 'Cart-findRestaurant' }}
          />
        </View>
        {undoFailed || removed ? (
          <RemovedToasts removed={removed} undoFailed={undoFailed} onUndo={() => void undo()} onDismiss={() => {
            setRemoved(null);
            setUndoFailed(null);
          }} />
        ) : null}
      </View>
    );
  }

  const quoteCode = quote.kind === 'failed' ? quote.code : null;
  const quoteBlock = quoteCode ? (QUOTE_BLOCKS[quoteCode] ?? null) : null;

  return (
    <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="Cart">
      {appBar('')}
      <ReadyCart
        cart={cart}
        asOf={asOf}
        online={online}
        state={cartState(cart, activeOrder)}
        quote={quote}
        quoteBlock={quoteBlock}
        address={addresses.find((a) => a.id === cart.delivery_address_id) ?? null}
        mutating={mutating}
        mutationFailed={mutationFailed}
        onRetryQuote={() => price(cart, activeOrder)}
        onQuantity={(line, q) => (q <= 0 ? void remove(line) : void mutate(line.id, () => setLineQuantity(line.id, q)))}
        onRemove={(line) => void remove(line)}
        onRemoveAll={(lines) =>
          void mutate('__all__', async () => {
            let next = cart;
            for (const l of lines) next = await removeLine(l.id);
            return next;
          })
        }
        onEdit={setEditLine}
        onClear={() => setConfirmClear(true)}
      />

      <RemovedToasts
        removed={removed}
        undoFailed={undoFailed}
        onUndo={() => void undo()}
        onDismiss={() => {
          setRemoved(null);
          setUndoFailed(null);
        }}
      />

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        variant="confirm"
        destructive
        title="Clear your cart?"
        description={`This removes all ${itemsText(cart.item_count ?? cart.lines.length)}${restaurantName ? ` from ${restaurantName}` : ''}. You can't undo this.`}
        actions={[
          { label: 'Keep cart', onPress: () => setConfirmClear(false), testID: 'Cart-keepCart' },
          {
            label: 'Clear cart',
            destructive: true,
            testID: 'Cart-confirmClear',
            onPress: () => {
              setConfirmClear(false);
              setRemoved(null);
              void mutate('__all__', () => clearCart());
            },
          },
        ]}
        testID="Cart-clearDialog"
      />

      {editLine && cart.restaurant ? (
        <ItemSheet
          restaurantId={cart.restaurant.id}
          restaurantName={cart.restaurant.name}
          availability={null}
          addressName={null}
          menuItemId={editLine.menu_item_id}
          editLine={editLine}
          onClose={() => setEditLine(null)}
          onAdded={(next) => {
            setEditLine(null);
            show(next);
          }}
          onAddAddress={() => setEditLine(null)}
          onChangeAddress={() => setEditLine(null)}
          onFindOpen={() => setEditLine(null)}
        />
      ) : null}
    </View>
  );
}

function undoFailedCopy(name: string, code: string | null): string {
  switch (code) {
    case 'ITEM_UNAVAILABLE':
    case 'VARIANT_UNAVAILABLE':
    case 'ADDON_UNAVAILABLE':
      return `${name} just sold out, so it can't be re-added.`;
    case 'ITEM_DELETED':
    case 'NO_LIVE_MENU_ITEM':
    case 'ITEM_BLOCKED_BY_ADMIN':
      return `${name} is no longer on the menu, so it can't be re-added.`;
    case 'RESTAURANT_CLOSED':
    case 'RESTAURANT_UNAVAILABLE':
      return `The restaurant can't take orders right now, so ${name} can't be re-added.`;
    default:
      return `We couldn't re-add ${name}. Check your connection and add it again from the menu.`;
  }
}

/* --------------------------------------------------------------- toasts */

function RemovedToasts({
  removed,
  undoFailed,
  onUndo,
  onDismiss,
}: {
  removed: CartLine | null;
  undoFailed: string | null;
  onUndo: () => void;
  onDismiss: () => void;
}): React.ReactElement | null {
  const insets = useSafeAreaInsets();
  if (!removed && !undoFailed) return null;
  return (
    <View pointerEvents="box-none" style={[styles.toastDock, { bottom: insets.bottom + 180 }]}>
      {undoFailed ? (
        <Toast variant="warning" title="Couldn't put it back" description={undoFailed} onDismiss={onDismiss} testID="Cart-undoFailed" />
      ) : removed ? (
        // An action toast is persistent: it stays until Undo or dismiss (DS Toast).
        <Toast title={`Removed ${removed.name}`} action={{ label: 'Undo', onPress: onUndo }} onDismiss={onDismiss} testID="Cart-removedToast" />
      ) : null}
    </View>
  );
}

/* --------------------------------------------------------------- loading */

function LoadingBody(): React.ReactElement {
  const theme = useTheme();
  const small = useTypeStyle('body.sm');
  const h1 = React.useRef<Text>(null);
  useFocusOnMount(h1);
  return (
    <View style={styles.fill} aria-busy>
      <View style={styles.body}>
        <PageTitle titleRef={h1} />
        <Skeleton variant="rect" width="100%" height={72} />
        {[0, 1].map((i) => (
          <View key={i} style={styles.lineRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Skeleton variant="rect" width={56} height={56} />
            <View style={styles.lineBody}>
              <Skeleton variant="rect" width="70%" height={16} />
              <Skeleton variant="rect" width="50%" height={12} />
            </View>
          </View>
        ))}
        <Text accessibilityLiveRegion="polite" style={[small, { color: theme.color.text.secondary }]}>
          Loading your cart…
        </Text>
      </View>
      <Footer>
        <MoneyRow label="Items subtotal" value={0} loading />
        <MoneyRow label="Delivery fee" value={0} loading />
        <MoneyRow label="Service fee" value={0} loading />
        <MoneyRow label="Total" value={0} loading total />
        <Button variant="primary" size="lg" fullWidth disabled testID="Cart-checkout">
          Go to checkout
        </Button>
      </Footer>
    </View>
  );
}

function PageTitle({ titleRef }: { titleRef: React.RefObject<Text | null> }): React.ReactElement {
  const theme = useTheme();
  const h1 = useTypeStyle('heading.xl');
  return (
    <Text ref={titleRef} accessibilityRole="header" style={[h1, { color: theme.color.text.primary }]} testID="Cart-title">
      Your cart
    </Text>
  );
}

/* ----------------------------------------------------------------- ready */

interface Notice {
  title: string;
  description?: string;
  icon: 'warning' | 'info' | 'clock' | 'orders' | 'map';
  action?: { label: string; onPress: () => void };
  testID: string;
}

type FooterAction =
  | { kind: 'checkout'; enabled: boolean }
  | { kind: 'button'; label: string; icon?: 'search' | 'plus' | 'map' | 'orders'; onPress: () => void; testID: string };

function ReadyCart({
  cart,
  asOf,
  online,
  state,
  quote,
  quoteBlock,
  address,
  mutating,
  mutationFailed,
  onRetryQuote,
  onQuantity,
  onRemove,
  onRemoveAll,
  onEdit,
  onClear,
}: {
  cart: Cart;
  asOf: number;
  online: boolean;
  state: CartState;
  quote: QuoteState;
  quoteBlock: QuoteBlock | null;
  address: Address | null;
  mutating: string | null;
  mutationFailed: boolean;
  onRetryQuote: () => void;
  onQuantity: (line: CartLine, quantity: number) => void;
  onRemove: (line: CartLine) => void;
  onRemoveAll: (lines: CartLine[]) => void;
  onEdit: (line: CartLine) => void;
  onClear: () => void;
}): React.ReactElement {
  const nav = useNav();
  const theme = useTheme();
  const small = useTypeStyle('body.sm');
  const body = useTypeStyle('body.md');
  const now = useNow(30_000);
  const h1 = React.useRef<Text>(null);
  useFocusOnMount(h1);

  const restaurant = cart.restaurant ?? null;
  const name = restaurant?.name ?? 'This restaurant';
  const lapsed = state.kind === 'certLapsed';
  const unavailable = state.kind === 'restaurantUnavailable' || (quoteBlock === 'restaurantUnavailable' && !lapsed);
  const readOnly = !online;
  const frozen = mutating !== null;
  const certSentence = `${name}'s halal certificate isn't current, so we can't take this order. If the certificate is renewed, your cart will be here.`;

  const findAnother = (): void => nav.push({ name: 'browse' });
  const findOpen = (): void => nav.push({ name: 'browse', openNow: true });
  const chooseAddress = (): void => nav.push({ name: 'addresses' });

  // Which board: the cart's own state, then what a refused quote says.
  const effective: CartState['kind'] | QuoteBlock = unavailable
    ? 'restaurantUnavailable'
    : state.kind === 'ready' && quoteBlock
      ? quoteBlock
      : state.kind;

  /* ------------------------------------------------ notice (top banner) */
  let notice: Notice | null = null;
  let reason: string | null = null;
  let action: FooterAction = { kind: 'checkout', enabled: true };
  const opens = restaurant ? opensPhrase(restaurant.availability.opens_at, now) : null;

  switch (effective) {
    case 'certLapsed':
      action = { kind: 'button', label: 'Find another restaurant', icon: 'search', onPress: findAnother, testID: 'Cart-findAnother' };
      break;
    case 'restaurantUnavailable':
      notice = {
        icon: 'info',
        title: `${name} can't take orders right now`,
        description: 'Your cart is saved. You can check back later or order from another certified restaurant.',
        testID: 'Cart-unavailable',
      };
      reason = 'Checkout is off while this restaurant is unavailable.';
      action = { kind: 'button', label: 'Find another restaurant', icon: 'search', onPress: findAnother, testID: 'Cart-findAnother' };
      break;
    case 'activeOrder': {
      const order = (state as Extract<CartState, { kind: 'activeOrder' }>).order;
      notice = { icon: 'orders', title: 'You already have an order on the way', description: activeOrderSentence(order), testID: 'Cart-activeOrder' };
      reason = 'You can check out once your current order is delivered. Your cart is saved.';
      action = {
        kind: 'button',
        label: 'View order',
        icon: 'orders',
        onPress: () => nav.push({ name: 'tracking', orderId: order.id }),
        testID: 'Cart-viewOrder',
      };
      break;
    }
    case 'restaurantClosed': {
      const paused = state.kind === 'restaurantClosed' && state.paused;
      notice = {
        icon: 'clock',
        title: `${name} isn't taking orders right now`,
        description: paused
          ? 'The kitchen has paused new orders. Your cart is saved, and you can check out when it reopens.'
          : `${closedUntil(opens) ?? "It's closed right now."} Your cart is saved, and you can check out when it opens.`,
        action: { label: 'Find an open restaurant', onPress: findOpen },
        testID: 'Cart-closed',
      };
      reason = 'Checkout opens when the restaurant does.';
      action = { kind: 'checkout', enabled: false };
      break;
    }
    case 'orderingPaused':
      notice = { icon: 'info', title: 'Ordering is paused right now', description: 'Your cart is saved. Please try again a little later.', testID: 'Cart-orderingPaused' };
      reason = 'Checkout opens again when ordering resumes.';
      action = { kind: 'checkout', enabled: false };
      break;
    case 'linesBlocked': {
      const blocked = state as Extract<CartState, { kind: 'linesBlocked' }>;
      if (blocked.focus === 'remove') {
        const n = blockedLinesNotice(blocked.lines);
        notice = { icon: 'warning', title: n.title, description: n.description, testID: 'Cart-linesBlocked' };
        reason = n.footer;
        action = { kind: 'button', label: n.action, onPress: () => onRemoveAll(blocked.lines), testID: 'Cart-removeBlocked' };
      } else if (blocked.focus === 'variant') {
        notice = {
          icon: 'warning',
          title: 'The size you chose is sold out',
          description: "Edit the item to pick another. We don't change your cart without asking.",
          testID: 'Cart-variantUnavailable',
        };
        reason = 'Pick another size or remove the item to check out.';
        action = { kind: 'checkout', enabled: false };
      } else {
        notice = {
          icon: 'warning',
          title: 'An extra you chose has run out',
          description: 'Edit the item to change it, or remove the item.',
          testID: 'Cart-addonUnavailable',
        };
        reason = 'Change or remove the item with the extra that ran out to check out.';
        action = { kind: 'checkout', enabled: false };
      }
      break;
    }
    case 'belowMinimum': {
      const min = safeCents(restaurant?.availability.minimum_order_cents);
      notice = {
        icon: 'info',
        title: 'Below the minimum order',
        // A server amount through the DS formatter; the shortfall is never computed (G10).
        description: min !== null ? `${name}'s minimum order is ${formatPrice(min)}. Add more items to check out.` : 'Add more items to check out.',
        testID: 'Cart-belowMinimum',
      };
      reason = 'Add more items to reach the minimum order.';
      action = restaurant
        ? {
            kind: 'button',
            label: 'Add more items',
            icon: 'plus',
            onPress: () => nav.push({ name: 'restaurant', restaurantId: restaurant.id }),
            testID: 'Cart-addMore',
          }
        : { kind: 'checkout', enabled: false };
      break;
    }
    case 'noAddress':
      notice = { icon: 'map', title: 'Add a delivery address', description: 'We price delivery and fees for your address before you pay.', testID: 'Cart-noAddress' };
      reason = 'Add a delivery address to check out.';
      action = { kind: 'button', label: 'Choose a delivery address', icon: 'map', onPress: chooseAddress, testID: 'Cart-chooseAddress' };
      break;
    case 'outOfRange': {
      const where = addressName(address);
      notice = {
        icon: 'map',
        title: where ? `${name} doesn't deliver to ${where}` : `${name} doesn't deliver to that address`,
        description: `${address?.line1 ?? 'That address'} is outside its delivery area. Choose another address to see a price.`,
        testID: 'Cart-outOfRange',
      };
      reason = `We'll price your order once you choose an address ${name} delivers to.`;
      action = { kind: 'button', label: 'Choose a delivery address', icon: 'map', onPress: chooseAddress, testID: 'Cart-chooseAddress' };
      break;
    }
    case 'province':
      notice = { icon: 'map', title: 'We deliver in Ontario only for now', description: 'Choose an Ontario address to place this order.', testID: 'Cart-province' };
      reason = 'Choose an Ontario address to check out.';
      action = { kind: 'button', label: 'Choose a delivery address', icon: 'map', onPress: chooseAddress, testID: 'Cart-chooseAddress' };
      break;
    default: {
      const changed = cart.lines.map((l) => ({ l, c: priceChange(l) })).find((x) => x.c);
      if (changed) {
        notice = {
          icon: 'info',
          title: 'A price changed',
          description: `${changed.l.name} now costs ${changed.c!.up ? 'more' : 'less'}. The total below uses the new price, or you can remove it.`,
          testID: 'Cart-priceChanged',
        };
      }
      action = { kind: 'checkout', enabled: quote.kind !== 'loading' };
    }
  }

  // Offline: read only, whatever else is true.
  if (readOnly) {
    reason = OFFLINE_FOOTER;
    if (action.kind === 'checkout') action = { kind: 'checkout', enabled: false };
  }

  const showTotals = effective !== 'certLapsed' && effective !== 'restaurantUnavailable';
  const priced = quote.kind === 'ready' && (effective === 'ready' || effective === 'activeOrder');
  const pricing = quote.kind === 'loading' && !readOnly;

  return (
    <View style={styles.fill}>
      <ScrollView style={styles.fill} contentContainerStyle={styles.body} testID="Cart-scroll">
        <PageTitle titleRef={h1} />

        {readOnly ? (
          <Banner
            variant="neutral"
            icon={<Icon name="warning" size={22} color={theme.color.text.secondary} />}
            title="You're offline"
            description={`Showing your cart as of ${formatTime(asOf)}. You can read it; changing quantities and checking out wait until you're back online.`}
            testID="Cart-offline"
          />
        ) : null}

        {notice ? (
          <Banner
            variant="neutral"
            icon={<Icon name={notice.icon === 'orders' ? 'orders' : notice.icon} size={22} color={theme.color.text.secondary} />}
            title={notice.title}
            description={notice.description}
            action={notice.action ? { label: notice.action.label, onPress: notice.action.onPress, testID: `${notice.testID}-action` } : undefined}
            testID={notice.testID}
          />
        ) : null}

        {mutationFailed ? (
          <Banner
            variant="neutral"
            icon={<Icon name="info" size={22} color={theme.color.text.secondary} />}
            title="That change didn't go through"
            description="Your cart below is what we have saved. Try again."
            testID="Cart-mutationFailed"
          />
        ) : null}

        <RestaurantCard
          cart={cart}
          asOf={asOf}
          online={online}
          now={now}
          lapsed={lapsed}
          unavailable={unavailable}
          certSentence={certSentence}
          canClear={!readOnly && !lapsed && !unavailable}
          clearDisabled={frozen}
          onClear={onClear}
        />

        <View accessibilityLabel="Items" testID="Cart-lines">
          {cart.lines.map((line, i) => (
            <LineRow
              key={line.id}
              line={line}
              last={i === cart.lines.length - 1}
              busy={mutating === line.id || mutating === '__all__'}
              frozen={frozen || readOnly}
              lapsed={lapsed}
              unavailable={unavailable}
              certSentence={certSentence}
              onQuantity={(q) => onQuantity(line, q)}
              onRemove={() => onRemove(line)}
              onEdit={() => onEdit(line)}
            />
          ))}
        </View>
      </ScrollView>

      <Footer>
        {showTotals ? (
          priced ? (
            <QuoteRows quote={(quote as { quote: Quote }).quote} />
          ) : pricing ? (
            <View style={styles.rows}>
              <Text accessibilityLiveRegion="polite" style={[small, { color: theme.color.text.secondary }]} testID="Cart-pricing">
                {`Pricing your order for ${addressName(address) ?? 'your address'}…`}
              </Text>
              <MoneyRow label="Items subtotal" value={0} loading />
              <MoneyRow label="Delivery fee" value={0} loading />
              <MoneyRow label="Service fee" value={0} loading />
              <MoneyRow label="Total" value={0} loading total />
            </View>
          ) : (
            <View style={styles.rows}>
              <MoneyRow label="Items (estimate)" value={cart.indicative_subtotal_cents} testID="Cart-estimate" />
              <Text style={[small, { color: theme.color.text.secondary }]}>Delivery and fees are priced for your address before you pay.</Text>
              {quote.kind === 'failed' && !quoteBlock && online ? (
                <View style={styles.inlineWrap}>
                  <Text style={[small, styles.shrink, { color: theme.color.text.primary }]} testID="Cart-quoteFailed">
                    We couldn't price your order.
                  </Text>
                  <Button variant="tertiary" size="md" onPress={onRetryQuote} testID="Cart-retryQuote">
                    Try again
                  </Button>
                </View>
              ) : null}
            </View>
          )
        ) : null}

        {reason ? (
          <Text nativeID="checkout-reason" style={[body, { color: theme.color.text.primary }]} testID="Cart-reason">
            {reason}
          </Text>
        ) : null}

        {action.kind === 'checkout' ? (
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onPress={() => nav.push({ name: 'checkout' })}
            loading={pricing && effective === 'ready'}
            disabled={!action.enabled || frozen}
            accessibilityHint={reason ?? undefined}
            testID="Cart-checkout"
          >
            Go to checkout
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onPress={action.onPress}
            disabled={readOnly || (frozen && action.testID === 'Cart-removeBlocked')}
            iconStart={action.icon ? <Icon name={action.icon} size={20} color={theme.color.text.onBrand} /> : undefined}
            testID={action.testID}
          >
            {action.label}
          </Button>
        )}

        {(effective === 'certLapsed' || effective === 'restaurantUnavailable') && !readOnly ? (
          <Button variant="tertiary" size="md" fullWidth destructive onPress={onClear} disabled={frozen} testID="Cart-clear">
            Clear cart
          </Button>
        ) : null}
      </Footer>
    </View>
  );
}

/* ------------------------------------------------------- restaurant card */

function RestaurantCard({
  cart,
  asOf,
  online,
  now,
  lapsed,
  unavailable,
  certSentence,
  canClear,
  clearDisabled,
  onClear,
}: {
  cart: Cart;
  asOf: number;
  online: boolean;
  now: number;
  lapsed: boolean;
  unavailable: boolean;
  certSentence: string;
  canClear: boolean;
  clearDisabled: boolean;
  onClear: () => void;
}): React.ReactElement | null {
  const theme = useTheme();
  const heading = useTypeStyle('heading.md');
  const small = useTypeStyle('body.sm');
  const r = cart.restaurant;
  if (!r) return null;
  const halal = presentHalal(r.halal, { online, asOf, now });

  return (
    <Card variant="outlined" padding={16} testID="Cart-restaurant">
      <View style={styles.stack}>
        <View style={styles.inlineWrap}>
          <Text style={[heading, styles.shrink, { color: theme.color.text.primary }]} testID="Cart-restaurantName">
            {r.name}
          </Text>
          {canClear ? (
            <Button variant="ghost" size="md" destructive onPress={onClear} disabled={clearDisabled} testID="Cart-clear">
              Clear cart
            </Button>
          ) : null}
        </View>

        {unavailable ? null : lapsed ? (
          <>
            <View style={styles.inlineWrap} testID="Cart-halal">
              {/* EXPIRED is the cool-slate seal: "we can't currently vouch", never red. */}
              <HalalBadge state="EXPIRED" size="md" surface="card" restaurantId={r.id} testID="Cart-halalBadge" />
              {r.halal?.certifying_body_name ? (
                <Text style={[small, styles.shrink, { color: theme.color.text.secondary }]}>{r.halal.certifying_body_name}</Text>
              ) : null}
            </View>
            <Banner variant="neutral" title={certSentence} testID="Cart-certLapsed" />
          </>
        ) : halal.kind === 'badge' ? (
          <View style={styles.inlineWrap} testID="Cart-halal">
            <HalalBadge
              state={halal.state}
              size="md"
              surface="card"
              restaurantId={r.id}
              certifyingBodyName={halal.certifyingBody}
              expiresOn={halal.expiresOn}
              testID="Cart-halalBadge"
            />
            {halal.state === 'EXPIRING_SOON' ? (
              <Badge
                variant="neutral"
                size="md"
                label={`expires ${formatShortDate(halal.expiresOn)}`}
                icon={<Icon name="clock" size={14} color={theme.color.text.secondary} />}
              />
            ) : null}
            <Text style={[small, styles.shrink, { color: theme.color.text.secondary }]}>{halal.certifyingBody}</Text>
          </View>
        ) : halal.kind === 'unavailable' || halal.kind === 'stale' ? (
          <Text style={[small, { color: theme.color.text.secondary }]} testID="Cart-halalLine">
            {halal.line}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

/* ------------------------------------------------------------------ lines */

function LineRow({
  line,
  last,
  busy,
  frozen,
  lapsed,
  unavailable,
  certSentence,
  onQuantity,
  onRemove,
  onEdit,
}: {
  line: CartLine;
  last: boolean;
  busy: boolean;
  frozen: boolean;
  lapsed: boolean;
  unavailable: boolean;
  certSentence: string;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
  onEdit: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const nameStyle = useTypeStyle('label.lg');
  const small = useTypeStyle('body.sm');
  const flag = unavailable ? { badge: 'Not available right now', blocked: true, editable: false } : lineFlag(line);
  const options = lineOptions(line);
  const request = requestText(line.special_request);
  const change = priceChange(line);
  const lineTotal = safeCents(line.line_total_cents);
  const unit = safeCents(line.unit_price_cents);
  const blocked = Boolean(flag?.blocked);
  const atMax = line.quantity >= MAX_LINE_QUANTITY;

  return (
    <View
      testID={`CartLine-${line.id}`}
      style={[styles.lineRow, { borderBottomWidth: last ? 0 : 1, borderBottomColor: theme.color.border.decorative }]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.thumb, { backgroundColor: theme.color.surface.sunken }]}
      >
        {line.image_url ? <Image source={{ uri: line.image_url }} style={StyleSheet.absoluteFill} /> : null}
      </View>

      <View style={styles.lineBody}>
        <View style={styles.inlineWrap}>
          <Text accessibilityRole="header" style={[nameStyle, styles.shrink, { color: theme.color.text.primary }]}>
            {line.name}
          </Text>
          {lineTotal !== null ? <Price cents={lineTotal} size="md" loading={busy} testID={`CartLine-total-${line.id}`} /> : null}
        </View>
        {options ? (
          <Text style={[small, { color: theme.color.text.secondary }]} testID={`CartLine-options-${line.id}`}>
            {options}
          </Text>
        ) : null}
        {request ? <Text style={[small, styles.italic, { color: theme.color.text.secondary }]}>{request}</Text> : null}
        {flag?.badge ? (
          <View style={styles.inlineWrap}>
            <Badge
              variant="neutral"
              size="md"
              label={flag.badge}
              icon={<Icon name="clock" size={14} color={theme.color.text.secondary} />}
              testID={`CartLine-flag-${line.id}`}
            />
          </View>
        ) : null}

        {!blocked || change ? (
          <View style={styles.inline}>
            {change ? (
              <>
                <Price cents={change.was} size="sm" strikethrough color={theme.color.text.secondary} testID={`CartLine-was-${line.id}`} />
                <Price cents={change.now} size="sm" accessibilityLabel={`now ${spokenPrice(change.now)}`} testID={`CartLine-now-${line.id}`} />
              </>
            ) : unit !== null ? (
              <Price cents={unit} size="sm" color={theme.color.text.secondary} />
            ) : null}
            {change || unit !== null ? <Text style={[small, { color: theme.color.text.secondary }]}>each</Text> : null}
          </View>
        ) : null}

        <View style={styles.controls}>
          {blocked ? (
            <Button
              variant="tertiary"
              size="md"
              onPress={onRemove}
              disabled={frozen}
              accessibilityLabel={`Remove ${line.name}`}
              testID={`CartLine-remove-${line.id}`}
            >
              Remove
            </Button>
          ) : (
            <QuantityStepper
              value={line.quantity}
              min={0}
              // Certificate lapsed: only + is off (its reason is the banner); − and Remove stay.
              max={lapsed ? line.quantity : MAX_LINE_QUANTITY}
              removeAtZero
              size="lg"
              itemName={line.name}
              maxReason={lapsed ? certSentence : `Maximum ${MAX_LINE_QUANTITY}`}
              loading={busy}
              disabled={frozen && !busy}
              onChange={onQuantity}
              testID={`CartLine-stepper-${line.id}`}
            />
          )}
          {flag?.editable !== false && !lapsed && !unavailable && !frozen ? (
            <Button variant="tertiary" size="md" onPress={onEdit} accessibilityLabel={`Edit ${line.name}`} testID={`CartLine-edit-${line.id}`}>
              Edit
            </Button>
          ) : null}
        </View>
        {atMax && !blocked && !lapsed ? (
          <Text style={[small, { color: theme.color.text.secondary }]} testID={`CartLine-max-${line.id}`}>
            {`Maximum ${MAX_LINE_QUANTITY}`}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------- money rows */

/** The quote's rows in checkout's order and labels (C-22 AC1). Tax rows are `tax_lines` verbatim. */
function QuoteRows({ quote }: { quote: Quote }): React.ReactElement {
  return (
    <View style={styles.rows} testID="Cart-quote">
      <MoneyRow label="Items subtotal" value={quote.subtotal_cents} testID="Cart-subtotal" />
      <MoneyRow label="Delivery fee" value={quote.delivery_fee_cents} testID="Cart-delivery" />
      {/* Always shown, even at $0.00 (R-07). */}
      <MoneyRow label="Service fee" value={quote.service_fee_cents} testID="Cart-service" />
      {(quote.tax_lines ?? []).map((tax, i) => (
        <MoneyRow key={`${tax.jurisdiction_code}-${tax.statutory_label}-${i}`} label={tax.statutory_label} value={tax.amount_cents} />
      ))}
      <MoneyRow label="Total" value={quote.total_cents} total testID="Cart-total" />
    </View>
  );
}

function MoneyRow({
  label,
  value,
  loading = false,
  total = false,
  testID,
}: {
  label: string;
  value: unknown;
  loading?: boolean;
  total?: boolean;
  testID?: string;
}): React.ReactElement | null {
  const theme = useTheme();
  const text = useTypeStyle(total ? 'heading.sm' : 'body.md');
  const amount = safeCents(value);
  if (amount === null && !loading) return null;
  return (
    <View style={styles.moneyRow} testID={testID}>
      <Text style={[text, styles.shrink, { color: theme.color.text.primary }]}>{label}</Text>
      <Price cents={amount ?? cents(0)} size={total ? 'lg' : 'sm'} loading={loading} testID={testID ? `${testID}-price` : undefined} />
    </View>
  );
}

/** StickyFooter (Proposed, manifest §4): surface.raised with the sticky elevation. */
function Footer({ children }: { children: React.ReactNode }): React.ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      testID="Cart-footer"
      style={[elevationStyle(theme, 'sticky'), styles.footer, { paddingBottom: 16 + insets.bottom, backgroundColor: theme.color.surface.raised }]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, justifyContent: 'center', padding: 16 },
  body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24, gap: 16 },
  stack: { gap: 8 },
  inline: { flexDirection: 'row', alignItems: 'baseline', gap: 4, flexWrap: 'wrap' },
  inlineWrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  shrink: { flexShrink: 1 },
  italic: { fontStyle: 'italic' },
  lineRow: { flexDirection: 'row', gap: 12, paddingVertical: 12 },
  lineBody: { flex: 1, gap: 4 },
  thumb: { width: 56, height: 56, borderRadius: 8, overflow: 'hidden' },
  controls: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  rows: { gap: 4 },
  moneyRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  footer: { gap: 8, paddingHorizontal: 16, paddingTop: 16 },
  toastDock: { position: 'absolute', start: 16, end: 16 },
});
