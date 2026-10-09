/**
 * W1 Core contract: every rebuilt component, every declared state, in one table.
 *
 * Per state: it renders; it exposes the role and accessible name its README specifies;
 * aria-disabled / aria-busy where the state calls for them; and the target-size classes
 * (44 / 72) are present, since jsdom cannot measure layout. Then a few dedicated tests for the
 * invariant-bearing behaviour: integer money, no success green, a missing halal value renders
 * no badge, a disabled submit cannot submit, unknown icons render nothing, 12-hour times.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as ds from '../index';
import * as proposed from '../../proposed/index';

const {
  Badge, Button, Card, Icon, IconButton, ICON_MAP, ICON_NAMES, KeyValueList, Price, StatCard,
  formatTime12h, setClientErrorReporter,
} = ds;
const { Separator, Skeleton, Spinner, Tooltip } = proposed;

afterEach(() => setClientErrorReporter(null));

interface StateCase {
  state: string;
  el: ReactElement;
  /** Role and accessible name to find; omit for non-interactive, aria-hidden parts. */
  role?: string;
  name?: string | RegExp;
  disabled?: boolean;
  busy?: boolean;
  /** Classes that must be on the found element (target sizes). */
  classes?: string[];
  /** The component renders nothing on purpose. */
  empty?: boolean;
}

