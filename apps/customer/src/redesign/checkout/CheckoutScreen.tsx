/**
 * Checkout (boards `CC/Checkout-*`; the last step of the order flow).
 *
 * Reads: `getCart`, `listAddresses`, `getActiveOrder` (one order at a time), `listPaymentMethods`
 * (saved cards, display fields only), and `createQuote` / `getQuote`: the same persisted quote the
 * cart showed when the address and tip match, so the two screens can never disagree on a fee.
 *
 * Writes: `createQuote` again when the tip or the address changes, `createOrder` (the quote's id,
 * a saved card, the delivery notes), `cancelOrder` and, for "Put these items back", `addCartLine`.
 *
 * The client never prices anything. Request bodies carry ids, quantities, the customer's tip and
 * their notes, and no field that could hold a price, a fee, a tax or a total. Every amount on the
 * page is read off the quote or the order the server returned; the only comparison made on money is
 * "did the server change this figure", for the was/now rows.
 *
 * Payment is authorise-then-capture. Placing the order authorises the card; the server captures
 * when the restaurant accepts, and a rejection or a timeout voids the authorisation. So a failed or
 * declined authorisation is an ordinary state of this screen, with its own recovery: the order
 * already exists, unpaid, under a 15-minute deadline, and the customer retries the same payment,
 * pays another way, or cancels (free). The screen never shows "placed" until the server's payment
 * state says the card is authorised.
 *
 * Halal: the restaurant's badge comes only from the server's `halal.display_state` through
 * `presentHalal`. A lapsed certificate is the cool-slate seal and a neutral message, never red; a
 * missing or partial record draws no badge.
 */
import * as React from 'react';
import { AccessibilityInfo, ScrollView, Text, View } from 'react-native';
import { idempotencyKey, isApiError } from '@hg/api-client';
import type { Cents } from '@hg/api-client';

import {
  AppBar,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  ListRow,
  Modal,
  Price,
  Spinner,
  formatPrice,
  spokenPrice,
  useTheme,
  useTypeStyle,
} from '../ds';
import { useNav } from '../navigation/context';
import { useConnectivity } from '../lib/connectivity';
import { presentHalal } from '../lib/halal';
import { getNow, useNow } from '../lib/now';
import { errorCodeOf } from '../lib/query';
import { formatTime } from '../lib/time';
import { addressName, opensPhrase } from '../restaurant/restaurant';
import {
  addCartLine,
  getActiveOrder,
  getCart,
  lastQuote,
  listAddresses,
  quoteKeyFor,
  quoteStaleAt,
  readQuote,
  rememberCart,
  rememberQuote,
  rememberedCart,
  rememberedQuote,
  type ActiveOrder,
  type Address,
  type Cart,
} from '../ordering/cart';
import { activeOrderSentence, cartState, closedUntil, safeCents, type CartState } from '../ordering/lines';
import {
  cancelCheckoutOrder,
  createCheckoutOrder,
  createCheckoutQuote,
  listSavedCards,
  readOrder,
  readPayment,
  type Order,
  type PaymentMethod,
  type Quote,
} from './checkoutApi';
import { confirmPayment, outcomeOfPayment, type PaymentOutcome } from './confirmPayment';
import {
  DEFAULT_HANDOVER,
  TIP_NOT_AN_AMOUNT,
  TIP_PRESETS,
  TIP_TOO_HIGH,
  blockOf,
  cardExpired,
  cardExpiry,
  cardName,
  changedRows,
  declineCopy,
  handoverLabel,
  instructionsOf,
  isTipRefusal,
  lineToInput,
  orderEnded,
  staleQuoteOf,
  tipOf,
  type Block,
  type Handover,
  type TipChoice,
} from './model';
import { AddressSheet, CancelDialog, FinishProfileSheet, HandoverSheet, PaySheet, addressDetail, addressTitle, type PayChoice } from './Sheets';
import { Footer, LoadingBody, OrderCard, QuotingSkeleton, RestaurantHeader, Row, TipCard, placeA11yLabel, placeLabel, styles } from './Sections';

/** How long the screen waits between looks, in milliseconds. Tests shorten them. */
export const timing = { duplicateMs: 1500, duplicateTries: 6, checkMs: 2000, checkTries: 3, pollMs: 3000, tipMs: 600 };

export const OFFLINE_PLACE = "You're offline. Place order works again when you're back online.";

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; code: string | null }
  | { kind: 'ready'; cart: Cart; asOf: number };

type QuoteState =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'ready'; quote: Quote; staleAt: number }
  | { kind: 'failed'; code: string | null; tip: boolean };

type Step =
  | { kind: 'confirming' }
  | { kind: 'processing' }
  | { kind: 'bank' }
  | { kind: 'declined'; failureCode: string | null }
  | { kind: 'closed' }
  | { kind: 'unavailable'; message: string };

type Phase =
  | { kind: 'compose' }
  /** createOrder is in flight, or waiting out IDEMPOTENCY_IN_PROGRESS (`duplicate`). */
  | { kind: 'placing'; duplicate: boolean }
  /** The connection dropped mid-placing; the screen is asking the server whether the order exists. */
  | { kind: 'checking'; gaveUp: boolean }
  /** The order exists (CREATED) and is not paid yet. */
  | { kind: 'order'; order: Order; secret: string; step: Step }
  /** The order is over: nothing was charged. */
  | { kind: 'ended'; order: Order; cause: 'cancelled' | 'deadline' | 'failed' };

type PutBack = { kind: 'idle' } | { kind: 'busy' } | { kind: 'failed' } | { kind: 'replace'; restaurant: string | null; count: number | null };

type Sheet = 'address' | 'handover' | 'pay' | 'profile' | null;

