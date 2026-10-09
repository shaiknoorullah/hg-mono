/**
 * A refused add at a restaurant that is not open now (`409 RESTAURANT_CLOSED`) reads by what the
 * customer last saw: a PAUSED restaurant (paused, switch off or order screen offline) is
 * "temporarily not accepting orders", one outside its hours "just closed" (owner, 2026-10-09).
 */
import { failureCopy } from '../addErrors';

describe('failureCopy — restaurantClosed', () => {
  const ctx = { itemName: 'Chicken shawarma', restaurantName: 'Zaatar House' };

  it('says a paused restaurant is temporarily not accepting orders', () => {
    expect(
      failureCopy({ kind: 'restaurantClosed' }, { ...ctx, availabilityState: 'PAUSED' }),
    ).toEqual({
      icon: 'clock',
      title: 'Zaatar House is temporarily not accepting orders',
      body: "Please try again later. Nothing was added and your cart hasn't changed.",
    });
  });

  it('keeps "just closed" otherwise', () => {
    expect(
      failureCopy({ kind: 'restaurantClosed' }, { ...ctx, availabilityState: 'OPEN' }).title,
    ).toBe('Zaatar House just closed');
  });
});
