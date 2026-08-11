import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { OrderState } from '@hg/api-client';

import { StatusTimeline } from '../StatusTimeline.js';
import {
  FAILURE_ORDER_STATES,
  ORDER_STATE_SEQUENCE,
  TERMINAL_ORDER_STATES,
  buildOrderTimelineSteps,
  type TimelineAudience,
} from '../orderStateVocabulary.js';

afterEach(cleanup);

const AUDIENCES: TimelineAudience[] = ['customer', 'restaurant', 'rider', 'admin'];

describe('StatusTimeline renders every OrderState in the contract', () => {
  it('covers all fourteen states from the generated union, with no duplicates', () => {
    // The list is derived from `@hg/api-client`'s `OrderState`; if the contract grows a
    // state and the vocabulary does not, this is where it shows up.
    expect(ORDER_STATE_SEQUENCE).toHaveLength(14);
    expect(new Set(ORDER_STATE_SEQUENCE).size).toBe(14);
  });

  it.each(ORDER_STATE_SEQUENCE)('renders %s for every audience without crashing', (state) => {
    for (const audience of AUDIENCES) {
      const { unmount } = render(
        <StatusTimeline state={state} audience={audience} label={`Order progress ${state}`} />,
      );
      const timeline = screen.getByTestId('status-timeline');
      expect(timeline).toBeTruthy();
      // Every render produces at least one step; the list is never blank.
      expect(timeline.querySelectorAll('li[data-step-key]').length).toBeGreaterThan(0);
      unmount();
    }
  });

  it('gives the admin audience one step per contract state on the spine', () => {
    const steps = buildOrderTimelineSteps({ state: 'DELIVERED', audience: 'admin' });
    expect(steps.map((step) => step.key)).toEqual([
      'created',
      'authorized',
      'restaurant_pending',
      'preparing',
      'ready_for_pickup',
      'picked_up',
      'arrived',
      'delivered',
      'completed',
    ]);
  });
});

describe('terminal states render distinctly from forward progress', () => {
  it.each(FAILURE_ORDER_STATES)('%s produces a failed step and marks the timeline terminal', (state) => {
    render(<StatusTimeline state={state} audience="customer" label="Order progress" />);

    const timeline = screen.getByTestId('status-timeline');
    // The timeline itself is flagged, so a card can style the whole block.
    expect(timeline.getAttribute('data-terminal')).toBe('true');

    const failed = timeline.querySelectorAll('li[data-step-state="failed"]');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.getAttribute('data-terminal')).toBe('true');

    // Nothing on a dead order is left looking like progress in flight.
    expect(timeline.querySelectorAll('li[data-step-state="current"]')).toHaveLength(0);
    expect(timeline.querySelectorAll('li[data-step-state="upcoming"]')).toHaveLength(0);
  });

  it('marks the steps a cancelled order will never reach as abandoned, not upcoming', () => {
    const steps = buildOrderTimelineSteps({
      state: 'CANCELLED',
      audience: 'customer',
      transitions: [
        { state: 'CREATED', at: '2026-08-11T10:00:00.000Z' },
        { state: 'AUTHORIZED', at: '2026-08-11T10:00:05.000Z' },
        { state: 'RESTAURANT_PENDING', at: '2026-08-11T10:00:06.000Z' },
        { state: 'CANCELLED', at: '2026-08-11T10:01:00.000Z' },
      ],
    });

    expect(steps.find((step) => step.key === 'placed')?.state).toBe('complete');
    expect(steps.find((step) => step.key === 'confirmed')?.state).toBe('complete');
    expect(steps.find((step) => step.key === 'preparing')?.state).toBe('abandoned');
    expect(steps.find((step) => step.key === 'on_the_way')?.state).toBe('abandoned');
    expect(steps.find((step) => step.key === 'delivered')?.state).toBe('abandoned');

    const terminal = steps.at(-1);
    expect(terminal?.key).toBe('cancelled');
    expect(terminal?.state).toBe('failed');
    expect(terminal?.detail).toBeTruthy();
  });

  it('does not treat RESOLVED — a settled terminal state — as a failure', () => {
    expect(TERMINAL_ORDER_STATES).toContain('RESOLVED');
    const steps = buildOrderTimelineSteps({ state: 'RESOLVED', audience: 'admin' });
    expect(steps.at(-1)?.state).toBe('complete');

    render(<StatusTimeline state="RESOLVED" audience="admin" label="Order progress" />);
    expect(screen.getByTestId('status-timeline').getAttribute('data-terminal')).toBeNull();
  });

  it('DISPUTED is called out as stalled rather than silently complete', () => {
    const steps = buildOrderTimelineSteps({ state: 'DISPUTED', audience: 'admin' });
    expect(steps.at(-1)?.state).toBe('stalled');
  });
});

describe('the forward path', () => {
  it('marks the current step with aria-current and never colour alone', () => {
    render(
      <StatusTimeline
        state="PREPARING"
        audience="customer"
        label="Order progress"
        transitions={[{ state: 'PREPARING', at: '2026-08-11T10:05:00.000Z' }]}
      />,
    );

    const current = screen.getByTestId('status-timeline').querySelector('li[aria-current="step"]');
    expect(current?.getAttribute('data-step-key')).toBe('preparing');
    // The state word is in the accessible name, so the colour is never the only signal.
    expect(current?.getAttribute('aria-label')).toContain('in progress');
  });

  it('marks the current step stalled once a server deadline has passed', () => {
    const steps = buildOrderTimelineSteps({
      state: 'RESTAURANT_PENDING',
      audience: 'restaurant',
      deadlineAt: '2026-08-11T10:00:00.000Z',
      now: Date.parse('2026-08-11T10:03:01.000Z'),
    });
    expect(steps.find((step) => step.key === 'new')?.state).toBe('stalled');
  });

  it('falls back rather than crashing on a state this build has never heard of', () => {
    const steps = buildOrderTimelineSteps({
      state: 'TELEPORTED' as OrderState,
      audience: 'customer',
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]?.state).toBe('unsupported');
  });
});