/** The block the cart itself reports, from server fields only (`blocking_reasons`, availability, halal). */
function cartBlock(state: CartState): Block | null {
  switch (state.kind) {
    case 'restaurantUnavailable':
      return 'restaurantUnavailable';
    case 'restaurantClosed':
      return 'restaurantClosed';
    case 'orderingPaused':
      return 'orderingPaused';
    case 'linesBlocked':
      return 'linesUnavailable';
    case 'belowMinimum':
      return 'belowMinimum';
    default:
      return null;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function CheckoutScreen(): React.ReactElement {
  const nav = useNav();
  const theme = useTheme();
  const small = useTypeStyle('body.sm');
  const bodyType = useTypeStyle('body.md');
  const heading = useTypeStyle('heading.sm');
  const { online } = useConnectivity();
  const now = useNow(15_000);

  const [load, setLoad] = React.useState<Load>({ kind: 'loading' });
  const [addresses, setAddresses] = React.useState<Address[]>([]);
  const [cards, setCards] = React.useState<PaymentMethod[]>([]);
  const [active, setActive] = React.useState<ActiveOrder | null>(null);
  const [addressId, setAddressId] = React.useState<string | null>(null);
  const [tip, setTip] = React.useState<TipChoice>({ kind: 'preset', value: TIP_PRESETS[0]! });
  const [tipError, setTipError] = React.useState<string | null>(null);
  const [pay, setPay] = React.useState<PayChoice | undefined>(undefined);
  const [handover, setHandover] = React.useState<Handover>({ choice: DEFAULT_HANDOVER, noRing: false, noCall: false, note: '' });
  const [quote, setQuote] = React.useState<QuoteState>({ kind: 'none' });
  /** The quote the page showed before the latest one, to say what changed. */
  const [previous, setPrevious] = React.useState<{ quote: Quote; why: 'expired' | 'stale' } | null>(null);
  const [placeBlock, setPlaceBlock] = React.useState<Block | null>(null);
  const [placeFailed, setPlaceFailed] = React.useState(false);
  const [phase, setPhase] = React.useState<Phase>({ kind: 'compose' });
  const [sheet, setSheet] = React.useState<Sheet>(null);
  const [staleModal, setStaleModal] = React.useState<{ was: Quote; now: Quote } | null>(null);
  const [raceOrder, setRaceOrder] = React.useState<ActiveOrder | null>(null);
  const [cancelling, setCancelling] = React.useState<{ busy: boolean; failed: boolean } | null>(null);
  const [putBack, setPutBack] = React.useState<PutBack>({ kind: 'idle' });

  const live = React.useRef(true);
  React.useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );
  const quoteSeq = React.useRef(0);
  const placing = React.useRef(false);
  /** The Idempotency-Key of the placing attempt, and what it was for. A resend reuses it. */
  const attempt = React.useRef<{ sig: string; key: string } | null>(null);
  const cancelledByUs = React.useRef(false);
  const putBackKeys = React.useRef(new Map<number, string>());
  const putBackDone = React.useRef(new Set<number>());
  const lastTotal = React.useRef<number | null>(null);

  /* ------------------------------------------------------------- reading */

  const reload = React.useCallback(() => {
    setLoad({ kind: 'loading' });
    void Promise.all([
      getCart(),
      listAddresses().catch(() => [] as Address[]),
      getActiveOrder().catch(() => null),
      listSavedCards().catch(() => [] as PaymentMethod[]),
    ])
      .then(([cart, addrs, activeOrder, saved]) => {
        if (!live.current) return;
        const asOf = getNow();
        rememberCart(cart, asOf);
        setAddresses(addrs);
        setActive(activeOrder);
        setCards(saved);
        // The cart's own address when it is a saved one, else the default, else the first.
        const first = addrs.find((a) => a.id === cart.delivery_address_id) ?? addrs.find((a) => a.is_default) ?? addrs[0];
        setAddressId((current) => current ?? first?.id ?? cart.delivery_address_id ?? null);
        setHandover((h) => (h.note ? h : { ...h, note: first?.delivery_notes?.slice(0, 200) ?? '' }));
        setLoad({ kind: 'ready', cart, asOf });
      })
      .catch((e: unknown) => {
        if (!live.current) return;
        const cached = rememberedCart();
        // Offline with a cart this session already read: show it, read only, with its last price.
        if (!isApiError(e) && cached) {
          setLoad({ kind: 'ready', cart: cached.cart, asOf: cached.asOf });
          setAddressId((c) => c ?? cached.cart.delivery_address_id ?? null);
          return;
        }
        setLoad({ kind: 'error', code: errorCodeOf(e) });
      });
  }, []);
  React.useEffect(() => reload(), [reload]);

  const cart = load.kind === 'ready' ? load.cart : null;
  const state: CartState | null = cart ? cartState(cart, active) : null;
  const tipCents = tipOf(tip);
  /** The tip the page prices: a preset at once, a typed amount once the customer stops typing. */
  const [quoteTip, setQuoteTip] = React.useState<Cents | null>(tipOf(tip));
  React.useEffect(() => {
    if (tip.kind === 'preset') {
      setQuoteTip(tipCents);
      return;
    }
    const id = setTimeout(() => setQuoteTip(tipCents), timing.tipMs);
    return () => clearTimeout(id);
  }, [tip.kind, tipCents]);
  const address = addresses.find((a) => a.id === addressId) ?? null;
  const savedPay = pay === undefined ? (cards.find((c) => !cardExpired(c, now) && c.is_default) ?? cards.find((c) => !cardExpired(c, now)) ?? null)?.id ?? null : pay;
  const selectedCard = savedPay ? (cards.find((c) => c.id === savedPay) ?? null) : null;

  const lapsed = cart?.restaurant?.halal?.display_state === 'EXPIRED';
  const baseBlock = state ? cartBlock(state) : null;
  const wantsQuote =
    phase.kind === 'compose' &&
    cart !== null &&
    cart.lines.length > 0 &&
    cart.is_quotable &&
    addressId !== null &&
    !lapsed &&
    baseBlock === null &&
    quoteTip !== null &&
    online;

  /** Prices the cart for the address and tip. A new attempt gets a new key. */
  const price = React.useCallback(
    (c: Cart, addr: string, tipValue: Cents, reuse: boolean) => {
      const seq = ++quoteSeq.current;
      const key = quoteKeyFor(c, addr);
      setQuote({ kind: 'loading' });
      const run = async (): Promise<{ quote: Quote; staleAt: number }> => {
        // With no tip the cart's own persisted quote is the page's: the same row, the same fees.
        const remembered = reuse && tipValue === 0 ? rememberedQuote(key, getNow()) : null;
        if (remembered) {
          try {
            return { quote: await readQuote(remembered.quote.id), staleAt: remembered.staleAt };
          } catch {
            /* price it again below */
          }
        }
        const q = await createCheckoutQuote({ cart: c, addressId: addr, tip: tipValue, idempotencyKey: idempotencyKey() });
        return { quote: q, staleAt: quoteStaleAt(q, getNow()) };
      };
      run()
        .then(({ quote: q, staleAt }) => {
          if (!live.current || seq !== quoteSeq.current) return;
          if (tipValue === 0) rememberQuote(key, q, staleAt);
          setTipError(null);
          setQuote({ kind: 'ready', quote: q, staleAt });
          if (lastTotal.current !== null && lastTotal.current !== q.total_cents) {
            // "Total updated: …", once, when the new quote arrives, never per keystroke.
            AccessibilityInfo.announceForAccessibility?.(`Total updated: ${spokenPrice(q.total_cents)}`);
          }
          lastTotal.current = q.total_cents;
        })
        .catch((e: unknown) => {
          if (!live.current || seq !== quoteSeq.current) return;
          if (isTipRefusal(e)) {
            setTipError(TIP_TOO_HIGH);
            setQuote({ kind: 'failed', code: 'VALIDATION_FAILED', tip: true });
            return;
          }
          setQuote({ kind: 'failed', code: errorCodeOf(e), tip: false });
        });
    },
    [],
  );

  // Price on entry and whenever the cart, address or tip changes.
  const tipKey = quoteTip;
  React.useEffect(() => {
    if (wantsQuote && cart && addressId && quoteTip !== null) price(cart, addressId, quoteTip, true);
    else if (!wantsQuote && phase.kind === 'compose') {
      quoteSeq.current += 1;
      setQuote((q) => (q.kind === 'ready' ? q : { kind: 'none' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsQuote, cart?.id, cart?.lines.length, addressId, tipKey, price]);

  // A quote past its lifetime is not a price any more: price again, and say what changed.
  React.useEffect(() => {
    if (!wantsQuote || quote.kind !== 'ready' || now < quote.staleAt || !cart || !addressId || quoteTip === null) return;
    setPrevious({ quote: quote.quote, why: 'expired' });
    price(cart, addressId, quoteTip, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  const ready = quote.kind === 'ready' ? quote.quote : null;
  const changed = previous && ready && previous.quote.id !== ready.id ? changedRows(previous.quote, ready) : [];

  /* ---------------------------------------------------------- the order */

  const goToOrder = React.useCallback(
    (orderId: string) => {
      nav.reset({ name: 'tracking', orderId });
    },
    [nav],
  );

  /** Where a payment outcome leaves the page. Only the server's "authorised" leaves checkout. */
  const apply = React.useCallback(
    (order: Order, secret: string, outcome: PaymentOutcome) => {
      if (!live.current) return;
      if (outcome.kind === 'authorised') {
        goToOrder(order.id);
        return;
      }
      const next = 'secret' in outcome ? outcome.secret : secret;
      const step: Step =
        outcome.kind === 'processing'
          ? { kind: 'processing' }
          : outcome.kind === 'needsAction'
            ? { kind: 'bank' }
            : outcome.kind === 'declined'
              ? { kind: 'declined', failureCode: outcome.failureCode }
              : outcome.kind === 'closed'
                ? { kind: 'closed' }
                : { kind: 'unavailable', message: outcome.message };
      setPhase({ kind: 'order', order, secret: next, step });
    },
    [goToOrder],
  );

  const settle = React.useCallback(
    async (order: Order, secret: string) => {
      setPhase({ kind: 'order', order, secret, step: { kind: 'confirming' } });
      const outcome = await confirmPayment(order.id, secret);
      apply(order, secret, outcome);
    },
    [apply],
  );

  /** An order exists (just created, or found after a dropped connection): move it to payment. */
  const enterOrder = React.useCallback(
    async (order: Order, secret: string | null) => {
      if (order.state !== 'CREATED') {
        // Past payment already: the restaurant has it.
        if (!orderEnded(order)) goToOrder(order.id);
        else setPhase({ kind: 'ended', order, cause: 'failed' });
        return;
      }
      let useSecret = secret;
      if (!useSecret) {
        try {
          const p = await readPayment(order.id);
          const out = outcomeOfPayment(p, '');
          if (out?.kind === 'authorised') return goToOrder(order.id);
          useSecret = p.client_secret ?? null;
        } catch {
          /* fall through to the unpaid page */
        }
      }
      if (!useSecret) {
        setPhase({ kind: 'order', order, secret: '', step: { kind: 'processing' } });
        return;
      }
      await settle(order, useSecret);
    },
    [goToOrder, settle],
  );

  /** Asks the server whether an order exists after the connection dropped mid-placing. */
  const checkWhetherPlaced = React.useCallback(async () => {
    for (let i = 0; i < timing.checkTries; i += 1) {
      await sleep(timing.checkMs);
      if (!live.current) return;
      try {
        const found = await getActiveOrder();
        if (found) {
          await enterOrder(found as Order, null);
          return;
        }
      } catch {
        /* still offline: look again */
      }
    }
    if (live.current) setPhase({ kind: 'checking', gaveUp: true });
  }, [enterOrder]);

  const place = React.useCallback(async () => {
    if (placing.current || !ready || phase.kind !== 'compose') return;
    placing.current = true;
    setPlaceBlock(null);
    setPlaceFailed(false);
    setPhase({ kind: 'placing', duplicate: false });
    const instructions = instructionsOf(handover);
    const sig = `${ready.id}|${savedPay ?? 'new'}|${instructions.join(',')}|${handover.note.trim()}`;
    if (!attempt.current || attempt.current.sig !== sig) attempt.current = { sig, key: idempotencyKey() };
    const key = attempt.current.key;
    try {
      for (let tries = 0; ; tries += 1) {
        try {
          const created = await createCheckoutOrder({ quoteId: ready.id, paymentMethodId: savedPay, instructions, note: handover.note, idempotencyKey: key });
          if (!live.current) return;
          attempt.current = null;
          await enterOrder(created.order, created.client_secret);
          return;
        } catch (e) {
          // The same key is already running: wait and ask again with it, never with a new one.
          if (errorCodeOf(e) === 'IDEMPOTENCY_IN_PROGRESS' && tries < timing.duplicateTries) {
            if (live.current) setPhase({ kind: 'placing', duplicate: true });
            await sleep(timing.duplicateMs);
            if (!live.current) return;
            continue;
          }
          throw e;
        }
      }
    } catch (e) {
      if (!live.current) return;
      const code = errorCodeOf(e);
      if (!isApiError(e)) {
        // Nothing came back. The order may or may not exist: ask, don't place it again.
        setPhase({ kind: 'checking', gaveUp: false });
        void checkWhetherPlaced();
        return;
      }
      setPhase({ kind: 'compose' });
      if (code === 'QUOTE_STALE') {
        attempt.current = null;
        const fresh = staleQuoteOf(e);
        if (fresh && ready) {
          setStaleModal({ was: ready, now: fresh });
          setQuote({ kind: 'ready', quote: fresh, staleAt: quoteStaleAt(fresh, getNow()) });
          lastTotal.current = fresh.total_cents;
        } else if (cart && addressId && quoteTip !== null) {
          setPrevious(ready ? { quote: ready, why: 'stale' } : null);
          price(cart, addressId, quoteTip, false);
        }
      } else if (code === 'QUOTE_EXPIRED') {
        attempt.current = null;
        setPrevious(ready ? { quote: ready, why: 'expired' } : null);
        if (cart && addressId && quoteTip !== null) price(cart, addressId, quoteTip, false);
      } else if (code === 'ACTIVE_ORDER_EXISTS') {
        attempt.current = null;
        setRaceOrder(await getActiveOrder().catch(() => null));
        if (live.current) setActive((a) => a);
      } else {
        const block = blockOf(code);
        if (block) {
          attempt.current = null;
          setPlaceBlock(block);
        } else {
          setPlaceFailed(true);
        }
      }
    } finally {
      placing.current = false;
    }
  }, [ready, phase.kind, handover, savedPay, enterOrder, checkWhetherPlaced, cart, addressId, quoteTip, price]);

  /* ------------------------------------- an unpaid order: retry, wait, end */

  const order = phase.kind === 'order' ? phase.order : null;
  const deadlineAt = order?.deadline_at ? Date.parse(order.deadline_at) : null;

  // While the bank works on it, read the payment again until the server says where it landed.
  const processing = phase.kind === 'order' && phase.step.kind === 'processing';
  React.useEffect(() => {
    if (!processing || !order) return;
    let stop = false;
    const id = setTimeout(async () => {
      try {
        const p = await readPayment(order.id);
        if (stop || !live.current) return;
        const out = outcomeOfPayment(p, phase.kind === 'order' ? phase.secret : '');
        if (out && out.kind !== 'processing') apply(order, phase.kind === 'order' ? phase.secret : '', out);
        else setPhase((cur) => (cur.kind === 'order' ? { ...cur, order: { ...cur.order } } : cur));
      } catch {
        if (!stop && live.current) setPhase((cur) => (cur.kind === 'order' ? { ...cur, order: { ...cur.order } } : cur));
      }
    }, timing.pollMs);
    return () => {
      stop = true;
      clearTimeout(id);
    };
    // The order object is replaced on every look, which schedules the next one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processing, phase.kind === 'order' ? phase.order : null]);

  // The deadline passing is the server's to enforce; the page just looks again when it has.
  React.useEffect(() => {
    if (!order || deadlineAt === null || now < deadlineAt) return;
    let stop = false;
    void readOrder(order.id)
      .then((o) => {
        if (stop || !live.current) return;
        if (orderEnded(o)) setPhase({ kind: 'ended', order: o, cause: o.state === 'FAILED' ? 'failed' : cancelledByUs.current ? 'cancelled' : 'deadline' });
        else if (o.state !== 'CREATED') goToOrder(o.id);
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, order?.id]);

  const retry = React.useCallback(async () => {
    if (phase.kind !== 'order') return;
    // The customer may have paid another way meanwhile: take the server's word first.
    try {
      const o = await readOrder(phase.order.id);
      if (orderEnded(o)) {
        setPhase({ kind: 'ended', order: o, cause: o.state === 'FAILED' ? 'failed' : 'deadline' });
        return;
      }
    } catch {
      /* try the payment anyway */
    }
    await settle(phase.order, phase.secret);
  }, [phase, settle]);

  const cancelOrder = React.useCallback(
    async (input: { reason: Parameters<typeof cancelCheckoutOrder>[0]['reason']; note: string | null }) => {
      if (phase.kind !== 'order') return;
      setCancelling({ busy: true, failed: false });
      try {
        const o = await cancelCheckoutOrder({ orderId: phase.order.id, reason: input.reason, note: input.note, idempotencyKey: idempotencyKey() });
        if (!live.current) return;
        cancelledByUs.current = true;
        setCancelling(null);
        setPhase({ kind: 'ended', order: { ...phase.order, ...o }, cause: 'cancelled' });
      } catch (e) {
        if (!live.current) return;
        // The authorisation went through meanwhile: the order is on its way, not cancellable here.
        if (errorCodeOf(e) === 'CANCELLATION_WINDOW_CLOSED' || errorCodeOf(e) === 'ILLEGAL_TRANSITION') {
          setCancelling(null);
          goToOrder(phase.order.id);
          return;
        }
        setCancelling({ busy: false, failed: true });
      }
    },
    [phase, goToOrder],
  );

  /** "Put these items back in your cart": one add per line, each with its own key, none twice. */
  const putItemsBack = React.useCallback(
    async (ended: Order, replace: boolean) => {
      setPutBack({ kind: 'busy' });
      let first = true;
      for (const line of ended.lines) {
        if (putBackDone.current.has(line.line_no)) continue;
        let key = putBackKeys.current.get(line.line_no);
        if (!key) {
          key = idempotencyKey();
          putBackKeys.current.set(line.line_no, key);
        }
        try {
          await addCartLine(lineToInput(line), { idempotencyKey: key, replace: replace && first });
          putBackDone.current.add(line.line_no);
        } catch (e) {
          if (!live.current) return;
          const code = errorCodeOf(e);
          if (code === 'DIFFERENT_RESTAURANT') {
            const d = (e as { details?: { current_restaurant_name?: string; current_line_count?: number } }).details;
            setPutBack({ kind: 'replace', restaurant: d?.current_restaurant_name ?? null, count: d?.current_line_count ?? null });
            return;
          }
          if (isApiError(e) && e.status === 409) {
            // Sold out, removed or closed: that line is skipped and shows its own state in the cart.
            putBackDone.current.add(line.line_no);
          } else {
            setPutBack({ kind: 'failed' });
            return;
          }
        }
        first = false;
      }
      if (live.current) nav.replace({ name: 'cart' });
    },
    [nav],
  );

  /* -------------------------------------------------------------- render */

  const restaurantName = cart?.restaurant?.name ?? null;
  const heldUntil = deadlineAt !== null ? formatTime(deadlineAt) : null;

  const appBar = (opts: { onBack?: () => void; backLabel?: string; loading?: boolean } = {}) => (
    <AppBar
      tone="cream"
      title="Checkout"
      subtitle={restaurantName ?? undefined}
      isPageHeading={false}
      back={{ onPress: opts.onBack ?? nav.back, previousTitle: opts.backLabel ?? 'cart' }}
      backLabel={opts.backLabel ? `Back to ${opts.backLabel}` : 'Back to cart'}
      loading={opts.loading}
    />
  );

  if (load.kind === 'loading') {
    return (
      <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="Checkout-loading">
        {appBar({ loading: true })}
        <LoadingBody />
      </View>
    );
  }

  if (load.kind === 'error') {
    return (
      <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="Checkout-error">
        {appBar()}
        <View style={styles.centre}>
          <ErrorState
            variant="page"
            title="We couldn't load checkout"
            description="Nothing has been charged and your cart is saved. Try again, or go back to your cart."
            onRetry={reload}
            autoFocus
            action={{ label: 'Back to cart', onPress: nav.back, testID: 'Checkout-backToCart' }}
            testID="Checkout-errorState"
          />
        </View>
      </View>
    );
  }

  const { cart: c, asOf } = load;

  if (c.lines.length === 0 && phase.kind === 'compose') {
    return (
      <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="Checkout-empty">
        {appBar()}
        <View style={styles.centre}>
          <EmptyState
            variant="page"
            headingLevel={1}
            autoFocus
            illustration={<Icon name="cart" size={48} color={theme.color.text.secondary} />}
            title="Your cart is empty"
            description="Add dishes from a certified restaurant to check out."
            primaryAction={{ label: 'Find a restaurant', onPress: () => nav.open({ name: 'home' }), testID: 'Checkout-findRestaurant' }}
          />
        </View>
      </View>
    );
  }

  /* The order is over: nothing was charged. */
  if (phase.kind === 'ended') {
    const { cause } = phase;
    const title = cause === 'cancelled' ? 'Order cancelled' : 'This order was cancelled';
    const body =
      cause === 'cancelled'
        ? 'Nothing was charged and nothing is held on your card.'
        : cause === 'failed'
          ? "The payment didn't go through. Nothing was charged. Check with your bank, or place a new order with another way to pay."
          : "The payment wasn't completed within 15 minutes. Nothing was charged.";
    return (
      <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID={`Checkout-ended-${cause}`}>
        {appBar({ onBack: () => nav.open({ name: 'home' }), backLabel: restaurantName ?? 'the menu' })}
        <View style={styles.centre}>
          <EmptyState
            variant="page"
            headingLevel={1}
            autoFocus
            illustration={<Icon name="info" size={48} color={theme.color.text.secondary} />}
            title={title}
            description={`${body} You can put the same items back in your cart. We'll check each one and its price again.`}
          />
          {putBack.kind === 'failed' ? (
            <Banner variant="warning" title="We couldn't put your items back" description="Check your connection and try again." testID="Checkout-putBackFailed" />
          ) : null}
          <View style={styles.stack}>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              loading={putBack.kind === 'busy'}
              iconStart={<Icon name={putBack.kind === 'failed' ? 'refresh' : 'cart'} size={20} color={theme.color.text.onBrand} />}
              onPress={() => void putItemsBack(phase.order, false)}
              testID="Checkout-putBack"
            >
              {putBack.kind === 'busy' ? 'Putting your items back' : putBack.kind === 'failed' ? 'Try again' : 'Put these items back in your cart'}
            </Button>
            <Button variant="tertiary" size="md" fullWidth disabled={putBack.kind === 'busy'} onPress={() => nav.open({ name: 'home' })} testID="Checkout-backToMenu">
              {restaurantName ? `Back to ${restaurantName}'s menu` : 'Find a restaurant'}
            </Button>
          </View>
        </View>
        <Modal
          open={putBack.kind === 'replace'}
          onClose={() => setPutBack({ kind: 'idle' })}
          variant="confirm"
          destructive
          title={putBack.kind === 'replace' && putBack.restaurant ? `Your cart has items from ${putBack.restaurant}` : 'Your cart has items from another restaurant'}
          description={`${putBack.kind === 'replace' && putBack.count ? `Your cart has ${putBack.count} item${putBack.count === 1 ? '' : 's'}${putBack.restaurant ? ` from ${putBack.restaurant}` : ''}. ` : ''}A cart holds one restaurant at a time, so putting these items back replaces them.`}
          actions={[
            { label: 'Keep my cart', onPress: () => setPutBack({ kind: 'idle' }), testID: 'Checkout-keepCart' },
            { label: 'Replace them', destructive: true, onPress: () => void putItemsBack(phase.order, true), testID: 'Checkout-replaceCart' },
          ]}
          testID="Checkout-replaceDialog"
        />
      </View>
    );
  }

  /* The order exists and isn't paid: recover the payment. */
  if (phase.kind === 'order') {
    const { step } = phase;
    const decline = step.kind === 'declined' ? declineCopy(step.failureCode) : null;
    const busy = step.kind === 'confirming';
    const heldLine = heldUntil ? `Order held until ${heldUntil}.` : null;
    const payName = selectedCard ? cardName(selectedCard) : 'Card or wallet';
    return (
      <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID={`Checkout-order-${step.kind}`}>
        {appBar({ onBack: () => setCancelling({ busy: false, failed: false }), backLabel: restaurantName ?? 'the menu', loading: busy })}
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {step.kind === 'declined' ? (
            <Banner variant="neutral" icon={<Icon name="error" size={22} color={theme.color.text.secondary} />} title={decline!.title} description={decline!.body} testID="Checkout-declined" />
          ) : step.kind === 'closed' ? (
            <Banner variant="neutral" icon={<Icon name="info" size={22} color={theme.color.text.secondary} />} title="The payment sheet was closed" description={`Nothing was charged.${heldUntil ? ` Try again before ${heldUntil}, or cancel the order.` : ' Try again, or cancel the order.'}`} testID="Checkout-closed" />
          ) : step.kind === 'bank' ? (
            <Banner variant="info" icon={<Icon name="lock" size={22} color={theme.color.text.secondary} />} title="Your bank needs to confirm this payment" description="A secure page from your bank opens next. If it isn't confirmed in time, the order is cancelled and nothing is charged." testID="Checkout-bank" />
          ) : step.kind === 'processing' ? (
            <Banner variant="info" icon={<Icon name="clock" size={22} color={theme.color.text.secondary} />} title="Your bank is still processing the payment" description="This usually takes a few seconds. Please keep the app open; you won't be charged twice." testID="Checkout-processing" />
          ) : step.kind === 'unavailable' ? (
            <Banner variant="neutral" icon={<Icon name="info" size={22} color={theme.color.text.secondary} />} title="Card payments aren't available right now" description={`${step.message} Nothing was charged.`} testID="Checkout-payUnavailable" />
          ) : null}

          {heldLine ? (
            <Text style={[small, { color: theme.color.text.secondary }]} testID="Checkout-held">
              {`${heldLine} After that the order is cancelled and nothing is charged.`}
            </Text>
          ) : null}

          <Card variant="outlined" padding={16}>
            <ListRow
              title="Pay with"
              subline={step.kind === 'declined' ? `${payName} · Declined` : step.kind === 'bank' ? `${payName} · Confirming with your bank` : payName}
              icon="lock"
              height={64}
              testID="Checkout-payRow"
            />
          </Card>

          <Card variant="outlined" padding={16} testID="Checkout-orderSummary">
            <View style={styles.stack}>
              <Text accessibilityRole="header" style={[heading, { color: theme.color.text.primary }]}>
                Your order
              </Text>
              {phase.order.lines.map((l) => (
                <View key={l.line_no} style={styles.lineRow}>
                  <Text style={[bodyType, styles.shrink, { color: theme.color.text.primary }]}>{`${l.quantity}× ${l.name}`}</Text>
                  <Price cents={l.line_total_cents} size="sm" />
                </View>
              ))}
              {phase.order.money ? (
                <View style={styles.rows}>
                  <Row label="Items subtotal" value={phase.order.money.subtotal_cents} />
                  <Row label="Delivery fee" value={phase.order.money.delivery_fee_cents} />
                  <Row label="Service fee" value={phase.order.money.service_fee_cents} />
                  {(phase.order.money.tax_lines ?? []).map((t, i) => (
                    <Row key={`${t.statutory_label}-${i}`} label={t.statutory_label} value={t.amount_cents} />
                  ))}
                  {phase.order.money.tip_cents !== 0 ? <Row label="Tip for your rider" value={phase.order.money.tip_cents} /> : null}
                  <Row label="Total" value={phase.order.money.total_cents} total testID="Checkout-orderTotal" />
                </View>
              ) : null}
            </View>
          </Card>
        </ScrollView>

        <Footer>
          {step.kind === 'processing' ? (
            <Button variant="primary" size="lg" fullWidth loading disabled testID="Checkout-waiting">
              Waiting for your bank
            </Button>
          ) : (
            <>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                loading={busy}
                disabled={step.kind === 'unavailable'}
                iconStart={<Icon name="lock" size={20} color={theme.color.text.onBrand} />}
                onPress={() => void retry()}
                testID="Checkout-retry"
              >
                {step.kind === 'bank' ? 'Confirm with your bank' : step.kind === 'declined' ? 'Try this card again' : 'Try payment again'}
              </Button>
              {step.kind === 'declined' || step.kind === 'closed' ? (
                <Button variant="tertiary" size="md" fullWidth onPress={() => void retry()} testID="Checkout-anotherWay">
                  Use another way to pay
                </Button>
              ) : null}
              <Button variant="tertiary" size="md" fullWidth destructive disabled={busy} onPress={() => setCancelling({ busy: false, failed: false })} testID="Checkout-cancelOrder">
                Cancel order
              </Button>
            </>
          )}
          <Text style={[small, { color: theme.color.text.secondary }]}>You are charged only when the restaurant accepts.</Text>
        </Footer>

        {cancelling ? (
          <CancelDialog
            busy={cancelling.busy}
            failed={cancelling.failed}
            heldUntil={heldUntil}
            onKeep={() => setCancelling(null)}
            onCancel={(draft) => void cancelOrder(draft)}
          />
        ) : null}
      </View>
    );
  }

  /* ----------------------------------------------------- composing the order */

  const block: Block | null = placeBlock ?? (quote.kind === 'failed' ? blockOf(quote.code) : null) ?? baseBlock;
  const activeOrder = state?.kind === 'activeOrder' ? state.order : null;
  const quoteFailed = quote.kind === 'failed' && !quote.tip && !blockOf(quote.code) && online;
  const lastKnown = !online && addressId ? lastQuote(quoteKeyFor(c, addressId)) : null;
  const shown: Quote | null = ready ?? lastKnown;
  const pricing = quote.kind === 'loading';
  const total = shown?.total_cents ?? null;
  const placingNow = phase.kind === 'placing';
  const cardExpiredNow = selectedCard ? cardExpired(selectedCard, now) : false;

  // Why Place order is off, in words, most serious first.
  let reason: string | null = null;
  if (!online) reason = OFFLINE_PLACE;
  else if (lapsed) reason = null;
  else if (activeOrder) reason = `You can place another order once ${activeOrder.code} is delivered.`;
  else if (block) reason = null;
  else if (!addressId) reason = 'Choose a delivery address to place your order.';
  else if (tipCents === null) reason = 'Fix the tip amount or choose a preset.';
  else if (tipError) reason = 'Fix the tip amount or choose a preset.';
  else if (cardExpiredNow) reason = 'This card has expired. Choose another way to pay.';
  else if (quote.kind === 'failed' && !quote.tip) reason = null;
  const canPlace = Boolean(ready) && online && !block && !lapsed && !activeOrder && !cardExpiredNow && tipCents !== null && ready?.tip_cents === tipCents && !tipError && addressId !== null && !pricing && !placingNow;

  const blockCopy = block ? blockText(block, c, now, address) : null;
  const findAnother = () => nav.open({ name: 'home' });
  const backToCart = () => nav.back();

  const blockAction: { label: string; icon?: 'plus' | 'map' | 'back' | 'search' | 'refresh' | 'cart'; onPress: () => void; testID: string } | null = (() => {
    switch (block) {
      case 'belowMinimum':
        return { label: 'Add more items', icon: 'plus', onPress: () => nav.push({ name: 'restaurant', restaurantId: c.restaurant?.id ?? '' }), testID: 'Checkout-addMore' };
      case 'restaurantClosed':
      case 'orderingPaused':
        return { label: 'Back to cart', icon: 'back', onPress: backToCart, testID: 'Checkout-backToCart' };
      case 'linesUnavailable':
        return { label: 'Review cart', onPress: backToCart, testID: 'Checkout-reviewCart' };
      case 'province':
      case 'outOfRange':
        return { label: 'Change address', icon: 'map', onPress: () => setSheet('address'), testID: 'Checkout-changeAddress' };
      case 'taxProfile':
        return { label: 'Back to cart', icon: 'back', onPress: backToCart, testID: 'Checkout-backToCart' };
      case 'profileIncomplete':
        return { label: 'Finish my profile', onPress: () => setSheet('profile'), testID: 'Checkout-finishProfile' };
      case 'rateLimited':
        return { label: 'Try again', icon: 'refresh', onPress: () => retryQuote(), testID: 'Checkout-retryQuote' };
      case 'restaurantUnavailable':
        return { label: 'Find another restaurant', icon: 'search', onPress: findAnother, testID: 'Checkout-findAnother' };
      default:
        return null;
    }
  })();

  function retryQuote(): void {
    setPlaceBlock(null);
    if (cart && addressId && quoteTip !== null) price(cart, addressId, quoteTip, false);
  }

  // Nothing about the order can be priced: no address, out of range, or a block that stops the quote.
  const noPrice = !shown && !pricing && (block === 'outOfRange' || block === 'province' || !addressId);

  return (
    <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="Checkout">
      {appBar({ loading: pricing || placingNow })}

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {!online ? (
          <Banner
            variant="warning"
            title="You're offline"
            description="Your order isn't placed yet. We'll price it again when you're back online, then you can place it."
            testID="Checkout-offline"
          />
        ) : null}

        {activeOrder ? (
          <Banner
            variant="info"
            icon={<Icon name="orders" size={22} color={theme.color.text.secondary} />}
            title="You already have an order on the way"
            description={`${activeOrderSentence(activeOrder)} Your cart is saved.`}
            action={{ label: 'View order', onPress: () => nav.push({ name: 'tracking', orderId: activeOrder.id }), testID: 'Checkout-viewOrder' }}
            testID="Checkout-activeOrder"
          />
        ) : null}

        {lapsed ? (
          <Banner
            variant="neutral"
            title={`${restaurantName ?? 'This restaurant'}'s halal certificate isn't current, so we can't take this order.`}
            description="Nothing was charged. If the certificate is renewed, your cart will be here."
            testID="Checkout-certLapsed"
          />
        ) : blockCopy ? (
          <Banner variant="neutral" icon={<Icon name="info" size={22} color={theme.color.text.secondary} />} title={blockCopy.title} description={blockCopy.description} testID={`Checkout-block-${block}`} />
        ) : null}

        {previous && ready && changed.length > 0 && previous.quote.id !== ready.id ? (
          <Banner
            variant="info"
            icon={<Icon name="refresh" size={22} color={theme.color.text.secondary} />}
            title="Prices updated"
            description={`${previous.why === 'expired' ? 'Your price hold ran out, so we priced the order again. ' : 'The price changed while you were placing the order. '}Check the total before you place the order.`}
            testID="Checkout-pricesUpdated"
          />
        ) : null}

        {placeFailed ? (
          <Banner variant="warning" title="We couldn't place your order" description="Nothing was charged. Try again." testID="Checkout-placeFailed" />
        ) : null}

        {quoteFailed && !block ? (
          <ErrorState
            variant="inline"
            title="We couldn't price this order"
            description="Nothing has been charged and your cart is saved. Try again, or go back to your cart."
            onRetry={retryQuote}
            action={{ label: 'Back to cart', onPress: backToCart, testID: 'Checkout-backToCart' }}
            testID="Checkout-quoteError"
          />
        ) : null}

        <RestaurantHeader cart={c} online={online} asOf={asOf} now={now} />

        <Card variant="outlined" padding={16} testID="Checkout-deliver">
          <View style={styles.stack}>
            <Text accessibilityRole="header" style={[heading, { color: theme.color.text.primary }]}>
              Deliver to
            </Text>
            <ListRow
              title={address ? addressTitle(address) : 'Choose a delivery address'}
              subline={address ? addressDetail(address) : undefined}
              icon="map"
              value="Change"
              height={64}
              onPress={() => setSheet('address')}
              testID="Checkout-addressRow"
            />
            <ListRow
              title={handoverLabel(handover)}
              subline={handover.note.trim() ? `Notes: ${handover.note.trim()}` : undefined}
              icon="profile"
              value="Change"
              height={64}
              onPress={() => setSheet('handover')}
              testID="Checkout-handoverRow"
            />
          </View>
        </Card>

        <Card variant="outlined" padding={16} testID="Checkout-payCard">
          <View style={styles.stack}>
            <Text accessibilityRole="header" style={[heading, { color: theme.color.text.primary }]}>
              Pay with
            </Text>
            <ListRow
              title={selectedCard ? cardName(selectedCard) : 'New card or wallet'}
              subline={selectedCard ? `${cardExpiredNow ? 'Expired' : 'Expires'} ${cardExpiry(selectedCard)}` : "Stripe's secure sheet opens when you place the order."}
              icon="lock"
              value={cardExpiredNow ? 'Choose' : 'Change'}
              height={64}
              onPress={() => setSheet('pay')}
              testID="Checkout-payRow"
            />
            {cardExpiredNow ? (
              <Banner variant="warning" title="This card has expired" description="Choose another way to pay. Nothing has been charged." testID="Checkout-cardExpired" />
            ) : null}
          </View>
        </Card>

        <TipCard
          choice={tip}
          disabled={placingNow || !online}
          error={tipError ?? (tip.kind === 'other' && tip.text.trim() !== '' && tipCents === null ? TIP_NOT_AN_AMOUNT : null)}
          onChoice={(next) => {
            setTipError(null);
            setTip(next);
          }}
        />

        {noPrice ? (
          <Card variant="outlined" padding={16} testID="Checkout-noPrice">
            <View style={styles.stack}>
              <Text accessibilityRole="header" style={[heading, { color: theme.color.text.primary }]}>
                Your order
              </Text>
              <Text style={[bodyType, { color: theme.color.text.secondary }]}>
                {`We'll price your order once you choose an address ${restaurantName ?? 'the restaurant'} delivers to.`}
              </Text>
            </View>
          </Card>
        ) : pricing && !shown ? (
          <Card variant="outlined" padding={16} testID="Checkout-pricing">
            <View style={styles.stack}>
              <Text accessibilityLiveRegion="polite" style={[small, { color: theme.color.text.secondary }]}>
                {`Pricing your order for ${addressName(address) ?? 'your address'}…`}
              </Text>
              <QuotingSkeleton />
            </View>
          </Card>
        ) : (
          <OrderCard quote={shown} loading={pricing} changed={changed} note={null} />
        )}
      </ScrollView>

      <Footer>
        {shown && ready ? (
          <Text style={[small, { color: theme.color.text.secondary }]} testID="Checkout-hold">
            {`Price held until ${formatTime(quote.kind === 'ready' ? quote.staleAt : now)}. This is the amount we'll charge.`}
          </Text>
        ) : lastKnown ? (
          <Text style={[small, { color: theme.color.text.secondary }]} testID="Checkout-lastPrice">
            {`Last price, as of ${formatTime(asOf)}. It is checked again before you pay.`}
          </Text>
        ) : null}
        {reason ? (
          <Text style={[bodyType, { color: theme.color.text.primary }]} testID="Checkout-reason">
            {reason}
          </Text>
        ) : null}

        {blockAction && !lapsed ? (
          <Button
            variant="primary"
            size="lg"
            fullWidth
            iconStart={blockAction.icon ? <Icon name={blockAction.icon} size={20} color={theme.color.text.onBrand} /> : undefined}
            onPress={blockAction.onPress}
            testID={blockAction.testID}
          >
            {blockAction.label}
          </Button>
        ) : lapsed ? (
          <>
            <Button variant="primary" size="lg" fullWidth iconStart={<Icon name="search" size={20} color={theme.color.text.onBrand} />} onPress={findAnother} testID="Checkout-findAnother">
              Find another restaurant
            </Button>
            <Button variant="ghost" size="md" fullWidth onPress={backToCart} testID="Checkout-backToCart">
              Back to cart
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={placingNow || pricing}
            disabled={!canPlace}
            iconStart={<Icon name="lock" size={20} color={theme.color.text.onBrand} />}
            accessibilityLabel={placeA11yLabel('Place order', total)}
            accessibilityHint={reason ?? undefined}
            onPress={() => void place()}
            testID="Checkout-place"
          >
            {placeLabel('Place order', total)}
          </Button>
        )}
        {blockAction && block === 'taxProfile' ? (
          <Button variant="tertiary" size="md" fullWidth iconStart={<Icon name="refresh" size={20} color={theme.color.text.primary} />} onPress={retryQuote} testID="Checkout-retryQuote">
            Try again
          </Button>
        ) : null}
        {!blockAction && !lapsed ? (
          <Text style={[small, { color: theme.color.text.secondary }]}>
            {selectedCard || pay === undefined ? 'Your card is authorised now and charged only when the restaurant accepts.' : 'You are charged only when the restaurant accepts.'}
          </Text>
        ) : null}
      </Footer>

      {sheet === 'address' ? (
        <AddressSheet
          addresses={addresses}
          selectedId={addressId}
          onPick={(id) => {
            setPlaceBlock(null);
            setPrevious(null);
            setAddressId(id);
          }}
          onAdd={() => {
            setSheet(null);
            nav.push({ name: 'addressForm', addressId: null });
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet === 'handover' ? (
        <HandoverSheet
          value={handover}
          onDone={(next) => {
            setHandover(next);
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet === 'pay' ? (
        <PaySheet
          cards={cards}
          now={now}
          value={savedPay}
          onDone={(next) => {
            setPay(next);
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet === 'profile' ? (
        <FinishProfileSheet
          onSaved={() => {
            setSheet(null);
            setPlaceBlock(null);
            if (cart && addressId && quoteTip !== null) price(cart, addressId, quoteTip, false);
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {/* The server re-priced at placing: show what changed, both figures from the server. */}
      <Modal
        open={staleModal !== null}
        onClose={() => setStaleModal(null)}
        variant="dialog"
        title="The price changed"
        description="It changed while you were placing the order. Nothing has been charged."
        actions={[
          { label: 'Review my order', onPress: () => setStaleModal(null), testID: 'Checkout-reviewOrder' },
          {
            label: staleModal ? placeLabel('Place order', staleModal.now.total_cents) : 'Place order',
            testID: 'Checkout-placeNew',
            onPress: () => {
              setPrevious(staleModal ? { quote: staleModal.was, why: 'stale' } : null);
              setStaleModal(null);
              setTimeout(() => void place(), 0);
            },
          },
        ]}
        testID="Checkout-staleDialog"
      >
        {staleModal ? (
          <View style={styles.stack}>
            {changedRows(staleModal.was, staleModal.now).map((r) => (
              <Row key={r.label} label={r.label} value={r.now} was={r.was} total={r.label === 'Total'} />
            ))}
          </View>
        ) : null}
      </Modal>

      <Modal
        open={raceOrder !== null}
        onClose={() => setRaceOrder(null)}
        variant="confirm"
        title="You already have an order on the way"
        description={raceOrder ? `${activeOrderSentence(raceOrder)} Your cart is saved.` : undefined}
        actions={[
          { label: 'Stay here', onPress: () => setRaceOrder(null), testID: 'Checkout-stayHere' },
          {
            label: 'View order',
            testID: 'Checkout-raceView',
            onPress: () => {
              const o = raceOrder;
              setRaceOrder(null);
              if (o) nav.push({ name: 'tracking', orderId: o.id });
            },
          },
        ]}
        testID="Checkout-raceDialog"
      />

      <Modal
        open={phase.kind === 'placing' && phase.duplicate}
        onClose={() => undefined}
        variant="dialog"
        dismissible={false}
        title="Your order is already being placed"
        description="We got your first tap. Please wait; you won't be charged twice."
        testID="Checkout-duplicateDialog"
      >
        <Spinner label="Still placing" />
      </Modal>

      <Modal
        open={phase.kind === 'checking'}
        onClose={() => undefined}
        variant="dialog"
        dismissible={false}
        title="Checking whether your order went through"
        description="The connection dropped while we were placing it. Please don't place it again; we're checking with our server."
        actions={
          phase.kind === 'checking' && phase.gaveUp
            ? [
                { label: 'Go to my orders', onPress: () => nav.open({ name: 'orders' }), testID: 'Checkout-goToOrders' },
                {
                  label: 'Try again',
                  onPress: () => {
                    setPhase({ kind: 'compose' });
                  },
                  testID: 'Checkout-checkAgain',
                },
              ]
            : []
        }
        testID="Checkout-checkingDialog"
      >
        {phase.kind === 'checking' && !phase.gaveUp ? (
          <Text style={[bodyType, { color: theme.color.text.secondary }]}>
            Still checking… If it went through, you'll go straight to your order. If it didn't, you can try again and you won't be charged twice.
          </Text>
        ) : (
          <Text style={[bodyType, { color: theme.color.text.secondary }]}>
            We couldn't reach our server. If it didn't go through, you can try again and you won't be charged twice.
          </Text>
        )}
      </Modal>
    </View>
  );
}

/** What each refusal says, and what the customer can do. Nothing is charged by any of them. */
function blockText(block: Block, cart: Cart, now: number, address: Address | null): { title: string; description: string } {
  const name = cart.restaurant?.name ?? 'This restaurant';
  const min = safeCents(cart.restaurant?.availability?.minimum_order_cents);
  switch (block) {
    case 'belowMinimum':
      return {
        title: 'Below the minimum order',
        description: min !== null ? `The minimum order at ${name} is ${formatPrice(min)}. Add more items to check out.` : `${name} has a minimum order. Add more items to check out.`,
      };
    case 'restaurantClosed': {
      const until = closedUntil(opensPhrase(cart.restaurant?.availability?.opens_at, now));
      return { title: `${name} just closed`, description: `${until ? `${until} ` : ''}Your cart is saved and nothing was charged.` };
    }
    case 'restaurantUnavailable':
      return { title: `${name} can't take orders right now`, description: 'Your cart is saved and nothing was charged.' };
    case 'linesUnavailable':
      return { title: 'Something in your cart ran out', description: 'Remove it or change it in your cart to continue. Nothing was charged.' };
    case 'province':
      return { title: 'We deliver in Ontario only for now', description: 'Choose an Ontario address to place this order.' };
    case 'outOfRange':
      return {
        title: `${name} doesn't deliver to ${addressName(address) ?? 'this address'}`,
        description: `${address ? `${address.line1} is outside its delivery area. ` : ''}Choose another address to see a price.`,
      };
    case 'taxProfile':
      return { title: "We can't price this order right now", description: 'This is on our side and nothing was charged. Your cart is saved.' };
    case 'profileIncomplete':
      return { title: 'Finish your profile to order', description: 'Add your name and email to place your first order.' };
    case 'orderingPaused':
      return { title: 'New orders are paused right now', description: 'Nothing was charged and your cart is saved. Try again in a little while.' };
    case 'rateLimited':
      return { title: 'Too many tries', description: 'Wait a moment, then try again. Nothing was charged.' };
  }
}

// Exported for the tests that pin the state set.
export type { Phase, Step };
