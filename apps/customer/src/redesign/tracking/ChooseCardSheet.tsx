/**
 * The "Choose another card" sheet (the `Payment-ChooseCard*` boards of the customer redesign, issue
 * #921 under the redesign tracker #656).
 *
 * The contract cannot retry a payment on the same order with another card, so choosing a card here is
 * the first step of ordering again, not a payment:
 * - **Live** (the order is still unpaid and waiting): the primary is "Cancel and
 *   order again from {restaurant}". Pressing it only hands the chosen card to the caller, which opens
 *   the cancel sheet; nothing is cancelled by opening this sheet or by choosing a card.
 * - **Terminal** (the order already ended unpaid): the primary is "Put these items back in your cart".
 *   Nothing is cancelled and nothing is charged.
 *
 * Saved cards are the display fields only (brand, last four, expiry). The card that was declined is
 * listed last and never pre-chosen, and an expired card cannot be chosen. No amount is shown: checkout
 * prices the order again. Adding a card in this sheet needs the card-setup flow (issue #923), so "New
 * card or wallet" is an ordinary choice instead: Stripe's own sheet opens at checkout, as it does there.
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Banner, Button, Radio, RadioGroup, Sheet, Skeleton, useTheme, useTypeStyle } from '../ds';
import { listSavedCards, type PaymentMethod } from '../checkout/checkoutApi';
import { cardExpired, cardExpiry, cardName } from '../checkout/model';
import type { PayChoice } from '../checkout/Sheets';
import { useQuery } from '../lib/query';
import { useNow } from '../lib/now';

const NEW = '__new__';

/** The fixed words in the card sheet. */
export const CHOOSE_CARD_COPY = {
  titleLive: 'Choose another card',
  titleTerminal: 'Choose a card',
  intro: "We'll put your items back in your cart and check the price again before you pay.",
  payWith: 'Pay with',
  newCard: 'New card or wallet',
  newCardDescription: "Stripe's secure sheet opens when you pay. Apple Pay and Google Pay appear there when your device has them.",
  empty: 'You have no other saved card. You can use a new card or a wallet when you pay again.',
  errorTitle: "We couldn't load your saved cards",
  errorBody: "Check your connection and try again. Your order hasn't changed.",
  tryAgain: 'Try again',
  notNow: 'Not now',
  putBack: 'Put these items back in your cart',
  puttingBack: 'Putting your items back',
  terminalNote: 'Nothing was charged for this order.',
} as const;

/** What the card sheet needs from its caller. */
export interface ChooseCardSheetProps {
  variant: 'live' | 'terminal';
  open: boolean;
  restaurantName: string;
  /** The card that was declined (the payment record's display fields), or null when not known. */
  declined: { brand: string | null; last4: string | null } | null;
  onClose: () => void;
  /**
   * The primary was pressed with this choice (a saved card's id, or null for a new card or wallet)
   * and the words for it ("Mastercard •••• 5100", "A new card or wallet").
   */
  onConfirm: (choice: PayChoice, label: string) => void;
  /** The terminal primary is putting the items back. */
  busy?: boolean;
}

const sameCard = (c: PaymentMethod, d: ChooseCardSheetProps['declined']): boolean =>
  d !== null && d.last4 === c.last4 && (d.brand ?? '').toLowerCase() === c.brand.toLowerCase();

