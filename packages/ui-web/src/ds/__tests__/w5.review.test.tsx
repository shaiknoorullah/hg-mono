/**
 * W5 review regressions: the defects found in the adversarial review of the halal family, each
 * pinned by the smallest test that failed before its fix.
 *
 * - An impossible wire date ("2026-02-30") must not roll over into an invented expiry.
 * - A revealed PII value hides after its time box even when the parent re-renders or controls it.
 * - A decision confirmation never stays actionable once deciding is switched off.
 * - A restricted row that still holds a recorded Pass says so instead of looking unrecorded.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HalalBadge, formatHalalLongDate, formatHalalShortDate } from '../index';
import { DecisionBar, JustifiedReveal, SevenChecks } from '../../proposed/index';
import { check, gates, sevenChecks } from './w5-fixtures';

const noop = () => {};

afterEach(() => vi.useRealTimers());

describe('halal dates never invent a day', () => {
  it.each(['2026-02-30', '2026-04-31', '2026-02-30T10:00:00Z', '2026-13-01', 'soon'])('%s is unparseable', (value) => {
    expect(formatHalalShortDate(value)).toBeNull();
    expect(formatHalalLongDate(value)).toBeNull();
  });

  it('an impossible expiry shows the base label, with no date', () => {
    render(<HalalBadge state="EXPIRING_SOON" expiresOn="2026-02-30" />);
    expect(screen.getByRole('img')).toHaveAccessibleName('Halal certified');
    expect(screen.getByRole('img')).toHaveTextContent(/^Halal certified$/);
  });

  it('valid dates still parse, including a leap day', () => {
    expect(formatHalalShortDate('2028-02-29')).toBe('29 Feb');
    expect(formatHalalLongDate('2026-10-20T15:00:00Z')).toBe('20 October 2026');
  });
});

describe('JustifiedReveal time box', () => {
  it('a parent re-rendering with a new onHide does not restart the 5-minute timer', async () => {
    vi.useFakeTimers();
    const onReveal = vi.fn(async () => 'fatima.noor@gmail.com');
    const view = (onHide: () => void) => (
      <JustifiedReveal fieldLabel="email" maskedValue="f•••@gmail.com" onReveal={onReveal} onHide={onHide} defaultOpen />
    );
    const { rerender } = render(view(() => {}));
    fireEvent.change(screen.getByRole('combobox', { name: /Reason/ }), { target: { value: 'VERIFYING_IDENTITY' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reveal email' }));
    });
    expect(screen.getByTestId('JustifiedReveal-value')).toHaveTextContent('fatima.noor@gmail.com');
    for (let i = 0; i < 6; i += 1) {
      act(() => vi.advanceTimersByTime(60_000));
      rerender(view(() => {}));
    }
    expect(screen.getByTestId('JustifiedReveal-value')).toHaveTextContent('f•••@gmail.com');
  });

  it('a controlled revealed value is hidden after the time box too, and onHide is called', () => {
    vi.useFakeTimers();
    const onHide = vi.fn();
    render(
      <JustifiedReveal fieldLabel="email" maskedValue="f•••@gmail.com" onReveal={async () => 'x'} revealed="fatima.noor@gmail.com" onHide={onHide} />,
    );
    expect(screen.getByTestId('JustifiedReveal-value')).toHaveTextContent('fatima.noor@gmail.com');
    act(() => vi.advanceTimersByTime(5 * 60_000 + 1));
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('JustifiedReveal-value')).toHaveTextContent('f•••@gmail.com');
  });

  it('works without a maskedValue (packet P30 props), showing a mask', () => {
    render(<JustifiedReveal fieldLabel="email" reasons={[{ value: 'VERIFYING_IDENTITY', label: 'Verifying identity' }]} onReveal={async () => 'x'} />);
    expect(screen.getByTestId('JustifiedReveal-value')).toHaveTextContent('••••');
  });
});

describe('DecisionBar once deciding is switched off', () => {
  it('closes an open confirmation, so no confirm button stays pressable', () => {
    const g = gates(sevenChecks());
    const onApprove = vi.fn();
    const { rerender } = render(<DecisionBar approveGate={g.approve} rejectGate={g.reject} onApprove={onApprove} onReject={noop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve…' }));
    expect(screen.getByRole('button', { name: 'Approve certificate' })).toBeInTheDocument();
    rerender(<DecisionBar approveGate={g.approve} rejectGate={g.reject} onApprove={onApprove} onReject={noop} disabledReason="your claim ended at 2:48 pm" />);
    expect(screen.queryByRole('button', { name: 'Approve certificate' })).toBeNull();
    expect(screen.getByRole('button', { name: /Approve…, unavailable: your claim ended/ })).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('SevenChecks restricted row with a recorded Pass', () => {
  it('says the stored Pass, which can no longer be chosen', () => {
    render(
      <SevenChecks
        checks={sevenChecks({ H2_ISSUER_ACCEPTED: check('H2_ISSUER_ACCEPTED', 'PASS') })}
        onCheckChange={noop}
        restrictedKeys={['H2_ISSUER_ACCEPTED']}
        restrictionReasons={{ H2_ISSUER_ACCEPTED: 'HFSAA is Suspended in the registry.' }}
      />,
    );
    expect(screen.getByText(/Recorded as Pass, which no longer stands/)).toBeInTheDocument();
  });
});
