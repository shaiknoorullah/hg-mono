/**
 * W4 Feedback — the invariant-bearing behaviour, one test per rule (AGENTS.md §6: few tests,
 * each pinning something that cost money or safety when it broke).
 *
 * - Countdown: the server clock wins over a skewed device (D-14), `onExpire` fires exactly
 *   once (including a deadline already passed at mount), the numeral is never negative, and
 *   `silent` renders no live region at all.
 * - Toast: danger and action toasts are persistent; the timer pauses on hover and focus.
 * - Modal: confirm puts focus on the least destructive action.
 * - Menu: a disabled item stays focusable, cannot be chosen, and its reason is read; `checked`
 *   items are menuitemradio.
 * - StatusTimeline: a passed deadline makes the current step `stalled`.
 * - PageAnnouncer: at most one assertive message per interval, a dedupe key speaks once, and
 *   the same text is not repeated within 5 s.
 * - InlineAlert: a blocking alert takes focus and is assertive.
 * - Halal: a halal message cannot be danger, at the type level and at run time (invariant 9).
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Countdown, Menu, Modal, StatusTimeline, Toast, resolveTimeline, setClientErrorReporter } from '../index';
import { formatTime12h } from '../time';
import {
  Banner,
  HalalBanner,
  InlineAlert,
  PageAnnouncerProvider,
  useAnnounce,
  usePageAnnouncer,
  type HalalBannerProps,
  type HalalMessageTone,
} from '../../proposed/index';

const NOW = Date.parse('2026-10-10T18:40:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
  });
  vi.setSystemTime(NOW);
  setClientErrorReporter(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  setClientErrorReporter(null);
});

const numeral = () => screen.getByTestId('Countdown').querySelector('[data-slot="countdown-numeral"]')!.textContent;

describe('Countdown', () => {
  it('runs on serverNow + monotonic time when the device clock is 10 minutes fast', () => {
    // The device says 18:50; the server says 18:40 and the deadline is 18:42.
    vi.setSystemTime(NOW + 600_000);
    render(<Countdown expiresAt={iso(NOW + 120_000)} serverNow={iso(NOW)} windowSeconds={900} />);
    expect(numeral()).toBe('2:00');
    act(() => vi.advanceTimersByTime(30_000));
    expect(numeral()).toBe('1:30');
  });

  it('fires onExpire exactly once and never shows a negative number', () => {
    const onExpire = vi.fn();
    const { rerender } = render(<Countdown expiresAt={iso(NOW + 3_000)} serverNow={iso(NOW)} windowSeconds={30} onExpire={onExpire} />);
    act(() => vi.advanceTimersByTime(10_000));
    expect(numeral()).toBe('0:00');
    expect(screen.getByTestId('Countdown')).toHaveAttribute('data-state', 'expired');
    act(() => vi.advanceTimersByTime(10_000));
    expect(onExpire).toHaveBeenCalledTimes(1);
    // A re-fetch that returns the same deadline with a fresh server clock is the same deadline.
    rerender(<Countdown expiresAt={iso(NOW + 3_000)} serverNow={iso(NOW + 20_000)} windowSeconds={30} onExpire={onExpire} />);
    act(() => vi.advanceTimersByTime(1_000));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('renders nothing and fires onExpire once when the deadline had already passed at mount', () => {
    const onExpire = vi.fn();
    const { container, rerender } = render(
      <Countdown expiresAt={iso(NOW - 5_000)} serverNow={iso(NOW)} windowSeconds={30} onExpire={onExpire} />,
    );
    // A new callback identity on re-render must not refire it.
    rerender(<Countdown expiresAt={iso(NOW - 5_000)} serverNow={iso(NOW)} windowSeconds={30} onExpire={() => onExpire()} />);
    act(() => vi.advanceTimersByTime(5_000));
    expect(container).toBeEmptyDOMElement();
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('moves normal → urgent → critical by the remaining fraction', () => {
    render(<Countdown expiresAt={iso(NOW + 100_000)} serverNow={iso(NOW)} windowSeconds={100} />);
    const el = screen.getByTestId('Countdown');
    expect(el).toHaveAttribute('data-state', 'normal');
    act(() => vi.advanceTimersByTime(80_000));
    expect(el).toHaveAttribute('data-state', 'urgent');
    act(() => vi.advanceTimersByTime(12_000));
    expect(el).toHaveAttribute('data-state', 'critical');
    // The pulse is motion-safe only, so reduced motion suppresses it.
    expect(el.querySelector('[data-slot="countdown-numeral"]')!.className).toMatch(/motion-safe:animate-pulse/);
  });

  it('announces each threshold once in its own assertive region, and silent mode has no live region at all', () => {
    const { unmount } = render(<Countdown expiresAt={iso(NOW + 100_000)} serverNow={iso(NOW)} windowSeconds={100} />);
    const region = screen.getByTestId('Countdown').querySelector('[aria-live="assertive"]')!;
    act(() => vi.advanceTimersByTime(51_000));
    expect(region).toHaveTextContent('49 seconds left.');
    unmount();

    render(<Countdown silent expiresAt={iso(NOW + 100_000)} serverNow={iso(NOW)} windowSeconds={100} variant="ring" />);
    act(() => vi.advanceTimersByTime(95_000));
    const silent = screen.getByTestId('Countdown');
    expect(silent.querySelector('[aria-live]')).toBeNull();
    expect(silent.querySelector('[role="status"], [role="alert"]')).toBeNull();
  });
});

describe('Toast', () => {
  it('auto-dismisses a neutral toast after 5 s, but pauses while hovered or focused', () => {
    const onDismiss = vi.fn();
    render(<Toast title="Menu synced" onDismiss={onDismiss} />);
    const toast = screen.getByTestId('Toast');
    act(() => vi.advanceTimersByTime(3_000));
    fireEvent.pointerEnter(toast);
    act(() => vi.advanceTimersByTime(10_000));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.pointerLeave(toast);
    act(() => vi.advanceTimersByTime(2_100));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('keeps danger and action toasts until dismissed, whatever the duration', () => {
    const onDismiss = vi.fn();
    render(
      <>
        <Toast variant="danger" title="Payment declined" duration={1000} onDismiss={onDismiss} />
        <Toast title="Address saved" action={{ label: 'Undo', onAction: () => undefined }} onDismiss={onDismiss} />
      </>,
    );
    act(() => vi.advanceTimersByTime(60_000));
    expect(onDismiss).not.toHaveBeenCalled();
    // Taking the action ends the toast, as the Radix toast it replaced did.
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('Modal', () => {
  it('confirm moves focus to the least destructive action', () => {
    render(
      <Modal open variant="confirm" destructive title="Cancel this order?" confirmLabel="Cancel order" cancelLabel="Keep order" onClose={() => undefined} />,
    );
    expect(screen.getByRole('button', { name: 'Keep order' })).toHaveFocus();
  });

  it('a non-dismissible modal ignores Escape', () => {
    const onClose = vi.fn();
    render(<Modal open variant="alert" dismissible={false} title="Signed out" onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Menu', () => {
  it('a disabled item is focusable, reads its reason, and cannot be chosen', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <Menu
        label="Actions for Chicken shawarma plate"
        onSelect={onSelect}
        items={[
          { key: 'edit', label: 'Edit item' },
          { key: 'price', label: 'Change price', disabled: true, disabledReason: 'Locked while an order is open' },
          { type: 'separator' },
          { key: 'remove', label: 'Remove item', destructive: true },
        ]}
      />,
    );
    screen.getByRole('button', { name: 'Actions for Chicken shawarma plate' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menuitem', { name: 'Edit item' })).toHaveFocus();
    // The visible reason is part of the item's accessible name (#675).
    const locked = screen.getByRole('menuitem', { name: /^Change price/ });
    expect(locked).toHaveAccessibleName(/^Change price,\s*Locked while an order is open$/);
    expect(locked).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{ArrowDown}');
    expect(locked).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('menuitem', { name: 'Remove item' })).toHaveAttribute('data-destructive', 'true');
    await user.click(screen.getByRole('menuitem', { name: 'Edit item' }));
    expect(onSelect).toHaveBeenCalledWith('edit', expect.objectContaining({ label: 'Edit item' }));
  });

  it('an item with `checked` is a menuitemradio with aria-checked (restaurant pause menu)', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <Menu
        label="Pause new orders"
        trigger="Pause"
        variant="tonal"
        onSelect={onSelect}
        items={[
          { key: '15', label: '15 minutes', checked: true },
          { key: '30', label: '30 minutes', checked: false },
          { key: 'close', label: 'Until closing', checked: false, separatorBefore: true },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByRole('menu', { name: 'Pause new orders' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: '15 minutes' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: '30 minutes' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getAllByRole('separator')).toHaveLength(1);
    await user.click(screen.getByRole('menuitemradio', { name: '30 minutes' }));
    expect(onSelect).toHaveBeenCalledWith('30', expect.objectContaining({ label: '30 minutes' }));
  });

  it('an icon-only trigger always draws a glyph (never an empty, invisible button)', () => {
    render(<Menu label="Actions for order HG-10482" items={[{ label: 'Open order' }]} />);
    const trigger = screen.getByRole('button', { name: 'Actions for order HG-10482' });
    expect(trigger.querySelector('svg, [data-slot="menu-trigger-dots"]')).not.toBeNull();
  });

  it('reports two triggers with the same name', () => {
    const report = vi.fn();
    setClientErrorReporter(report);
    render(
      <>
        <Menu label="Actions" items={[]} />
        <Menu label="Actions" items={[]} />
      </>,
    );
    expect(report).toHaveBeenCalledWith('MENU_LABEL_DUPLICATE', { label: 'Actions', count: 2 });
  });
});

describe('StatusTimeline', () => {
  it('marks the current step stalled once the deadline has passed, and names steps with 12-hour times', () => {
    render(
      <StatusTimeline
        audience="customer"
        state="RESTAURANT_PENDING"
        deadlineAt={iso(NOW)}
        now={NOW + 600_000}
        transitions={[{ to_state: 'AUTHORIZED', at: '2026-10-10T18:42:00Z' }]}
      />,
    );
    const stalled = screen.getByRole('listitem', { current: 'step' });
    expect(stalled).toHaveAttribute('data-step-state', 'stalled');
    const placed = screen.getAllByRole('listitem')[0]!;
    expect(placed).toHaveAccessibleName(`Placed, done, ${formatTime12h('2026-10-10T18:42:00Z')}`);
    expect(formatTime12h('2026-10-10T18:42:00Z')).toMatch(/^\d{1,2}:\d{2} (am|pm)$/);
  });

  it('draws a rejection on the step where it happened, and nothing after it looks like progress', () => {
    const { steps, failed } = resolveTimeline({ audience: 'customer', state: 'REJECTED' });
    expect(failed).toBe(true);
    expect(steps.map((s) => s.state)).toEqual(['complete', 'failed', 'unreached', 'unreached', 'unreached']);
    expect(steps[1]!.detail).toMatch(/rejected/i);
  });
});

function Speaker({ messages }: { messages: Array<[string, 'polite' | 'assertive', string?]> }) {
  const announce = useAnnounce();
  useEffect(() => {
    for (const [message, politeness, dedupeKey] of messages) announce(message, { politeness, dedupeKey });
  }, [announce, messages]);
  return null;
}

describe('PageAnnouncer', () => {
  it('speaks at most one assertive message per interval and drops a repeated dedupe key', () => {
    render(
      <PageAnnouncerProvider minIntervalMs={5000}>
        <Speaker
          messages={[
            ['C8T4, 10 seconds left to accept.', 'assertive', 'C8T4:10'],
            ['C8T4, 10 seconds left to accept.', 'assertive', 'C8T4:10'],
            ['B3M9, 18 seconds left to accept.', 'assertive', 'B3M9:10'],
          ]}
        />
      </PageAnnouncerProvider>,
    );
    const assertive = screen.getByRole('alert');
    expect(assertive).toHaveTextContent('C8T4, 10 seconds left to accept.');
    act(() => vi.advanceTimersByTime(4_000));
    expect(assertive).toHaveTextContent('C8T4');
    act(() => vi.advanceTimersByTime(1_100));
    expect(assertive).toHaveTextContent('B3M9, 18 seconds left to accept.');
  });

  it('does not repeat the same text within 5 seconds, but says it again after (#675)', () => {
    let announce: ReturnType<typeof usePageAnnouncer>['announce'] = () => undefined;
    function Grab() {
      announce = usePageAnnouncer().announce;
      return null;
    }
    render(
      <PageAnnouncerProvider politeIntervalMs={0}>
        <Grab />
      </PageAnnouncerProvider>,
    );
    const polite = screen.getByRole('status');
    act(() => announce('New order A7K2.'));
    expect(polite).toHaveTextContent('New order A7K2.');
    act(() => announce('Order B3M9 accepted.'));
    act(() => vi.advanceTimersByTime(10));
    act(() => announce('New order A7K2.'));
    act(() => vi.advanceTimersByTime(10));
    expect(polite).toHaveTextContent('Order B3M9 accepted.');
    act(() => vi.advanceTimersByTime(5_000));
    act(() => announce('New order A7K2.'));
    act(() => vi.advanceTimersByTime(10));
    expect(polite).toHaveTextContent('New order A7K2.');
    // The same text again after the window is a DOM change, so a screen reader speaks it again.
    const before = polite.textContent;
    act(() => vi.advanceTimersByTime(5_000));
    act(() => announce('New order A7K2.'));
    act(() => vi.advanceTimersByTime(10));
    expect(polite).toHaveTextContent('New order A7K2.');
    expect(polite.textContent).not.toBe(before);
  });
});

describe('halal messages are never danger (invariant 9)', () => {
  it('refuses danger at the type level', () => {
    // @ts-expect-error — HalalMessageTone excludes danger.
    const red: HalalMessageTone = 'danger';
    // @ts-expect-error — HalalBanner only takes HalalMessageTone.
    const props: HalalBannerProps = { tone: 'danger', title: 'Certificate expired' };
    void red;
    void props;
    // @ts-expect-error — a Banner marked halal cannot be danger either.
    const element = <Banner halal tone="danger" title="Certificate expired" />;
    void element;
    expect(true).toBe(true);
  });

  it('draws a danger tone that slips past the types as slate, and reports it', () => {
    const report = vi.fn();
    setClientErrorReporter(report);
    render(<HalalBanner tone={'danger' as HalalMessageTone} title="Certificate expired" />);
    const banner = screen.getByTestId('HalalBanner');
    expect(banner).toHaveAttribute('data-tone', 'slate');
    expect(banner.className).not.toMatch(/danger/);
    expect(report).toHaveBeenCalledWith('HALAL_TONE_DANGER', { component: 'Banner' });
  });
});

describe('InlineAlert', () => {
  it('a blocking alert takes focus on mount, is assertive, and lists its findings (#699)', () => {
    render(
      <InlineAlert
        blocking
        tone="warning"
        title="Approval is blocked"
        items={[
          { id: 'h4', code: 'H4', content: 'The certificate number does not match the issuer register.' },
          { id: 'h6', code: 'H6', content: 'The supplier list is missing.' },
        ]}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveFocus();
    expect(alert).toHaveAttribute('tabindex', '-1');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('H4')).toBeInTheDocument();
  });
});
