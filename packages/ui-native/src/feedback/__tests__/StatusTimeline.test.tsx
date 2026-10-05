/**
 * The load-bearing test for this tier: the timeline must survive every one of the contract's
 * fourteen `OrderState` values, in every audience's vocabulary, and must treat the terminal
 * failures as terminal rather than as "the last step".
 *
 * The state list is read from `ORDER_STATE_LABELS`, which is a `Record<OrderState, string>` typed
 * off `@hg/api-client`. Adding a fifteenth state to the contract therefore breaks the type first
 * and shows up here second — the list can never silently fall out of date.
 */
import { render, screen } from '@testing-library/react-native';

import { StatusTimeline } from '../StatusTimeline';
import {
  ORDER_STATE_LABELS,
  ORDER_TRACKS,
  resolveTimeline,
  type TimelineAudience,
} from '../order-track';

const ALL_STATES = Object.keys(ORDER_STATE_LABELS) as (keyof typeof ORDER_STATE_LABELS)[];
const AUDIENCES: TimelineAudience[] = ['customer', 'restaurant', 'rider', 'admin'];

describe('StatusTimeline', () => {
  it('covers all fourteen contract states', () => {
    expect(ALL_STATES).toHaveLength(14);
  });

  it.each(AUDIENCES)('renders every OrderState for the %s audience without crashing', (audience) => {
    for (const state of ALL_STATES) {
      const view = render(<StatusTimeline audience={audience} state={state} />);
      expect(screen.getByTestId('StatusTimeline')).toBeTruthy();
      view.unmount();
    }
  });

  it.each(AUDIENCES)('renders every OrderState horizontally and compactly for %s', (audience) => {
    for (const state of ALL_STATES) {
      for (const orientation of ['horizontal', 'compact'] as const) {
        const view = render(
          <StatusTimeline audience={audience} state={state} orientation={orientation} />,
        );
        expect(screen.getByTestId('StatusTimeline')).toBeTruthy();
        view.unmount();
      }
    }
  });

  it('marks the three terminal failures as failed, not as progress', () => {
    for (const state of ['CANCELLED', 'REJECTED', 'FAILED'] as const) {
      const r = resolveTimeline({ audience: 'customer', state });
      expect(r.outcome.kind).toBe('failed');
      expect(r.currentKey).toBeNull();
      expect(r.steps.some((s) => s.state === 'failed')).toBe(true);
      // Nothing after the failure is presented as still reachable.
      expect(r.steps.some((s) => s.state === 'current')).toBe(false);
    }
  });

  it('separates the terminal successes from the terminal failures', () => {
    expect(resolveTimeline({ audience: 'customer', state: 'COMPLETED' }).outcome.kind).toBe('complete');
    expect(resolveTimeline({ audience: 'admin', state: 'RESOLVED' }).outcome.kind).toBe('complete');
    // DISPUTED is terminal-looking but is NOT terminal, and must not read as a failure.
    const disputed = resolveTimeline({ audience: 'customer', state: 'DISPUTED' });
    expect(disputed.outcome.kind).toBe('attention');
  });

  it('places a rejection at the step the restaurant was asked, not at step zero', () => {
    const r = resolveTimeline({
      audience: 'customer',
      state: 'REJECTED',
      transitions: [
        { to_state: 'CREATED' },
        { to_state: 'AUTHORIZED' },
        { to_state: 'RESTAURANT_PENDING' },
        { from_state: 'RESTAURANT_PENDING', to_state: 'REJECTED' },
      ],
    });
    const failed = r.steps.find((s) => s.state === 'failed');
    expect(failed?.key).toBe('confirmed');
    expect(r.steps[0]?.state).toBe('complete');
    expect(r.steps[3]?.state).toBe('unreached');
  });

  it('renders sensibly when an order skips states', () => {
    // Straight from RESTAURANT_PENDING to READY_FOR_PICKUP: "Preparing" never happened for the
    // restaurant audience, so it must not be drawn as something the order passed through.
    const r = resolveTimeline({
      audience: 'restaurant',
      state: 'READY_FOR_PICKUP',
      transitions: [
        { to_state: 'CREATED' },
        { to_state: 'RESTAURANT_PENDING' },
        { from_state: 'RESTAURANT_PENDING', to_state: 'READY_FOR_PICKUP' },
      ],
    });
    expect(r.steps.find((s) => s.key === 'preparing')?.state).toBe('skipped');
    expect(r.steps.find((s) => s.key === 'ready')?.state).toBe('current');
    expect(r.steps.find((s) => s.key === 'received')?.state).toBe('complete');
  });

  it('claims nothing about skipped steps when no history is supplied', () => {
    const r = resolveTimeline({ audience: 'restaurant', state: 'READY_FOR_PICKUP' });
    expect(r.steps.find((s) => s.key === 'preparing')?.state).toBe('complete');
    expect(r.steps.some((s) => s.state === 'skipped')).toBe(false);
  });

  it('never tells a customer a ready order is still being prepared', () => {
    const label = (state: 'PREPARING' | 'READY_FOR_PICKUP') =>
      resolveTimeline({ audience: 'customer', state }).steps.find((s) => s.key === 'preparing')?.label;
    expect(label('PREPARING')).toBe('Preparing your food');
    expect(label('READY_FOR_PICKUP')).toBe('Your food is ready');
  });

  it('marks the current step stalled once its deadline has passed', () => {
    const now = Date.parse('2026-08-11T12:00:00Z');
    const live = resolveTimeline({
      audience: 'customer',
      state: 'PREPARING',
      deadlineAt: '2026-08-11T12:05:00Z',
      now,
    });
    expect(live.steps.find((s) => s.key === 'preparing')?.state).toBe('current');

    const late = resolveTimeline({
      audience: 'customer',
      state: 'PREPARING',
      deadlineAt: '2026-08-11T11:55:00Z',
      now,
    });
    expect(late.steps.find((s) => s.key === 'preparing')?.state).toBe('stalled');
  });

  it('does not crash on an unknown server enum value, and reports it', () => {
    const onUnknownState = jest.fn();
    render(
      <StatusTimeline audience="customer" state="TELEPORTED" onUnknownState={onUnknownState} />,
    );
    expect(screen.getByTestId('StatusTimeline')).toBeTruthy();
    expect(onUnknownState).toHaveBeenCalledWith('TELEPORTED');

    const r = resolveTimeline({ audience: 'customer', state: 'TELEPORTED' });
    expect(r.unknownState).toBe('TELEPORTED');
    expect(r.outcome.kind).toBe('unknown');
    // The shape of the timeline still renders — the app is out of date, the order is not broken.
    expect(r.steps).toHaveLength(ORDER_TRACKS.customer.steps.length);
  });

  it('renders the loading skeleton with the correct number of steps', () => {
    render(<StatusTimeline audience="customer" state="CREATED" loading />);
    expect(screen.getByTestId('StatusTimeline-loading')).toBeTruthy();
    // Skeletons are `aria-hidden` by design (the region carries `aria-busy` and announces once),
    // so counting them means opting into hidden elements.
    expect(screen.getAllByTestId('Skeleton', { includeHiddenElements: true })).toHaveLength(
      ORDER_TRACKS.customer.steps.length * 2, // one circle + one text line per step
    );
  });

  it('keeps the timeline on screen when the connection degrades', () => {
    render(<StatusTimeline audience="customer" state="PREPARING" connection="reconnecting" />);
    expect(screen.getByTestId('StatusTimeline-connection-banner')).toBeTruthy();
    // The point of the banner is that the timeline is still there behind it.
    expect(screen.getByTestId('StatusTimeline-step-preparing')).toBeTruthy();
  });

  it('never shows settlement to a customer', () => {
    expect(ORDER_TRACKS.customer.steps.some((s) => s.key === 'settled')).toBe(false);
    expect(ORDER_TRACKS.restaurant.steps.some((s) => s.key === 'settled')).toBe(true);
  });
});
