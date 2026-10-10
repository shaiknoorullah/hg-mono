/**
 * W7a restaurant console composites — the contract, table-driven (plan/design-system.md §5.1),
 * plus the behaviour the 180-second revenue path depends on.
 *
 * One registry of {component, state, element, role, name}: each row renders and is checked for
 * the role and accessible name the boards specify, `aria-disabled` / `aria-busy` where the state
 * has one, and the measured target class (72px `critical` Accept, 44px elsewhere). Then the
 * invariant-bearing behaviour: the stray-key guard (A and D act only on the focused tile), a new
 * order never takes focus, focus follows the order across re-sorts, the announcer's 25% / 10% /
 * 0 steps, the ring hook, the decline form's validation (#604), the in-page confirms, and the
 * pickup code's text-only states.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DECLINE_REASONS,
  DeclineForm,
  NewOrdersStrip,
  OFFER_OUTCOMES,
  OfferTile,
  PageAnnouncerProvider,
  PickupCode,
  StatusCard,
  type NewOrdersStripTile,
} from '../index';

const NOW = Date.parse('2026-10-10T22:40:00Z');
let clock = NOW;
const now = () => clock;

const tile = (code: string, secondsLeft: number, extra: Partial<NewOrdersStripTile> = {}): NewOrdersStripTile => ({
  id: `order-${code}`,
  code,
  expiresAt: NOW + secondsLeft * 1000,
  now,
  earnCents: 3769,
  customerName: 'Aisha K.',
  itemCount: 3,
  prepMinutes: 20,
  ...extra,
});

beforeEach(() => {
  clock = NOW;
});
afterEach(() => {
  vi.useRealTimers();
});

interface Row {
  component: string;
  state: string;
  element: () => ReactElement;
  role: string;
  name: string | RegExp;
  check?: (el: HTMLElement) => void;
}

const critical = (el: HTMLElement) => expect(el.className).toMatch(/min-h-18/);
const target44 = (el: HTMLElement) => expect(el.className).toMatch(/min-h-11|min-h-13/);

const REGISTRY: Row[] = [
  /* OfferTile: the tile is the focus stop, named with code, time left and earnings. */
  {
    component: 'OfferTile',
    state: 'waiting',
    element: () => <OfferTile {...tile('A7K2', 132)} />,
    role: 'group',
    name: 'New order A7K2, 2 minutes 12 seconds left, $37.69',
    check: (el) => expect(el).toHaveAttribute('aria-keyshortcuts', 'A D Enter'),
  },
  {
    component: 'OfferTile',
    state: 'accept (critical 72px)',
    element: () => <OfferTile {...tile('A7K2', 132)} />,
    role: 'button',
    name: 'Accept order A7K2, ready in 20 minutes',
    check: (el) => {
      critical(el);
      expect(el).toHaveTextContent('Accept · 20 min');
      expect(el).toHaveAttribute('data-variant', 'primary');
    },
  },
  {
    component: 'OfferTile',
    state: 'decline (44px)',
    element: () => <OfferTile {...tile('A7K2', 132)} />,
    role: 'button',
    name: 'Decline order A7K2, choose a reason',
    check: target44,
  },
  {
    component: 'OfferTile',
    state: 'tablet decline icon',
    element: () => <OfferTile {...tile('A7K2', 110)} compactDecline />,
    role: 'button',
    name: 'Decline order A7K2, choose a reason',
    check: (el) => expect(el.className).toMatch(/min-h-11|size-11|h-11/),
  },
  {
    component: 'OfferTile',
    state: 'earnings loading',
    element: () => <OfferTile {...tile('D2P6', 178, { earnCents: null })} />,
    role: 'group',
    name: 'New order D2P6, 2 minutes 58 seconds left',
  },
  {
    component: 'OfferTile',
    state: 'accepting',
    element: () => (
      <OfferTile
        {...tile('A7K2', 118)}
        acceptLoading
        statusLine={{ tone: 'neutral', icon: 'refresh', text: 'Confirming with HalalGoes. Don’t tap again.' }}
      />
    ),
    role: 'button',
    name: 'Accept order A7K2, ready in 20 minutes',
    check: (el) => {
      expect(el).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByRole('button', { name: /Decline order A7K2/ })).toHaveAttribute('aria-disabled', 'true');
    },
  },
  {
    component: 'OfferTile',
    state: 'accept failed',
    element: () => (
      <OfferTile
        {...tile('A7K2', 96)}
        acceptLabel="Try accept again"
        statusLine={{ tone: 'danger', icon: 'error', text: 'Couldn’t confirm. Still waiting for you.' }}
      />
    ),
    role: 'button',
    name: 'Try accept again, order A7K2, ready in 20 minutes',
  },
  {
    component: 'OfferTile',
    state: 'declining',
    element: () => <OfferTile {...tile('A7K2', 84)} declining />,
    role: 'button',
    name: 'Decline order A7K2, choose a reason',
    check: (el) => {
      expect(el).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByRole('button', { name: /Accept order A7K2/ })).toHaveAttribute('aria-disabled', 'true');
    },
  },
  {
    component: 'OfferTile',
    state: 'accept disabled (still focusable)',
    element: () => <OfferTile {...tile('A7K2', 130)} acceptDisabled acceptLabel="Reconnect to accept" />,
    role: 'button',
    name: /Reconnect to accept, order A7K2/,
    check: (el) => {
      expect(el).toHaveAttribute('aria-disabled', 'true');
      expect(el.tabIndex).toBeGreaterThanOrEqual(0);
    },
  },
  ...(Object.entries(OFFER_OUTCOMES) as [string, (typeof OFFER_OUTCOMES)[keyof typeof OFFER_OUTCOMES]][]).map<Row>(([key, outcome]) => ({
    component: 'OfferTile',
    state: `ended: ${key}`,
    element: () => <OfferTile {...tile('A7K2', 0)} outcome={outcome} />,
    role: 'button',
    name: 'Remove order A7K2 from new orders',
    check: () => {
      const group = screen.getByRole('group', { name: `New order A7K2, ${outcome.badge}` });
      expect(group).not.toHaveAttribute('aria-keyshortcuts');
      expect(within(group).queryByRole('button', { name: /Accept/ })).toBeNull();
    },
  })),

  /* NewOrdersStrip: every state the boards draw. */
  {
    component: 'NewOrdersStrip',
    state: 'empty',
    element: () => <NewOrdersStrip tiles={[]} now={now} />,
    role: 'region',
    name: 'New orders',
    check: (el) => expect(within(el).getByRole('status')).toHaveTextContent('No new orders'),
  },
  {
    component: 'NewOrdersStrip',
    state: 'loading',
    element: () => <NewOrdersStrip status="loading" now={now} />,
    role: 'status',
    name: /Loading new orders/,
    check: (el) => expect(el).toHaveAttribute('aria-busy', 'true'),
  },
  {
    component: 'NewOrdersStrip',
    state: 'error',
    element: () => <NewOrdersStrip status="error" error={{ onRetry: () => undefined }} now={now} />,
    role: 'button',
    name: 'Try again',
    check: target44,
  },
  {
    component: 'NewOrdersStrip',
    state: 'one offer',
    element: () => <NewOrdersStrip tiles={[tile('A7K2', 132)]} now={now} />,
    role: 'region',
    name: 'New orders, 1 waiting',
  },
  {
    component: 'NewOrdersStrip',
    state: 'three offers',
    element: () => <NewOrdersStrip tiles={[tile('C8T4', 15), tile('B3M9', 40), tile('A7K2', 132)]} now={now} />,
    role: 'region',
    name: 'New orders, 3 waiting',
    check: (el) => expect(within(el).getAllByRole('group', { name: /^New order / })).toHaveLength(3),
  },
  {
    component: 'NewOrdersStrip',
    state: 'burst: four offers, +1 more',
    element: () => (
      <NewOrdersStrip tiles={[tile('C8T4', 15), tile('B3M9', 40), tile('A7K2', 132), tile('D2P6', 170)]} now={now} />
    ),
    role: 'button',
    name: 'Show 1 more new order',
    check: (el) => {
      expect(el).toHaveTextContent('+1 more');
      expect(screen.getAllByRole('group', { name: /^New order / })).toHaveLength(3);
    },
  },
  {
    component: 'NewOrdersStrip',
    state: 'compact (offer open in the panel)',
    element: () => (
      <NewOrdersStrip
        tiles={[tile('A7K2', 132)]}
        now={now}
        compact={{
          title: '1 new order waiting',
          body: 'A7K2 is open in the panel. Nothing else is waiting.',
          buttonLabel: 'Show all',
          buttonName: 'Show all 1 new orders',
          buttonVariant: 'tertiary',
          onPress: () => undefined,
          expiresAt: NOW + 132_000,
        }}
      />
    ),
    role: 'button',
    name: 'Show all 1 new orders',
  },

  /* DeclineForm. */
  {
    component: 'DeclineForm',
    state: 'reasons',
    element: () => <DeclineForm onSubmit={() => undefined} />,
    role: 'radiogroup',
    name: /Why are you declining\?/,
  },
  {
    component: 'DeclineForm',
    state: 'sending',
    element: () => <DeclineForm submitting orderCode="A7K2" onSubmit={() => undefined} />,
    role: 'button',
    name: 'Declining…, order A7K2',
    check: (el) => expect(el).toHaveAttribute('aria-busy', 'true'),
  },
  {
    component: 'DeclineForm',
    state: 'failed',
    element: () => <DeclineForm failed orderCode="A7K2" onSubmit={() => undefined} />,
    role: 'button',
    name: 'Try decline again, order A7K2',
    check: () => expect(screen.getByText('We couldn’t send the decline')).toBeInTheDocument(),
  },

  /* StatusCard. */
  {
    component: 'StatusCard',
    state: 'open',
    element: () => <StatusCard status="open" reason="Taking orders until 11:00 pm" onPause={() => undefined} />,
    role: 'button',
    name: 'Pause new orders',
    check: (el) => {
      expect(el).toHaveAttribute('aria-haspopup', 'menu');
      target44(el);
    },
  },
  {
    component: 'StatusCard',
    state: 'switch',
    element: () => <StatusCard status="open" layout="bar" />,
    role: 'switch',
    name: /Orders/,
    check: (el) => expect(el).toHaveAttribute('aria-checked', 'true'),
  },
  {
    component: 'StatusCard',
    state: 'switching (loading holds position)',
    element: () => <StatusCard status="switched-off" busy="toggle" />,
    role: 'switch',
    name: /New orders/,
    check: (el) => {
      expect(el).toHaveAttribute('aria-checked', 'false');
      expect(el).toHaveAttribute('aria-busy', 'true');
    },
  },
  {
    component: 'StatusCard',
    state: 'paused',
    element: () => <StatusCard status="paused" pausedUntil="2026-10-10T23:10:00Z" />,
    role: 'button',
    name: 'Resume now',
    check: () => expect(screen.getByText('Paused until 7:10 pm.')).toBeInTheDocument(),
  },
  {
    component: 'StatusCard',
    state: 'suspended (locked)',
    element: () => <StatusCard openState="CLOSED_SUSPENDED" />,
    role: 'switch',
    name: /New orders/,
    check: (el) => expect(el).toHaveAttribute('aria-disabled', 'true'),
  },

  /* PickupCode. */
  {
    component: 'PickupCode',
    state: 'shown',
    element: () => <PickupCode code="4827" help="Read this code to Daniel P." />,
    role: 'group',
    name: 'Pickup code 4 8 2 7',
  },
  {
    component: 'PickupCode',
    state: 'error',
    element: () => <PickupCode code={null} error onRetry={() => undefined} />,
    role: 'button',
    name: 'Try again',
    check: target44,
  },
  {
    component: 'PickupCode',
    state: 'missing',
    element: () => <PickupCode code="" />,
    role: 'alert',
    name: '',
    check: (el) => expect(el).toHaveTextContent('Still missing? Call support, they can read it to you.'),
  },
];

