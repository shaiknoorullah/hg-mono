/**
 * Invariant 3 (AGENTS.md §3): money is int64 minor units. MoneyInput is the one place a person
 * types an amount, so it must never emit a fraction, whatever is typed, and never route the
 * text through a float.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { Cents } from '@hg/api-client';

import { MoneyInput, formatCentsPlain, parseMoneyInput } from '../MoneyInput';

describe('MoneyInput emits integer cents only', () => {
  it('parses exact decimal strings to exact integers (no float rounding)', () => {
    const cases: Array<[string, number]> = [
      ['0.29', 29],
      ['0.1', 10],
      ['1.005'.slice(0, 4), 100],
      ['12', 1200],
      ['12.5', 1250],
      ['12.50', 1250],
      ['$12.34', 1234],
      ['.75', 75],
      ['19.99', 1999],
      ['999999999.99', 99999999999],
    ];
    for (const [text, cents] of cases) {
      const parsed = parseMoneyInput(text);
      expect(parsed, text).toEqual({ kind: 'ok', cents });
      if (parsed.kind === 'ok') expect(Number.isInteger(parsed.cents)).toBe(true);
    }
  });

  it('rejects anything that could carry a fraction of a cent or a non-decimal form', () => {
    for (const text of ['1.005', '0.001', '1e3', '1,000', '-5', '12.', 'abc', '1.2.3', '.', 'Infinity', 'NaN', '0x10', '1 000', '1234567890']) {
      const parsed = parseMoneyInput(text);
      // "12." is accepted as 12 dollars (a half-typed decimal); everything else is invalid.
      if (text === '12.') expect(parsed).toEqual({ kind: 'ok', cents: 1200 });
      else expect(parsed, text).toEqual({ kind: 'invalid' });
    }
    expect(parseMoneyInput('   ')).toEqual({ kind: 'empty' });
    expect(parseMoneyInput('$')).toEqual({ kind: 'empty' });
  });

  it('never calls onValueChange with a non-integer, for any keystroke sequence', () => {
    const onValueChange = vi.fn();
    render(<MoneyInput label="Goodwill amount" valueCents={null} onValueChange={onValueChange} />);
    const input = screen.getByRole('textbox', { name: 'Goodwill amount' });
    for (const text of ['1', '1.', '1.0', '1.00', '1.005', '0.29', '0.3', '1e2', '-1', '12.345', '7.7', '']) {
      fireEvent.change(input, { target: { value: text } });
    }
    expect(onValueChange).toHaveBeenCalled();
    for (const [value] of onValueChange.mock.calls) {
      expect(value === null || Number.isSafeInteger(value), String(value)).toBe(true);
    }
    expect(onValueChange.mock.calls.map(([v]) => v)).toEqual([100, 100, 100, 100, 29, 30, 770]);
  });

  it('shows a format error and emits null for invalid text; shows the limit through Price and errors above it', () => {
    const onValueChange = vi.fn();
    render(<MoneyInput label="Refund" valueCents={null} maxCents={5000 as Cents} onValueChange={onValueChange} />);
    const input = screen.getByRole('textbox', { name: 'Refund' });
    expect(screen.getByText(/Up to/)).toHaveTextContent('$50.00');
    fireEvent.change(input, { target: { value: '12.345' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Enter dollars and cents, like 12.50.');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(input, { target: { value: '50.01' } });
    expect(screen.getByRole('alert')).toHaveTextContent('The most you can enter is $50.00.');
    expect(onValueChange).not.toHaveBeenCalledWith(5001);
    fireEvent.change(input, { target: { value: '50' } });
    expect(onValueChange).toHaveBeenLastCalledWith(5000);
    fireEvent.blur(input);
    expect(input).toHaveValue('50.00');
  });

  it('formats cents with integer division only', () => {
    expect(formatCentsPlain(5)).toBe('0.05');
    expect(formatCentsPlain(1250)).toBe('12.50');
    expect(formatCentsPlain(99999999999)).toBe('999999999.99');
  });

  it('the source never parses money through a float', () => {
    const withComments = readFileSync(resolve(process.cwd(), 'src/proposed/MoneyInput.tsx'), 'utf8');
    // The doc comment names the forbidden calls; check the code only.
    const src = withComments.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/parseFloat|Number\(\s*text|\*\s*100\s*\)|toFixed/);
  });
});
