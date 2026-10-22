/**
 * The card the customer picked while recovering a payment, kept until the next checkout reads it.
 *
 * Recovering an unpaid order ends with the order cancelled and its items back in the cart; the card
 * picked on the way is "chosen when you pay" at the next checkout. It is held in memory only: the
 * customer app has no persistent storage and adding a native module is a build decision (the same
 * constraint as the What's new store). So it survives going between screens, not closing the app;
 * checkout then falls back to the default card, as it does for any order.
 *
 * `undefined` means nothing was picked (checkout uses its default). `null` means "a new card or
 * wallet" (checkout sends no `payment_method_id`). A string is a saved card's id.
 */
import type { PayChoice } from './Sheets';

let picked: PayChoice | undefined;

/** Remembers the card picked for the next checkout. */
export function rememberNextCard(choice: PayChoice): void {
  picked = choice;
}

/** The remembered card, without forgetting it (safe to call twice while a screen initialises). */
export function peekNextCard(): PayChoice | undefined {
  return picked;
}

/** Forgets the remembered card, so a later checkout is not pinned to it. */
export function clearNextCard(): void {
  picked = undefined;
}