const REGISTRY: Record<string, StateCase[]> = {
  Button: [
    ...(['primary', 'secondary', 'tertiary', 'ghost', 'danger', 'link'] as const).map((variant) => ({
      state: variant,
      el: <Button variant={variant}>Track order</Button>,
      role: 'button',
      name: 'Track order',
    })),
    { state: 'sm', el: <Button size="sm">Skip</Button>, role: 'button', name: 'Skip', classes: ['min-h-9', 'after:min-h-11'] },
    { state: 'md', el: <Button size="md">Save</Button>, role: 'button', name: 'Save', classes: ['min-h-11'] },
    { state: 'lg', el: <Button size="lg">Save</Button>, role: 'button', name: 'Save', classes: ['min-h-13'] },
    { state: 'xl', el: <Button size="xl">Save</Button>, role: 'button', name: 'Save', classes: ['min-h-15'] },
    { state: 'critical', el: <Button critical>Accept</Button>, role: 'button', name: 'Accept', classes: ['min-h-18'] },
    { state: 'disabled', el: <Button disabled>Place order</Button>, role: 'button', name: 'Place order', disabled: true },
    { state: 'loading', el: <Button loading>Place order</Button>, role: 'button', name: 'Place order', busy: true },
    { state: 'href', el: <Button href="/menu" iconEnd="chevron-right">View menu</Button>, role: 'link', name: 'View menu' },
    { state: 'href-disabled', el: <Button href="/menu" disabled>View menu</Button>, role: 'link', name: 'View menu', disabled: true },
    { state: 'on-chrome', el: <Button variant="tertiary" tone="onChrome">Sign out</Button>, role: 'button', name: 'Sign out' },
    { state: 'price', el: <Button priceCents={1234}>Add to order</Button>, role: 'button', name: /Add to order\s*12 dollars and 34 cents/ },
    { state: 'accessibilityLabel', el: <Button accessibilityLabel="Back to Orders">Back</Button>, role: 'button', name: 'Back to Orders' },
  ],
  IconButton: [
    ...(['plain', 'filled', 'tonal'] as const).map((variant) => ({
      state: variant,
      el: <IconButton icon="search" accessibilityLabel="Search" variant={variant} />,
      role: 'button',
      name: 'Search',
    })),
    { state: 'sm', el: <IconButton icon="close" accessibilityLabel="Close" size="sm" />, role: 'button', name: 'Close', classes: ['size-9', 'after:min-h-11'] },
    { state: 'md', el: <IconButton icon="close" accessibilityLabel="Close" size="md" />, role: 'button', name: 'Close', classes: ['size-11'] },
    { state: 'lg', el: <IconButton icon="close" accessibilityLabel="Close" size="lg" />, role: 'button', name: 'Close', classes: ['size-14'] },
    { state: 'circle', el: <IconButton icon="cart" accessibilityLabel="Cart" shape="circle" />, role: 'button', name: 'Cart', classes: ['rounded-full'] },
    { state: 'count', el: <IconButton icon="cart" accessibilityLabel="Cart" badge={3} badgeNoun="items" />, role: 'button', name: 'Cart, 3 items' },
    { state: 'dot', el: <IconButton icon="bell" accessibilityLabel="Notifications" badge />, role: 'button', name: 'Notifications, new' },
    { state: 'loading', el: <IconButton icon="refresh" accessibilityLabel="Refresh" loading />, role: 'button', name: 'Refresh', busy: true },
    { state: 'disabled', el: <IconButton icon="plus" accessibilityLabel="Add item" disabled />, role: 'button', name: 'Add item', disabled: true },
  ],
  Card: [
    ...(['elevated', 'outlined', 'filled'] as const).map((variant) => ({
      state: variant,
      el: <Card variant={variant}>Body</Card>,
    })),
    { state: 'interactive', el: <Card onPress={() => {}} accessibilityLabel="Zaytoun Grill, open">Body</Card>, role: 'button', name: 'Zaytoun Grill, open' },
    { state: 'href', el: <Card href="/r/1" accessibilityLabel="Zaytoun Grill">Body</Card>, role: 'link', name: 'Zaytoun Grill' },
  ],
  Badge: [
    ...(['neutral', 'info', 'warning', 'danger', 'brand', 'outline'] as const).flatMap((variant) =>
      (['tint', 'solid', 'dot'] as const).map((appearance) => ({
        state: `${variant}-${appearance}`,
        el: <Badge variant={variant} appearance={appearance}>Closing soon</Badge>,
      })),
    ),
    { state: 'empty', el: <Badge appearance="dot" />, empty: true },
  ],
  Price: [
    { state: 'default', el: <Price cents={1234} />, name: '12 dollars and 34 cents' },
    { state: 'display-lg', el: <Price cents={4187} size="display-lg" />, name: '41 dollars and 87 cents' },
    { state: 'strikethrough', el: <Price cents={3299} strikethrough />, name: 'was 32 dollars and 99 cents' },
    { state: 'free', el: <Price cents={0} free="Free delivery" />, name: 'Free delivery' },
    { state: 'negative', el: <Price cents={-300} />, name: 'minus 3 dollars' },
    { state: 'loading', el: <Price cents={4187} loading />, busy: true },
    { state: 'non-integer', el: <Price cents={12.5} />, empty: true },
  ],
  KeyValueList: [
    { state: 'default', el: <KeyValueList items={[{ label: 'Restaurant', value: 'Zaytoun Grill' }]} /> },
    { state: 'loading', el: <KeyValueList loading items={[{ label: 'Restaurant' }]} /> },
    { state: 'empty', el: <KeyValueList items={[]} /> },
    { state: 'dense', el: <KeyValueList dense items={[{ label: 'Certificate', value: 'HMA-2291', mono: true }]} /> },
  ],
  StatCard: [
    { state: 'value', el: <StatCard label="Trips" value="14" />, role: 'group', name: 'Trips' },
    { state: 'money', el: <StatCard label="Gross" cents={41870} />, role: 'group', name: 'Gross' },
    { state: 'loading', el: <StatCard label="Trips" loading />, role: 'group', name: 'Trips', busy: true },
    { state: 'error', el: <StatCard label="Trips" error="Couldn't load" />, role: 'group', name: 'Trips' },
    { state: 'empty', el: <StatCard label="Trips" />, role: 'group', name: 'Trips' },
    { state: 'warning', el: <StatCard label="Residual" cents={12} tone="warning" hint="Ledger does not balance" />, role: 'group', name: 'Residual' },
  ],
  Skeleton: [
    ...(['text', 'rect', 'circle', 'card'] as const).map((shape) => ({ state: shape, el: <Skeleton shape={shape} /> })),
    ...(['lines', 'rows', 'block'] as const).map((variant) => ({ state: `variant ${variant}`, el: <Skeleton variant={variant} /> })),
    // A status takes no name from its content; the words are its announced text (checked below).
    { state: 'labelled', el: <Skeleton variant="rows" label="Loading orders" />, role: 'status' },
  ],
  Spinner: [
    { state: 'status', el: <Spinner label="Loading orders" />, role: 'status', name: 'Loading orders' },
    { state: 'decorative', el: <Spinner decorative /> },
    { state: 'no label', el: <Spinner size="sm" /> },
  ],
  Separator: [
    { state: 'decorative', el: <Separator /> },
    { state: 'labelled', el: <Separator label="Earlier today" />, role: 'separator', name: 'Earlier today' },
  ],
  Tooltip: [
    {
      state: 'trigger',
      el: <Tooltip open content="14 March 2027, 2:41 pm"><Button variant="ghost">14 Mar</Button></Tooltip>,
      role: 'tooltip',
      name: '14 March 2027, 2:41 pm',
    },
  ],
};

