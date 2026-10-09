/**
 * A quote or order refused with `409 RESTAURANT_CLOSED` reads by the cart's restaurant card: a
 * PAUSED restaurant (paused, switch off or order screen offline) is "temporarily not accepting
 * orders", one outside its hours "just closed" (owner decision 2026-10-09).
 */
import { checkoutProblem } from '../lines';

describe('checkoutProblem — RESTAURANT_CLOSED', () => {
  it('says a paused restaurant is temporarily not accepting orders', () => {
    expect(checkoutProblem('RESTAURANT_CLOSED', 'Zaatar House', 'place', 'PAUSED')).toEqual({
      title: 'Zaatar House is temporarily not accepting orders',
      body: 'Please try again later. Your cart is saved and nothing was charged.',
      action: 'cart',
    });
  });

  it('keeps "just closed" outside its hours or when the state is unknown', () => {
    expect(
      checkoutProblem('RESTAURANT_CLOSED', 'Zaatar House', 'quote', 'CLOSED_HOURS').title,
    ).toBe('Zaatar House just closed');
    expect(checkoutProblem('RESTAURANT_CLOSED', 'Zaatar House').title).toBe(
      'Zaatar House just closed',
    );
  });
});