describe('W7a contract registry', () => {
  it.each(REGISTRY.map((r) => [`${r.component} — ${r.state}`, r] as const))('%s', (_label, row) => {
    render(row.element());
    const el = row.name === '' ? screen.getAllByRole(row.role)[0]! : screen.getAllByRole(row.role, { name: row.name })[0]!;
    expect(el).toBeInTheDocument();
    row.check?.(el);
  });
});

describe('NewOrdersStrip keyboard: the stray-key guard', () => {
  const setup = (extra: Partial<Parameters<typeof NewOrdersStrip>[0]> = {}) => {
    const onAccept = vi.fn();
    const onDeclineStart = vi.fn();
    const onOpen = vi.fn();
    const utils = render(
      <div>
        <button type="button">Elsewhere</button>
        <NewOrdersStrip
          tiles={[tile('C8T4', 15), tile('B3M9', 40), tile('A7K2', 132)]}
          now={now}
          onAccept={onAccept}
          onDeclineStart={onDeclineStart}
          onOpen={onOpen}
          {...extra}
        />
      </div>,
    );
    const tileOf = (code: string) => screen.getByRole('group', { name: new RegExp(`^New order ${code}`) });
    return { ...utils, onAccept, onDeclineStart, onOpen, tileOf };
  };

  it('is one tab stop: only the most urgent tile is in the tab order', () => {
    const { tileOf } = setup();
    expect(tileOf('C8T4').tabIndex).toBe(0);
    expect(tileOf('B3M9').tabIndex).toBe(-1);
    expect(tileOf('A7K2').tabIndex).toBe(-1);
  });

  it('A accepts and D declines only the focused tile; Enter opens it', () => {
    const { tileOf, onAccept, onDeclineStart, onOpen } = setup();
    tileOf('C8T4').focus();
    fireEvent.keyDown(tileOf('C8T4'), { key: 'ArrowRight' });
    expect(tileOf('B3M9')).toHaveFocus();
    fireEvent.keyDown(tileOf('B3M9'), { key: 'a' });
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith('order-B3M9');
    fireEvent.keyDown(tileOf('B3M9'), { key: 'D' });
    expect(onDeclineStart).toHaveBeenCalledWith('order-B3M9');
    fireEvent.keyDown(tileOf('B3M9'), { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith('order-B3M9');
  });

  it('does nothing when focus is elsewhere, or on a button inside the tile, or on a key repeat', () => {
    const { tileOf, onAccept, onDeclineStart } = setup();
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    elsewhere.focus();
    fireEvent.keyDown(elsewhere, { key: 'a' });
    fireEvent.keyDown(document.body, { key: 'a' });
    const decline = within(tileOf('C8T4')).getByRole('button', { name: /Decline order C8T4/ });
    decline.focus();
    fireEvent.keyDown(decline, { key: 'a' });
    fireEvent.keyDown(decline, { key: 'd' });
    tileOf('C8T4').focus();
    fireEvent.keyDown(tileOf('C8T4'), { key: 'a', repeat: true });
    expect(onAccept).not.toHaveBeenCalled();
    expect(onDeclineStart).not.toHaveBeenCalled();
  });

  it('A does nothing on a tile that is accepting or whose Accept is disabled', () => {
    const onAccept = vi.fn();
    render(<NewOrdersStrip tiles={[tile('A7K2', 120, { acceptLoading: true }), tile('B3M9', 130, { acceptDisabled: true })]} now={now} onAccept={onAccept} />);
    for (const code of ['A7K2', 'B3M9']) {
      const t = screen.getByRole('group', { name: new RegExp(`^New order ${code}`) });
      t.focus();
      fireEvent.keyDown(t, { key: 'a' });
    }
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('a new order never takes focus, and a re-sort keeps focus on the same order', () => {
    const tiles = [tile('B3M9', 40), tile('A7K2', 132)];
    const { rerender, tileOf } = setup({ tiles });
    tileOf('A7K2').focus();
    expect(tileOf('A7K2')).toHaveFocus();
    // C8T4 arrives with an earlier deadline and sorts first.
    rerender(
      <div>
        <button type="button">Elsewhere</button>
        <NewOrdersStrip tiles={[tile('C8T4', 15), ...tiles]} now={now} />
      </div>,
    );
    expect(tileOf('A7K2')).toHaveFocus();
    expect(tileOf('C8T4')).not.toHaveFocus();
  });

  it('when the focused order ends, focus moves to its note, and A then does nothing', () => {
    const onAccept = vi.fn();
    const { rerender } = render(<NewOrdersStrip tiles={[tile('A7K2', 5)]} now={now} onAccept={onAccept} />);
    const t = screen.getByRole('group', { name: /^New order A7K2/ });
    t.focus();
    rerender(<NewOrdersStrip tiles={[tile('A7K2', 0, { outcome: OFFER_OUTCOMES.timedOut })]} now={now} onAccept={onAccept} />);
    const note = screen.getByText('Nobody answered in 3 minutes');
    expect(note).toHaveFocus();
    fireEvent.keyDown(note, { key: 'a' });
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('Right arrow past the third tile brings the fourth into view and focuses it', () => {
    const { tileOf } = setup({ tiles: [tile('C8T4', 15), tile('B3M9', 40), tile('A7K2', 132), tile('D2P6', 170)] });
    tileOf('C8T4').focus();
    fireEvent.keyDown(tileOf('C8T4'), { key: 'ArrowRight' });
    fireEvent.keyDown(tileOf('B3M9'), { key: 'ArrowRight' });
    fireEvent.keyDown(tileOf('A7K2'), { key: 'ArrowRight' });
    expect(tileOf('D2P6')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Show 1 earlier new order' })).toBeInTheDocument();
  });
});

describe('NewOrdersStrip speech and sound', () => {
  const regions = () => ({
    polite: document.querySelector('[data-politeness="polite"]')!,
    assertive: document.querySelector('[data-politeness="assertive"]')!,
  });

  it('speaks 25% politely, 10% assertively and 0 politely, once each; tile countdowns are silent', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const strip = (secs: number) => (
      <PageAnnouncerProvider politeIntervalMs={0} minIntervalMs={0}>
        <NewOrdersStrip tiles={[tile('B3M9', secs)]} now={now} />
      </PageAnnouncerProvider>
    );
    // Mounted at 50 s left of 180 (28%): nothing behind it is spoken late.
    const { rerender } = render(strip(50));
    act(() => vi.advanceTimersByTime(10));
    expect(regions().polite.textContent).toBe('');
    // No countdown on the tile has a live region of its own.
    expect(document.querySelectorAll('[data-testid="Countdown"] [aria-live]')).toHaveLength(0);

    clock = NOW + 10_000; // 40 s left: under 25%
    rerender(strip(50));
    act(() => vi.advanceTimersByTime(10));
    expect(regions().polite.textContent).toMatch(/^B3M9, 40 seconds left\.\s?$/);

    clock = NOW + 32_000; // 18 s left: under 10%
    rerender(strip(50));
    act(() => vi.advanceTimersByTime(10));
    expect(regions().assertive.textContent).toMatch(/^B3M9, 18 seconds left to accept\.\s?$/);

    clock = NOW + 50_000; // 0
    rerender(strip(50));
    act(() => vi.advanceTimersByTime(10));
    expect(regions().polite.textContent).toMatch(/^B3M9 timed out\. The customer was not charged\.\s?$/);
  });

  it('announces an arrival politely and calls the new-order and ring hooks; never moves focus', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const onRingChange = vi.fn();
    const onNewOrders = vi.fn();
    const Harness = () => {
      const [tiles, setTiles] = useState<NewOrdersStripTile[]>([]);
      return (
        <PageAnnouncerProvider politeIntervalMs={0}>
          <button type="button" onClick={() => setTiles([tile('A7K2', 180)])}>
            Ring
          </button>
          <button type="button" onClick={() => setTiles([])}>
            Clear
          </button>
          <NewOrdersStrip tiles={tiles} now={now} onRingChange={onRingChange} onNewOrders={onNewOrders} />
        </PageAnnouncerProvider>
      );
    };
    render(<Harness />);
    expect(onRingChange).not.toHaveBeenCalled();
    const ring = screen.getByRole('button', { name: 'Ring' });
    ring.focus();
    fireEvent.click(ring);
    act(() => vi.advanceTimersByTime(10));
    expect(ring).toHaveFocus();
    expect(onNewOrders).toHaveBeenCalledWith(['order-A7K2']);
    expect(onRingChange).toHaveBeenLastCalledWith(true);
    expect(regions().polite.textContent).toMatch(/^New order A7K2, 3 items, 3 minutes to answer\.\s?$/);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onRingChange).toHaveBeenLastCalledWith(false);
  });

  it('keeps the ring off when sound is not enabled', () => {
    const onRingChange = vi.fn();
    render(<NewOrdersStrip tiles={[tile('A7K2', 120)]} now={now} soundEnabled={false} onRingChange={onRingChange} />);
    expect(onRingChange).not.toHaveBeenCalled();
  });
});

describe('DeclineForm (#604)', () => {
  it('offers exactly the contract’s seven reasons, with nothing preselected, and Keep order first', () => {
    render(<DeclineForm onSubmit={() => undefined} />);
    expect(DECLINE_REASONS.map((r) => r.value)).toEqual([
      'ITEM_UNAVAILABLE',
      'KITCHEN_AT_CAPACITY',
      'CLOSING_SOON',
      'EQUIPMENT_FAILURE',
      'ADDRESS_OUT_OF_RANGE',
      'SUSPECTED_FRAUD',
      'OTHER',
    ]);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(7);
    for (const r of radios) expect(r).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Keep order' })).toHaveFocus();
  });

  it('refuses a decline with no reason: group error, focus on the group, nothing sent', () => {
    const onSubmit = vi.fn();
    render(<DeclineForm onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Decline order' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Choose a reason to decline')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup')).toHaveFocus();
  });

  it('“Something else” requires a note of at least 20 characters, and sends it trimmed', () => {
    const onSubmit = vi.fn();
    render(<DeclineForm onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Something else' }));
    const note = screen.getByRole('textbox', { name: /Add detail/ });
    fireEvent.change(note, { target: { value: 'Grill is down' } });
    fireEvent.click(screen.getByRole('button', { name: 'Decline order' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Write at least 20 characters.')).toBeInTheDocument();
    expect(note).toHaveFocus();
    fireEvent.change(note, { target: { value: '  Grill is down until tomorrow  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Decline order' }));
    expect(onSubmit).toHaveBeenCalledWith({
      reason: 'OTHER',
      note: 'Grill is down until tomorrow',
      itemIds: [],
      itemLabels: [],
      markOutOfStock: false,
    });
  });

  it('“An item is unavailable” sends the ticked items and the out-of-stock choice', () => {
    const onSubmit = vi.fn();
    render(
      <DeclineForm
        onSubmit={onSubmit}
        items={[
          { key: 'l1', menuItemId: 'mi-grill', label: '1 × Mixed charcoal grill (Large)' },
          { key: 'l2', menuItemId: 'mi-wrap', label: '2 × Chicken shawarma wrap' },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'An item is unavailable' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '1 × Mixed charcoal grill (Large)' }));
    expect(screen.getByRole('checkbox', { name: /Also mark the ticked items out of stock until closing/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Decline order' }));
    expect(onSubmit).toHaveBeenCalledWith({
      reason: 'ITEM_UNAVAILABLE',
      note: undefined,
      itemIds: ['mi-grill'],
      itemLabels: ['1 × Mixed charcoal grill (Large)'],
      markOutOfStock: true,
    });
  });

  it('Keep order calls onCancel', () => {
    const onCancel = vi.fn();
    render(<DeclineForm onSubmit={() => undefined} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Keep order' }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('StatusCard', () => {
  it('pause lengths are menuitemradio rows, and choosing one calls onPause', async () => {
    const onPause = vi.fn();
    render(<StatusCard status="open" onPause={onPause} />);
    const trigger = screen.getByRole('button', { name: 'Pause new orders' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const items = await screen.findAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringMatching(/^Pause for 15 minutes \(until \d{1,2}:\d{2} (am|pm)\)$/),
      expect.stringMatching(/^Pause for 30 minutes/),
      expect.stringMatching(/^Pause for 60 minutes/),
    ]);
    fireEvent.click(items[1]!);
    expect(onPause).toHaveBeenCalledWith(30);
  });

  it('turning orders off asks in the page first, with first focus on Keep accepting', () => {
    const onToggle = vi.fn();
    render(<StatusCard status="open" onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('switch', { name: /New orders/ }));
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Keep accepting' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Stop accepting' }));
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('resume asks first, with first focus on Stay paused', () => {
    const onResume = vi.fn();
    render(<StatusCard status="paused" pausedUntil="2026-10-10T23:10:00Z" onResume={onResume} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume now' }));
    expect(screen.getByRole('button', { name: 'Stay paused' })).toHaveFocus();
    expect(screen.getByText(/Your pause was set to end at 7:10 pm\./)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Resume now' }).at(-1)!);
    expect(onResume).toHaveBeenCalled();
  });

  it('never paints an open state in the danger tone', () => {
    for (const openState of ['OPEN', 'PAUSED', 'CLOSED_HOURS', 'CLOSED_HOLIDAY', 'CLOSED_TOGGLE', 'CLOSED_OFFLINE', 'CLOSED_SUSPENDED'] as const) {
      const { unmount } = render(<StatusCard openState={openState} />);
      expect(screen.getByTestId('Badge').className).not.toMatch(/danger/);
      unmount();
    }
  });
});

describe('PickupCode: text only, never a seal or QR fallback', () => {
  it('error: Try again calls onRetry', () => {
    const onRetry = vi.fn();
    render(<PickupCode code={null} error onRetry={onRetry} support={{ href: 'tel:+18005550199', label: 'Call support on +1 800 555 0199' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t load the pickup code');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Call support on +1 800 555 0199' })).toHaveAttribute('href', 'tel:+18005550199');
  });

  it('loading is busy, and no state draws an image, a canvas or a QR', () => {
    const { container, rerender } = render(<PickupCode code={undefined} loading />);
    expect(screen.getByTestId('PickupCode')).toHaveAttribute('aria-busy', 'true');
    for (const ui of [
      <PickupCode key="s" code="4827" />,
      <PickupCode key="e" code={null} error />,
      <PickupCode key="m" code={null} />,
    ]) {
      rerender(ui);
      expect(container.querySelector('img, canvas, svg[data-qr], [data-testid*="Qr"], [data-testid*="Seal"]')).toBeNull();
      expect(container.textContent).not.toMatch(/seal|scan|QR/i);
    }
  });
});