describe('W1 contract registry', () => {
  for (const [component, cases] of Object.entries(REGISTRY)) {
    describe(component, () => {
      for (const c of cases) {
        it(c.state, () => {
          const report = vi.fn();
          setClientErrorReporter(report);
          const { container } = render(c.el);
          if (c.empty) {
            expect(container).toBeEmptyDOMElement();
            expect(report).toHaveBeenCalled();
            return;
          }
          expect(container.firstChild).not.toBeNull();
          const testid = document.body.querySelector(`[data-testid="${component}"], [data-testid="${component}-loading"]`);
          expect(testid, 'testId defaults to the component name').not.toBeNull();
          const target = c.role
            ? screen.getByRole(c.role, c.name ? { name: c.name } : undefined)
            : c.name
              ? screen.getByText((_, el) => el?.textContent === c.name && !!el?.classList.contains('sr-only'))
              : (testid as HTMLElement);
          if (c.disabled) {
            expect(target).toHaveAttribute('aria-disabled', 'true');
            expect(target).not.toHaveAttribute('disabled');
          }
          if (c.busy) expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
          for (const cls of c.classes ?? []) expect(target.className).toContain(cls);
          if (c.disabled || c.role === 'button' || c.role === 'link') expect(target.tabIndex).toBeGreaterThanOrEqual(0);
        });
      }
    });
  }
});

describe('Button', () => {
  it('a disabled submit cannot submit, by click or by Enter', () => {
    const onSubmit = vi.fn((e: Event) => e.preventDefault());
    const onPress = vi.fn();
    render(
      <form onSubmit={onSubmit as never}>
        <Button type="submit" disabled onPress={onPress}>Save</Button>
      </form>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onPress).not.toHaveBeenCalled();
  });

  it('loading ignores presses and keeps the leading slot, so the width does not jump', () => {
    const onPress = vi.fn();
    const { rerender } = render(<Button loading={false} onPress={onPress}>Place order</Button>);
    const idle = screen.getByRole('button').children.length;
    rerender(<Button loading onPress={onPress}>Place order</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole('button').children.length).toBe(idle);
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-disabled');
  });
});

describe('App-track additions (#675, #699)', () => {
  it('Spinner without a label is decorative, never an unnamed status, and reports nothing', () => {
    const report = vi.fn();
    setClientErrorReporter(report);
    render(<Spinner size="sm" />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByTestId('Spinner')).toHaveAttribute('aria-hidden', 'true');
    expect(report).not.toHaveBeenCalled();
  });

  it('Skeleton label is one status line outside the hidden shapes', () => {
    render(<Skeleton variant="rows" label="Loading orders" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading orders');
    expect(status.closest('[aria-hidden="true"]')).toBeNull();
  });

  it('Skeleton rows draw count rows of 44px, hidden from assistive tech', () => {
    render(<Skeleton variant="rows" count={4} />);
    const el = screen.getByTestId('Skeleton');
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(el.querySelectorAll('.h-11')).toHaveLength(4);
  });

  it('StatCard warning is a tint with a border, never a solid', () => {
    render(<StatCard label="Residual" value="1" tone="warning" hint="Ledger does not balance" />);
    const card = screen.getByTestId('StatCard-card');
    expect(card.className).toContain('bg-feedback-warning-tint');
    expect(card.className).not.toMatch(/warning-solid/);
    expect(screen.getByText('Ledger does not balance')).toBeInTheDocument();
  });

  it('KeyValueList mono applies to a value, never to the missing-value words', () => {
    render(<KeyValueList items={[{ label: 'Code', value: 'A1B2', mono: true }, { label: 'Cert', value: null, mono: true }]} />);
    expect(screen.getByText('A1B2')).toHaveClass('font-mono');
    expect(screen.getByText('Not on file')).not.toHaveClass('font-mono');
  });

  it('Button form and name reach the native button', () => {
    render(<Button type="submit" form="decision" name="intent">Approve</Button>);
    const button = screen.getByRole('button', { name: 'Approve' });
    expect(button).toHaveAttribute('form', 'decision');
    expect(button).toHaveAttribute('name', 'intent');
  });
});

describe('Money (invariant 3)', () => {
  it('refuses a non-integer or missing amount: renders nothing and reports MONEY_NOT_INTEGER_CENTS', () => {
    for (const bad of [12.5, Number.NaN, undefined, '1234']) {
      const report = vi.fn();
      setClientErrorReporter(report);
      const { container, unmount } = render(<Price cents={bad as never} />);
      expect(container).toBeEmptyDOMElement();
      expect(report).toHaveBeenCalledWith('MONEY_NOT_INTEGER_CENTS', expect.objectContaining({ received: bad }));
      unmount();
    }
  });

  it('draws a negative amount with U+2212, never a hyphen, and signs deltas when asked', () => {
    render(<><Price cents={-300} /><Price cents={1850} sign="always" /><Price cents={4187} showCode /></>);
    const glyphs = [...document.querySelectorAll('[data-testid="Price"] [aria-hidden="true"]')].map((n) => n.textContent);
    expect(glyphs).toEqual(['−$3.00', '+$18.50', '$41.87 CAD']);
  });
});

describe('No success solid, no halal claim (invariants 8–10)', () => {
  it('Badge has no success tone: an unknown tone falls back to neutral and is reported', () => {
    const report = vi.fn();
    setClientErrorReporter(report);
    render(<Badge variant={'success' as never}>Paid</Badge>);
    expect(screen.getByTestId('Badge')).toHaveAttribute('data-variant', 'neutral');
    expect(report).toHaveBeenCalledWith('UNKNOWN_ENUM_VALUE', expect.objectContaining({ received: 'success' }));
  });

  it('KeyValueList renders a missing value as plain words, never a badge', () => {
    render(<KeyValueList items={[{ label: 'Restaurant halal status now', value: null }]} emptyValue="No halal status on file" />);
    expect(screen.getByText('No halal status on file')).toBeInTheDocument();
    expect(screen.queryByTestId('Badge')).toBeNull();
    expect(screen.queryByTestId('HalalBadge')).toBeNull();
    expect(document.querySelector('dl dt + dd')).not.toBeNull();
  });

  it('component sources use roles only: no hex, no rgb/hsl, no ramp names, no green solids, no left borders', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const dirs = [join(here, '..'), join(here, '..', '..', 'proposed'), join(here, '..', '..', 'lib', 'ui')];
    const files = dirs.flatMap((d) =>
      readdirSync(d).filter((f) => f.endsWith('.tsx') && !f.endsWith('.preview.tsx')).map((f) => join(d, f)),
    );
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(src, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src, file).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
      expect(src, file).not.toMatch(/\b(bg|text|border|fill|ring)-(brand|accent|neutral|success|warning|danger|info)-\d{2,3}\b/);
      expect(src, file).not.toMatch(/\b(bg|text|border)-(feedback-success|halal)/);
      expect(src, file).not.toMatch(/\bborder-(l|s|inline-start)(-|\b)/);
    }
  });
});

