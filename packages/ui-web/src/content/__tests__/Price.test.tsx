/**
 * `Price` formats integer cents, and will not compile against a float.
 *
 * The `@ts-expect-error` lines are the substantive assertions: they fail `pnpm typecheck` the
 * moment the prop stops being branded, which is the only way this rule can actually be enforced.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { cents, MoneyError } from '@hg/api-client';
import { Price } from '../Price';

afterEach(cleanup);

describe('Price — cents in, CAD out', () => {
  it('formats integer cents as CAD', () => {
    render(<Price cents={cents(1234)} />);
    expect(screen.getByTestId('Price')).toHaveTextContent('$12.34');
  });

  it('reads as words, not as the glyph string', () => {
    render(<Price cents={cents(1234)} />);
    // Screen readers render "$12.34" inconsistently, so the spoken form is authoritative.
    expect(screen.getByTestId('Price')).toHaveTextContent('12.34 Canadian dollars');
  });

  it('renders a true minus, never a hyphen', () => {
    render(<Price cents={cents(-300)} />);
    expect(screen.getByTestId('Price').textContent).toContain('−$3.00');
    expect(screen.getByTestId('Price').textContent).not.toContain('-$3.00');
  });

  it('renders the free label at zero, and never a blank', () => {
    render(<Price cents={cents(0)} free="Free delivery" />);
    expect(screen.getByTestId('Price')).toHaveTextContent('Free delivery');
    cleanup();

    render(<Price cents={cents(0)} />);
    expect(screen.getByTestId('Price')).toHaveTextContent('$0.00');
  });

  it('appends the currency code for receipts and refund records', () => {
    render(<Price cents={cents(4696)} showCode />);
    expect(screen.getByTestId('Price')).toHaveTextContent('$46.96 CAD');
  });

  it('prefixes a strikethrough price with "was"', () => {
    render(<Price cents={cents(1500)} strikethrough />);
    expect(screen.getByTestId('Price').textContent).toContain('was ');
  });

  it('rejects a float at the money boundary', () => {
    // The brand can only be obtained through `cents()`, and `cents()` refuses non-integers. So
    // the `0.1 + 0.2` and `Math.round(x * 100)` families of bug cannot reach this component.
    expect(() => cents(12.5)).toThrow(MoneyError);
  });

  it('rejects floats and bare numbers at the type level', () => {
    // @ts-expect-error — a float is not money.
    void (() => <Price cents={12.5} />);

    // @ts-expect-error — nor is an unbranded integer: it has not passed the integer check.
    void (() => <Price cents={1250} />);

    // @ts-expect-error — and there is no `formatted` escape hatch that would let a caller
    // invent a price.
    void (() => <Price cents={cents(1250)} formatted="$12.50" />);

    expect(true).toBe(true);
  });
});
