/**
 * WP3 — one announcer, silent countdowns (spec §8, LO `A11y-announcements`,
 * `A11y-countdown-silent`): thresholds 25 % (polite), 10 % (assertive), 0 (polite outcome),
 * never per second. Fake timers throughout.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { Countdown } from '../ds';
import { consoleRoutes, fixture, installFakeApi } from '../test/fakeApi';
import { renderRedesign } from '../test/render';
import { OfferAnnouncer, newOrdersMessage } from './announcements';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const T0 = Date.UTC(2026, 9, 9, 22, 0, 0);

describe('OfferAnnouncer', () => {
  it('speaks each order at 25 % (polite) and 10 % (assertive) once, never per second', () => {
    const a = new OfferAnnouncer();
    const offer = { id: 'a', code: 'B3M9', deadlineAt: T0 + 60_000, live: true };
    a.seen(offer, T0);
    const said: { at: number; message: string; politeness: string }[] = [];
    for (let s = 0; s <= 60; s++) a.tick([offer], T0 + s * 1000).forEach((m) => said.push({ at: 60 - s, ...m }));
    expect(said).toEqual([
      { at: 45, message: 'B3M9, 45 seconds left.', politeness: 'polite' },
      { at: 18, message: 'B3M9, 18 seconds left to accept.', politeness: 'assertive' },
    ]);
  });

  it('at 25 % speaks only the most urgent; a queued one is dropped once it reaches 10 %', () => {
    const a = new OfferAnnouncer();
    const urgent = { id: 'u', code: 'C8T4', deadlineAt: T0 + 44_000, live: true };
    const other = { id: 'o', code: 'A7K2', deadlineAt: T0 + 45_000, live: true };
    a.seen({ ...urgent, deadlineAt: T0 + 100_000 }, T0 - 60_000); // seen earlier, above 25 %
    a.seen({ ...other, deadlineAt: T0 + 100_000 }, T0 - 60_000);
    const first = a.tick([urgent, other], T0);
    expect(first).toEqual([{ message: 'C8T4, 44 seconds left.', politeness: 'polite' }]);
    // Next tick: the other one's turn, if it is still above 10 %.
    expect(a.tick([urgent, other], T0 + 1000)).toEqual([{ message: 'A7K2, 44 seconds left.', politeness: 'polite' }]);

    const b = new OfferAnnouncer();
    const x = { id: 'x', code: 'X1', deadlineAt: T0 + 40_000, live: true };
    const y = { id: 'y', code: 'Y2', deadlineAt: T0 + 41_000, live: true };
    b.seen({ ...x, deadlineAt: T0 + 999_000 }, T0 - 1);
    b.seen({ ...y, deadlineAt: T0 + 999_000 }, T0 - 1);
    expect(b.tick([x, y], T0).map((m) => m.message)).toEqual(['X1, 40 seconds left.']);
    // Y2 passes 10 % before its turn: its 25 % message is dropped, the 10 % one is spoken.
    const late = { ...y, deadlineAt: T0 + 17_000 };
    expect(b.tick([x, late], T0 + 1000)).toEqual([{ message: 'Y2, 16 seconds left to accept.', politeness: 'assertive' }]);
  });

  it('never speaks a threshold an order was already past when first seen', () => {
    const a = new OfferAnnouncer();
    const offer = { id: 'a', code: 'C8T4', deadlineAt: T0 + 15_000, live: true };
    a.seen(offer, T0);
    expect(a.tick([offer], T0)).toEqual([]);
  });

  it('batches several new orders into one message', () => {
    expect(newOrdersMessage([{ code: 'A7K2', items: 3, deadlineAt: T0 + 180_000 }], T0)).toBe('New order A7K2, 3 items, 3 minutes to answer.');
    expect(
      newOrdersMessage(
        [
          { code: 'A7K2', items: 3, deadlineAt: T0 + 132_000 },
          { code: 'B3M9', items: 2, deadlineAt: T0 + 40_000 },
        ],
        T0,
      ),
    ).toBe('2 new orders, most urgent B3M9, 40 seconds left.');
  });
});

describe('Countdown (silent)', () => {
  it('counts from the deadline and the server clock, changes phase at 25 % and 10 %, and never speaks', () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    render(<Countdown variant="ring" expiresAt={T0 + 60_000} now={() => Date.now()} windowSeconds={180} />);
    const el = screen.getByTestId('countdown');
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('[aria-live]')).toBeNull();
    expect(el.textContent).toBe('1:00');
    expect(el.getAttribute('data-phase')).toBe('normal');
    act(() => vi.advanceTimersByTime(20_000));
    expect(el.textContent).toBe('0:40');
    expect(el.getAttribute('data-phase')).toBe('urgent');
    act(() => vi.advanceTimersByTime(25_000));
    expect(el.textContent).toBe('0:15');
    expect(el.getAttribute('data-phase')).toBe('critical');
    act(() => vi.advanceTimersByTime(20_000));
    expect(el.textContent).toBe('0:00');
    expect(el.getAttribute('data-phase')).toBe('expired');
  });
});

describe('the strip speaks through the page announcer', () => {
  it('25 % polite, 10 % assertive, then the timeout, with the server clock', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const o = {
      ...fixture('restaurant_order_restaurant_pending'),
      code: 'B3M9',
      deadline_at: new Date(Date.now() + 50_000).toISOString(),
    };
    installFakeApi(
      consoleRoutes({
        'GET /v1/restaurant/availability': 'restaurant_open_state_open',
        'GET /v1/restaurant/orders': { body: [o] },
        [`GET /v1/restaurant/orders/${o.id}`]: { body: o },
      }),
    );
    await renderRedesign('/orders/history');
    await waitFor(() => expect(document.querySelector('[data-offer-tile]')).not.toBeNull());
    const polite = screen.getByTestId('announcer-polite');
    const assertive = screen.getByTestId('announcer-assertive');
    await waitFor(() => expect(polite.textContent).toMatch(/^New order B3M9, 3 items, (49|50) seconds to answer\.$/));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    await waitFor(() => expect(polite.textContent).toMatch(/^B3M9, 4[45] seconds left\.$/));
    const at25 = polite.textContent;
    // Nothing more until 10 %: never per second.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(polite.textContent).toBe(at25);
    expect(assertive.textContent).toBe('');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_000);
    });
    await waitFor(() => expect(assertive.textContent).toMatch(/^B3M9, 1[78] seconds left to accept\.$/));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    await waitFor(() => expect(polite.textContent).toBe('B3M9 timed out. The customer was not charged.'));
    expect(screen.getByText('Nobody answered in 3 minutes')).toBeTruthy();
  });
});