describe('Icon', () => {
  it('maps every live extension name and renders each in both weights', () => {
    for (const name of ['chevron-down', 'chevron-right', 'minus', 'lock', 'info', 'warning', 'error', 'more', 'refresh'] as const) {
      expect(ICON_NAMES).toContain(name);
      expect(ICON_MAP[name].extension).toBe(true);
    }
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<><Icon name={name} /><Icon name={name} weight="bold" /></>);
      expect(container.querySelectorAll('svg').length, name).toBe(2);
      unmount();
    }
  });

  it('maps no shield or check-badge glyph: nothing can borrow the verification mark', () => {
    for (const entry of Object.values(ICON_MAP)) {
      expect(entry.linear).not.toMatch(/shield|verified|medal|check-badge/);
    }
  });

  it('is decorative unless labelled', () => {
    render(<><Icon name="info" testId="a" /><Icon name="info" testId="b" accessibilityLabel="Information" /></>);
    expect(screen.getByTestId('a')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('img', { name: 'Information' })).toBeInTheDocument();
  });
});

describe('IconButton', () => {
  it('shows 99+ above 99 but keeps the real count in the name', () => {
    render(<IconButton icon="cart" accessibilityLabel="Cart" badge={120} badgeNoun="items" />);
    const button = screen.getByRole('button', { name: 'Cart, 120 items' });
    expect(button.querySelector('[data-hg-badge="count"]')?.textContent).toBe('99+');
  });
});

describe('Tooltip', () => {
  it('labels an IconButton trigger: the bubble describes it, the button keeps its own name', () => {
    render(
      <Tooltip open content="Copy the order ID">
        <IconButton icon="copy" accessibilityLabel="Copy ID" />
      </Tooltip>,
    );
    const button = screen.getByRole('button', { name: 'Copy ID' });
    expect(button).toHaveAttribute('aria-describedby');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Copy the order ID');
  });
});

describe('Card', () => {
  it('a pressable card is one tab stop, activated by Enter and Space', () => {
    const onPress = vi.fn();
    render(<Card onPress={onPress} accessibilityLabel="Order 42">Body</Card>);
    const card = screen.getByRole('button', { name: 'Order 42' });
    expect(card.tabIndex).toBe(0);
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyUp(card, { key: ' ' });
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});

describe('formatTime12h (constitution gate item 10)', () => {
  it('writes 12-hour times with lower-case am/pm in the launch zone', () => {
    expect(formatTime12h('2026-10-12T13:14:05Z')).toBe('9:14 am');
    expect(formatTime12h('2026-10-12T16:05:00Z')).toBe('12:05 pm');
    expect(formatTime12h('2026-10-12T13:14:05Z', { seconds: true })).toBe('9:14:05 am');
    expect(formatTime12h('not a date')).toBeNull();
  });
});