/** The "Choose another card" sheet, in its live (cancel and order again) and terminal (put the items back) forms. */
export function ChooseCardSheet({ variant, open, restaurantName, declined, onClose, onConfirm, busy = false }: ChooseCardSheetProps): React.ReactElement {
  const theme = useTheme();
  const body = useTypeStyle('body.md');
  const small = useTypeStyle('body.sm');
  const now = useNow(60_000);
  const { query, reload } = useQuery<PaymentMethod[]>(listSavedCards, [], { enabled: open });
  const cards = query.kind === 'ready' ? query.data : [];

  // Other cards first, the declined one last; an expired card is shown and cannot be chosen.
  const ordered = React.useMemo(() => [...cards.filter((c) => !sameCard(c, declined)), ...cards.filter((c) => sameCard(c, declined))], [cards, declined]);
  const usableOthers = cards.filter((c) => !sameCard(c, declined) && !cardExpired(c, now));
  const noOthers = query.kind === 'ready' && usableOthers.length === 0;
  const listed = noOthers ? [] : ordered;

  const [choice, setChoice] = React.useState<string | null>(null);
  // The first other card is chosen once the list arrives; the declined card is never pre-chosen.
  const firstOther = usableOthers[0]?.id ?? null;
  const chosen = choice ?? firstOther ?? NEW;
  const chosenCard = chosen === NEW ? null : (cards.find((c) => c.id === chosen) ?? null);
  const chosenLabel = chosenCard ? cardName(chosenCard) : 'A new card or wallet';
  React.useEffect(() => {
    if (open) setChoice(null);
  }, [open]);

  const terminal = variant === 'terminal';
  const ready = query.kind === 'ready';

  return (
    <Sheet
      open={open}
      title={terminal ? CHOOSE_CARD_COPY.titleTerminal : CHOOSE_CARD_COPY.titleLive}
      onClose={() => (busy ? undefined : onClose())}
      dismissible={!busy}
      testID="ChooseCard-sheet"
    >
      <View style={styles.sheet}>
        <Text style={[body, { color: theme.color.text.secondary }]}>{CHOOSE_CARD_COPY.intro}</Text>

        {query.kind === 'loading' ? (
          <View testID="ChooseCard-loading" accessibilityLabel="Loading your saved cards" aria-busy>
            <Skeleton variant="text" lines={3} />
          </View>
        ) : null}

        {query.kind === 'error' ? (
          <View style={styles.gap12} testID="ChooseCard-error">
            <Banner variant="warning" title={CHOOSE_CARD_COPY.errorTitle} description={CHOOSE_CARD_COPY.errorBody} />
            <Button variant="tertiary" size="md" fullWidth onPress={reload} testID="ChooseCard-retry">
              {CHOOSE_CARD_COPY.tryAgain}
            </Button>
          </View>
        ) : null}

        {noOthers ? (
          <Text style={[body, { color: theme.color.text.primary }]} testID="ChooseCard-empty">
            {CHOOSE_CARD_COPY.empty}
          </Text>
        ) : null}

        {ready ? (
          <RadioGroup
            name="choose-card"
            label={CHOOSE_CARD_COPY.payWith}
            required
            value={chosen}
            disabled={busy}
            onChange={(v) => setChoice(String(v))}
            testID="ChooseCard-list"
          >
            {listed.map((c) => {
              const expired = cardExpired(c, now);
              return (
                <Radio
                  key={c.id}
                  value={c.id}
                  label={cardName(c)}
                  description={`${expired ? 'Expired' : 'Expires'} ${cardExpiry(c)}`}
                  disabled={expired}
                  disabledReason={expired ? 'This card has expired.' : undefined}
                  testID={`ChooseCard-card-${c.id}`}
                />
              );
            })}
            <Radio value={NEW} label={CHOOSE_CARD_COPY.newCard} description={CHOOSE_CARD_COPY.newCardDescription} testID="ChooseCard-new" />
          </RadioGroup>
        ) : null}

        {ready ? (
          <View style={styles.gap8}>
            {terminal ? (
              <Button
                variant="primary"
                size="lg"
                fullWidth
                loading={busy}
                onPress={() => onConfirm(chosenCard ? chosenCard.id : null, chosenLabel)}
                testID="ChooseCard-confirm"
              >
                {busy ? CHOOSE_CARD_COPY.puttingBack : CHOOSE_CARD_COPY.putBack}
              </Button>
            ) : (
              <Button
                variant="danger"
                size="lg"
                fullWidth
                destructive
                onPress={() => onConfirm(chosenCard ? chosenCard.id : null, chosenLabel)}
                testID="ChooseCard-confirm"
              >
                {`Cancel and order again from ${restaurantName}`}
              </Button>
            )}
            <Text style={[small, { color: theme.color.text.secondary }]} testID="ChooseCard-consequence">
              {terminal
                ? CHOOSE_CARD_COPY.terminalNote
                : `This cancels this order. Nothing is charged. ${chosenLabel} is chosen when you pay.`}
            </Text>
          </View>
        ) : null}

        <Button variant="ghost" size="md" fullWidth disabled={busy} onPress={onClose} testID="ChooseCard-notNow">
          {CHOOSE_CARD_COPY.notNow}
        </Button>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  sheet: { gap: 16, paddingHorizontal: 16, paddingBottom: 16 },
  gap8: { gap: 8 },
  gap12: { gap: 12 },
});
