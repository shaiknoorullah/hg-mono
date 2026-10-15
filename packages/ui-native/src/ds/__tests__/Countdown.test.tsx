/**
 * Countdown pins the deadline rules: server clock only, skew handled, onExpire exactly once,
 * never a negative number, nothing rendered for a deadline already past, and announcements
 * at 50/25/10/0 % unless silent.
 */
import { act, screen } from '@testing-library/react-native';

import { Countdown } from '..';
import { setAnnouncerSink } from '../../lib/announcer';
import {
  clockBase,
  crossedMarks,
  formatClock,
  phaseOf,
  remainingSeconds,
  spokenSeconds,
  trustedNow,
} from '../../lib/countdown';
import { renderThemed, styleOf, themes } from '../../primitives/__tests__/harness';

const T0 = Date.parse('2026-10-10T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
/** A fresh 30-second window from T0: the rider offer's shape. */
const OFFER = { expiresAt: iso(T0 + 30_000), serverNow: iso(T0), windowSeconds: 30 };

let spoken: string[] = [];
beforeEach(() => {
  jest.useFakeTimers({ now: T0 });
  spoken = [];
  setAnnouncerSink((m) => spoken.push(m));
});
afterEach(() => {
  setAnnouncerSink(null);
  jest.useRealTimers();
});

describe('countdown arithmetic', () => {
  it('trusts the device clock within 5 s of the server, and the server beyond', () => {
    const near = clockBase(T0, T0 - 3_000, 0);
    expect(trustedNow(near, T0 - 3_000 + 1_000, 1_000)).toBe(T0 - 2_000);
    // A phone ten minutes fast still counts from the server's clock.
    const fast = clockBase(T0, T0 + 600_000, 0);
    expect(trustedNow(fast, T0 + 600_000 + 4_000, 4_000)).toBe(T0 + 4_000);
  });

  it('never goes negative, and phases by the fraction left', () => {
    expect(remainingSeconds(T0, T0 + 5_000)).toBe(0);
    expect(remainingSeconds(T0 + 1_200, T0)).toBe(2);
    expect(phaseOf(20, 30)).toBe('normal');
    expect(phaseOf(7, 30)).toBe('urgent');
    expect(phaseOf(2, 30)).toBe('critical');
    expect(phaseOf(0, 30)).toBe('expired');
    expect(formatClock(185)).toBe('3:05');
    expect(spokenSeconds(65)).toBe('1 minute 5 seconds');
    expect(spokenSeconds(1)).toBe('1 second');
    expect(crossedMarks(14, 30, new Set())).toEqual([0.5]);
  });
});

describe('Countdown', () => {
  it('counts from the server clock even when the phone is ten minutes fast', () => {
    jest.setSystemTime(T0 + 600_000);
    renderThemed(
      <Countdown {...OFFER} label="to accept" />,
    );
    expect(screen.getByText('0:30')).toBeTruthy();
    expect(screen.getByLabelText('to accept: 30 seconds left')).toBeTruthy();
  });

  it('fires onExpire exactly once and stops at 0:00', () => {
    const onExpire = jest.fn();
    const { rerender } = renderThemed(
      <Countdown expiresAt={iso(T0 + 3_000)} serverNow={iso(T0)} windowSeconds={30} onExpire={onExpire} />,
    );
    act(() => jest.advanceTimersByTime(10_000));
    expect(screen.getByText('0:00')).toBeTruthy();
    expect(onExpire).toHaveBeenCalledTimes(1);
    // A new callback identity does not restart the timer or fire again.
    const next = jest.fn();
    rerender(<Countdown expiresAt={iso(T0 + 3_000)} serverNow={iso(T0)} windowSeconds={30} onExpire={next} />);
    act(() => jest.advanceTimersByTime(2_000));
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });

  it('renders nothing and fires once when the deadline had already passed at mount', () => {
    const onExpire = jest.fn();
    const { toJSON } = renderThemed(
      <Countdown expiresAt={iso(T0 - 1_000)} serverNow={iso(T0)} windowSeconds={30} onExpire={onExpire} />,
    );
    expect(toJSON()).toBeNull();
    act(() => jest.advanceTimersByTime(1_000));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('renders nothing for an unparseable deadline', () => {
    const { toJSON } = renderThemed(<Countdown expiresAt="soon" serverNow={iso(T0)} windowSeconds={30} />);
    expect(toJSON()).toBeNull();
  });

  it('announces 50, 25, 10 % and time up once each; never the marks passed before mount', () => {
    renderThemed(<Countdown expiresAt={iso(T0 + 12_000)} serverNow={iso(T0)} windowSeconds={30} />);
    // 12 of 30 left at mount: the 50 % mark is already behind, so it is recorded silently.
    act(() => jest.advanceTimersByTime(13_000));
    expect(spoken).toEqual(['8 seconds left.', '3 seconds left.', 'Time is up.']);
  });

  it('stays quiet when silent', () => {
    renderThemed(<Countdown silent {...OFFER} />);
    act(() => jest.advanceTimersByTime(31_000));
    expect(spoken).toEqual([]);
  });

  it('paints info, then warning, then danger as the window runs out', () => {
    const light = themes.customer.light.color.feedback;
    renderThemed(<Countdown {...OFFER} />);
    const colour = () => styleOf(screen.getByTestId('Countdown-numeral', { includeHiddenElements: true })).color;
    expect(colour()).toBe(light.info.icon);
    act(() => jest.advanceTimersByTime(24_000));
    expect(colour()).toBe(light.warning.text);
    act(() => jest.advanceTimersByTime(4_000));
    expect(colour()).toBe(light.danger.icon);
  });

  it('takes the dark scheme roles on the rider field surface', () => {
    renderThemed(<Countdown onDark {...OFFER} />, {
      theme: 'rider',
    });
    const numeral = screen.getByTestId('Countdown-numeral', { includeHiddenElements: true });
    expect(styleOf(numeral).color).toBe(themes.rider.dark.color.text.primary);
  });

  it('draws a ring and a bar, and bar-only hides the numeral but keeps the name', () => {
    renderThemed(<Countdown variant="ring" {...OFFER} />);
    expect(screen.getByTestId('Countdown-ring', { includeHiddenElements: true })).toBeTruthy();
    renderThemed(
      <Countdown
        variant="bar"
        barOnly
        testId="bar"
        {...OFFER}
      />,
    );
    expect(screen.queryByTestId('bar-numeral', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByLabelText('30 seconds left')).toBeTruthy();
  });
});
