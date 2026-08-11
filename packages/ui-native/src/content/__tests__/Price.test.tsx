/**
 * `Price` has one job and one prohibition: format integer cents, and never accept a float.
 * The prohibition is the interesting half, and it is enforced by the type system — which is
 * why part of this file is `@ts-expect-error` rather than runtime assertions.
 */
import { cents } from '@hg/api-client';

import { formatPrice, spokenPrice } from '../Price';
import type { PriceProps } from '../Price';

describe('Price — formatting', () => {
  it('formats integer cents as CAD', () => {
    expect(formatPrice(cents(1234))).toBe('$12.34');
    expect(formatPrice(cents(4696))).toBe('$46.96');
    expect(formatPrice(cents(100))).toBe('$1.00');
  });

  it('never renders zero blank', () => {
    expect(formatPrice(cents(0))).toBe('$0.00');
    expect(formatPrice(cents(0), { free: 'Free delivery' })).toBe('Free delivery');
  });

  it('renders a negative with a true minus, not a hyphen', () => {
    const rendered = formatPrice(cents(-300));
    expect(rendered).toBe('−$3.00');
    expect(rendered).not.toContain('-');
  });

  it('signs ledger deltas explicitly when asked', () => {
    expect(formatPrice(cents(250), { sign: 'always' })).toBe('+$2.50');
    expect(formatPrice(cents(-250), { sign: 'never' })).toBe('$2.50');
  });

  it('appends the currency code on receipts and refund records', () => {
    expect(formatPrice(cents(1999), { showCode: true })).toBe('$19.99 CAD');
  });

  it('speaks the amount instead of handing the screen reader the glyph string', () => {
    expect(spokenPrice(cents(1234))).toBe('12 dollars and 34 cents');
    expect(spokenPrice(cents(100))).toBe('1 dollar');
    expect(spokenPrice(cents(1))).toBe('1 cent');
    expect(spokenPrice(cents(-300))).toBe('minus 3 dollars');
    expect(spokenPrice(cents(1234), { strikethrough: true })).toBe('was 12 dollars and 34 cents');
  });
});

describe('Price — floats cannot reach it', () => {
  it('rejects a bare number at the type level', () => {
    // A bare `number` is not `Cents`. This is the guard that makes the bug which puts
    // $19.989999999999998 on a receipt unrepresentable rather than merely unlikely.
    //
    // These are declarations, never evaluated: the assertion is that `tsc` reports each one,
    // and `@ts-expect-error` fails the build if it ever stops doing so.

    // @ts-expect-error `Cents` is branded; a plain integer is not assignable to it.
    const bareInteger: PriceProps = { cents: 1999 };
    // @ts-expect-error a float is a number, and a number is still not `Cents`.
    const float: PriceProps = { cents: 19.99 };
    // @ts-expect-error there is no `value` prop, and there never will be.
    const legacyValue: PriceProps = { value: 1999 };
    // @ts-expect-error there is no `formatted` prop — it would let a caller invent a price.
    const preformatted: PriceProps = { formatted: '$19.99' };

    // The branded form is the only one that compiles.
    const good: PriceProps = { cents: cents(1999) };

    expect([bareInteger, float, legacyValue, preformatted, good]).toHaveLength(5);
  });

  it('refuses to brand a float at runtime, at the boundary rather than at the glyph', () => {
    expect(() => cents(19.99)).toThrow();
    expect(() => cents(0.1 + 0.2)).toThrow();
  });
});
