/**
 * The N5 feedback family on React Native Reusables, styled for real: the generated
 * `global.<theme>.css` and preset go through Tailwind 3 and NativeWind's compiler
 * (`jest.nativewind.cjs`), and every `className` below arrives as a native style. Customer and
 * rider, light and dark.
 *
 * What must never regress: no halal message paints a danger colour (invariant 9) and `danger`
 * is not even a legal tone for one (type level); the seal green never appears outside the seal
 * (invariant 10); actions are 44pt targets, 56pt for the rider; times are 12-hour and absolute.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ThemeProvider, themes } from '../../tokens';
import {
  Banner,
  EmptyState,
  ErrorState,
  InlineAlert,
  ProgressBar,
  ProgressSteps,
  Skeleton,
  Spinner,
  StatusLabel,
  WaitingState,
  WaitProgress,
  type FeedbackTone,
} from '..';

// css-interop is NativeWind's dependency, not this package's: reached through jest's mapper, untyped here.
const { registerCSS, resetData, setupAllComponents } = require('react-native-css-interop/test') as {
  registerCSS: (css: string, options: object) => void;
  resetData: () => void;
  setupAllComponents: () => void;
};
const { colorScheme } = require('react-native-css-interop') as { colorScheme: { set: (s: 'light' | 'dark') => void } };
const { compileThemeCss } = require('../../../jest.nativewind.cjs') as {
  compileThemeCss: (theme: string, content?: string[]) => Promise<{ css: string; options: object }>;
};

type ThemeName = 'customer' | 'rider';
type Scheme = 'light' | 'dark';
const COMBOS: Array<[ThemeName, Scheme]> = [
  ['customer', 'light'],
  ['customer', 'dark'],
  ['rider', 'light'],
  ['rider', 'dark'],
];
const TONES: FeedbackTone[] = ['neutral', 'info', 'warning', 'danger', 'slate'];
const SEAL = '#0F7A43';
const SRC = path.resolve(__dirname, '../..');

const compiled: Partial<Record<ThemeName, { css: string; options: object }>> = {};

beforeAll(async () => {
  const content = [`${SRC}/lib/**/*.tsx`, `${SRC}/proposed/**/*.tsx`];
  compiled.customer = await compileThemeCss('customer', content);
  compiled.rider = await compileThemeCss('rider', content);
}, 120_000);

const spoken: string[] = [];
beforeEach(() => {
  spoken.length = 0;
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation((m: string) => {
    spoken.push(m);
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  act(() => colorScheme.set('light'));
});

/** The `--hg-*` values of one theme × scheme, read from the generated stylesheet. */
function cssVars(theme: ThemeName, scheme: Scheme): Record<string, string> {
  const css = fs.readFileSync(path.join(SRC, `tokens/generated/global.${theme}.css`), 'utf8');
  const block = css.split(/\.dark:root\s*\{/)[scheme === 'dark' ? 1 : 0]!;
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+):\s*(#[0-9A-Fa-f]+);/g)) out[m[1]!] = m[2]!.toUpperCase();
  return out;
}

/** Every danger value of every theme and scheme: no halal surface may compute to one. */
const DANGER = new Set<string>();
for (const t of ['customer', 'rider'] as const) {
  for (const s of ['light', 'dark'] as const) {
    const d = themes[t][s].color.feedback.danger as Record<string, string | null>;
    for (const v of Object.values(d)) if (v) DANGER.add(v.toUpperCase());
    DANGER.add(themes[t][s].color.action.danger.toUpperCase());
  }
}

function mount(theme: ThemeName, scheme: Scheme, ui: React.ReactElement) {
  resetData();
  setupAllComponents();
  registerCSS(compiled[theme]!.css, compiled[theme]!.options);
  act(() => colorScheme.set(scheme));
  return render(
    <ThemeProvider theme={theme} scheme={scheme}>
      {ui}
    </ThemeProvider>,
  );
}

const flat = (node: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;
const hex = (v: unknown) => String(v).toUpperCase();

/** Every colour any node in the rendered tree paints. */
function painted(): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const n = node as { props?: Record<string, unknown>; children?: unknown };
    if (n.props) {
      const s = flat(n as { props: { style?: unknown } });
      for (const k of ['color', 'backgroundColor', 'borderColor', 'borderBottomColor', 'tintColor']) {
        if (typeof s[k] === 'string') out.push(hex(s[k]));
      }
      for (const k of ['color', 'fill', 'stroke']) if (typeof n.props[k] === 'string') out.push(hex(n.props[k]));
    }
    walk(n.children);
  };
  walk(screen.toJSON());
  return out.filter((c) => c.startsWith('#'));
}

describe('Banner and InlineAlert', () => {
  it.each(COMBOS)('%s %s: every tone paints its generated plate, in both placements', (theme, scheme) => {
    const vars = cssVars(theme, scheme);
    for (const tone of TONES) {
      for (const Comp of [Banner, InlineAlert]) {
        const { unmount } = mount(theme, scheme, <Comp tone={tone} title="Heads up" testID="fb" announce={false} />);
        const root = flat(screen.getByTestId('fb'));
        expect(hex(root.backgroundColor)).toBe(vars[`--hg-feedback-${tone}-tint`]);
        expect(painted()).toContain(vars[`--hg-feedback-${tone}-icon`]);
        expect(painted()).not.toContain(SEAL);
        unmount();
      }
    }
  });

  it('Banner is a full-width bar, InlineAlert a rounded plate', () => {
    mount('customer', 'light', <Banner title="Offline" testID="b" announce={false} />);
    expect(flat(screen.getByTestId('b')).borderBottomWidth).toBe(1);
    mount('customer', 'light', <InlineAlert title="Offline" testID="i" announce={false} />);
    expect(flat(screen.getByTestId('i')).borderRadius).toBe(12);
  });

  it.each(COMBOS)('%s %s: a halal banner is slate and paints no danger colour', (theme, scheme) => {
    const vars = cssVars(theme, scheme);
    mount(theme, scheme, <Banner halal title="Certification lapsed" description="We can't currently vouch." testID="h" />);
    expect(hex(flat(screen.getByTestId('h')).backgroundColor)).toBe(vars['--hg-feedback-slate-tint']);
    for (const c of painted()) expect(DANGER.has(c)).toBe(false);
    // Even a caller that defeats the types gets slate.
    const sneaky = { halal: true, tone: 'danger', title: 'x', testID: 'h2' } as unknown as React.ComponentProps<typeof Banner>;
    mount(theme, scheme, <InlineAlert {...sneaky} />);
    expect(hex(flat(screen.getByTestId('h2')).backgroundColor)).toBe(vars['--hg-feedback-slate-tint']);
    for (const c of painted()) expect(DANGER.has(c)).toBe(false);
  });

  it('rejects danger for a halal message at the type level', () => {
    // @ts-expect-error a halal message may not be danger (invariant 9)
    void (<Banner halal tone="danger" title="x" />);
    // @ts-expect-error nor through the deprecated alias
    void (<InlineAlert halal variant="danger" title="x" />);
    // @ts-expect-error nor an ErrorState about certification
    void (<ErrorState halal tone="danger" />);
    void (<Banner halal tone="slate" title="x" />);
    void (<Banner tone="danger" title="x" />);
    expect(true).toBe(true);
  });

  it('announces once per message; danger is an alert, the rest a summary', () => {
    mount('customer', 'light', <Banner tone="danger" title="Payment failed" description="Try another card." testID="d" />);
    expect(screen.getByTestId('d').props.accessibilityRole).toBe('alert');
    expect(spoken).toEqual(['Payment failed. Try another card.']);
    mount('customer', 'light', <Banner tone="info" title="Reconnecting" testID="n" announce={false} />);
    expect(screen.getByTestId('n').props.accessibilityRole).toBe('summary');
    expect(spoken).toHaveLength(1);
  });

  it.each([
    ['customer', 44],
    ['rider', 56],
  ] as const)('%s: dismiss and action are %ipt targets; a cleared condition re-arms', (theme, min) => {
    const onPress = jest.fn();
    const ui = (active: boolean) => (
      <InlineAlert
        title="Location is off"
        dismissible
        conditionActive={active}
        action={{ label: 'Open location settings', onPress }}
        testID="a"
        announce={false}
      />
    );
    const view = mount(theme, 'light', ui(true));
    const dismiss = screen.getByRole('button', { name: 'Dismiss: Location is off' });
    expect(flat(dismiss).minHeight).toBe(min);
    expect(flat(dismiss).minWidth).toBe(min);
    const action = screen.getByRole('button', { name: 'Open location settings' });
    expect(flat(action).minHeight).toBe(min);
    fireEvent.press(action);
    expect(onPress).toHaveBeenCalledTimes(1);
    fireEvent.press(dismiss);
    expect(screen.queryByTestId('a')).toBeNull();
    view.rerender(<ThemeProvider theme={theme} scheme="light">{ui(false)}</ThemeProvider>);
    expect(screen.getByTestId('a')).toBeTruthy();
  });
});

describe('ErrorState', () => {
  it('takes its copy from the error-code table, reports unmapped codes once', () => {
    const report = jest.fn();
    mount('customer', 'light', <ErrorState errorCode="TIMEOUT" />);
    expect(screen.getByText('That took too long')).toBeTruthy();
    mount('customer', 'light', <ErrorState errorCode="NOT_A_CODE" onUnmappedCode={report} />);
    expect(screen.getByText('Something went wrong on our side')).toBeTruthy();
    expect(report).toHaveBeenCalledWith('NOT_A_CODE');
    expect(report).toHaveBeenCalledTimes(1);
  });

  it.each(COMBOS)('%s %s: offline is neutral; a certification error is slate, never danger', (theme, scheme) => {
    const vars = cssVars(theme, scheme);
    mount(theme, scheme, <ErrorState offline testID="o" />);
    expect(screen.getByText('You are offline')).toBeTruthy();
    expect(hex(flat(screen.getByTestId('o')).backgroundColor)).toBe(vars['--hg-feedback-neutral-tint']);
    mount(theme, scheme, <ErrorState errorCode="RESTAURANT_UNAVAILABLE" testID="h" />);
    expect(hex(flat(screen.getByTestId('h')).backgroundColor)).toBe(vars['--hg-feedback-slate-tint']);
    for (const c of painted()) expect(DANGER.has(c)).toBe(false);
    for (const placement of ['page', 'inline'] as const) {
      mount(theme, scheme, <ErrorState halal placement={placement} title="Certification expired" />);
      for (const c of painted()) expect(DANGER.has(c)).toBe(false);
      expect(painted()).not.toContain(SEAL);
    }
    mount(theme, scheme, <ErrorState errorCode="TIMEOUT" testID="e" />);
    expect(hex(flat(screen.getByTestId('e')).backgroundColor)).toBe(vars['--hg-feedback-danger-tint']);
  });

  it.each([
    ['customer', 44],
    ['rider', 56],
  ] as const)('%s: retry is a real %ipt button; retrying keeps it, busy, ignoring presses', (theme, min) => {
    const onRetry = jest.fn();
    const view = mount(theme, 'light', <ErrorState placement="page" errorCode="TIMEOUT" onRetry={onRetry} />);
    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(flat(retry).minHeight).toBe(min);
    fireEvent.press(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    view.rerender(
      <ThemeProvider theme={theme} scheme="light">
        <ErrorState placement="page" errorCode="TIMEOUT" onRetry={onRetry} retrying />
      </ThemeProvider>,
    );
    const busy = screen.getByRole('button', { name: 'Try again' });
    expect(busy.props.accessibilityState).toMatchObject({ busy: true, disabled: false });
    fireEvent.press(busy);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps technical detail collapsed and copyable; the deprecated variant still works', () => {
    const onCopy = jest.fn();
    mount(
      'customer',
      'light',
      <ErrorState variant="toast" errorCode="TIMEOUT" technicalDetail={{ requestId: 'req_1' }} onCopyDetail={onCopy} testID="t" />,
    );
    expect(screen.getByTestId('t').props.accessibilityRole).toBe('alert');
    expect(screen.queryByText(/request id/)).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Show technical details' }));
    expect(screen.getByText('code: TIMEOUT\nrequest id: req_1')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Copy technical details' }));
    expect(onCopy).toHaveBeenCalledWith('code: TIMEOUT\nrequest id: req_1');
    expect(screen.getByText('Copied')).toBeTruthy();
  });
});

describe('EmptyState', () => {
  it.each([
    ['customer', 44],
    ['rider', 56],
  ] as const)('%s: heading, way forward and %ipt actions; the deprecated table variant is inline', (theme, min) => {
    const browse = jest.fn();
    mount(
      theme,
      'dark',
      <EmptyState
        title="You haven't ordered yet"
        description="Browse restaurants near you."
        primaryAction={{ label: 'Browse restaurants', onPress: browse }}
        secondaryAction={{ label: 'Change address', onPress: jest.fn() }}
      />,
    );
    expect(screen.getByRole('header')).toBeTruthy();
    expect(screen.getByText('Browse restaurants near you.')).toBeTruthy();
    for (const name of ['Browse restaurants', 'Change address']) {
      expect(flat(screen.getByRole('button', { name })).minHeight).toBe(min);
    }
    fireEvent.press(screen.getByRole('button', { name: 'Browse restaurants' }));
    expect(browse).toHaveBeenCalled();
    expect(painted()).not.toContain(SEAL);
    mount(theme, 'light', <EmptyState variant="table" title="No lines" />);
    expect(screen.getByRole('header').props['aria-level']).toBe(2);
  });
});

describe('loading and status', () => {
  it.each(COMBOS)('%s %s: the skeleton is the generated base (dark: neutral.700, #167)', (theme, scheme) => {
    mount(theme, scheme, <Skeleton variant="rect" testID="s" />);
    const blocks = painted();
    expect(blocks).toContain(cssVars(theme, scheme)['--hg-skeleton-base']);
    if (scheme === 'dark') expect(blocks).toContain('#4A4E48');
  });

  it('a labelled spinner is a named progressbar; an unlabelled one is hidden', () => {
    mount('customer', 'light', <Spinner label="Loading your orders" />);
    expect(screen.getByRole('progressbar', { name: 'Loading your orders' })).toBeTruthy();
  });

  it('ProgressBar reports a value when known and none when indeterminate', () => {
    mount('customer', 'light', <ProgressBar value={30} label="Uploading your licence" />);
    expect(screen.getByRole('progressbar', { name: 'Uploading your licence' }).props.accessibilityValue).toEqual({
      min: 0,
      max: 100,
      now: 30,
    });
    mount('customer', 'light', <ProgressBar indeterminate label="Checking" />);
    expect(screen.getByRole('progressbar', { name: 'Checking' }).props.accessibilityValue).toBeUndefined();
  });

  it.each(COMBOS)('%s %s: WaitProgress shows an absolute 12-hour time, no countdown, no urgency colour', (theme, scheme) => {
    const deadline = new Date(2026, 9, 9, 18, 52, 0);
    const server = new Date(deadline.getTime() - 170_000);
    mount(
      theme,
      scheme,
      <WaitProgress
        deadlineAt={deadline.toISOString()}
        serverNow={server.toISOString()}
        windowSeconds={180}
        label="Waiting for Zaytoun Grill to reply"
      />,
    );
    const caption = screen.getByText(/^Restaurant replies by /);
    expect(String(caption.props.children)).toMatch(/^Restaurant replies by 6:52\s?p\.m\.$/);
    const bar = screen.getByRole('progressbar', { name: 'Waiting for Zaytoun Grill to reply' });
    expect(bar.props.accessibilityValue.text).toMatch(/6:52\s?p\.m\.$/);
    expect(bar.props.accessibilityValue).toMatchObject({ min: 0, max: 180, now: 10 });
    const vars = cssVars(theme, scheme);
    expect(painted()).toContain(vars['--hg-progress-fill']);
    for (const c of painted()) {
      expect(DANGER.has(c)).toBe(false);
      expect(c).not.toBe(vars['--hg-feedback-warning-icon']);
    }
  });

  it('WaitProgress past the deadline waits indeterminately for the server', () => {
    const deadline = new Date(2026, 9, 9, 18, 52, 0);
    mount(
      'customer',
      'light',
      <WaitProgress
        deadlineAt={deadline.toISOString()}
        serverNow={new Date(deadline.getTime() + 2_000).toISOString()}
        windowSeconds={180}
        label="Waiting"
      />,
    );
    expect(screen.getByRole('progressbar', { name: 'Waiting' }).props.accessibilityValue.now).toBeUndefined();
  });

  it.each(COMBOS)('%s %s: ProgressSteps is one progressbar, "Step N of 4"', (theme, scheme) => {
    const vars = cssVars(theme, scheme);
    mount(theme, scheme, <ProgressSteps step={2} label="Go to the restaurant" testID="p" />);
    const bar = screen.getByRole('progressbar', { name: 'Step 2 of 4, Go to the restaurant' });
    expect(bar.props.accessibilityValue).toMatchObject({ min: 1, max: 4, now: 2 });
    expect(hex(flat(screen.getByTestId('p-segment-2')).backgroundColor)).toBe(vars['--hg-progress-fill']);
    expect(hex(flat(screen.getByTestId('p-segment-3')).backgroundColor)).toBe(vars['--hg-border-interactive']);
    expect(painted()).not.toContain(SEAL);
  });

  it.each(COMBOS)('%s %s: StatusLabel is icon + word; warning colours only the icon', (theme, scheme) => {
    const vars = cssVars(theme, scheme);
    mount(theme, scheme, <StatusLabel icon="clock" label="Pending" tone="warning" />);
    expect(screen.getByText('Pending')).toBeTruthy();
    expect(painted()).toContain(vars['--hg-feedback-warning-icon']);
    expect(hex(flat(screen.getByText('Pending')).color)).toBe(vars['--hg-fg-primary']);
    mount(theme, scheme, <StatusLabel icon="info" label="Reversed" tone="slate" />);
    for (const c of painted()) {
      expect(DANGER.has(c)).toBe(false);
      expect(c).not.toBe(SEAL);
    }
  });

  it('WaitingState is a heading with its way forward, announced once', () => {
    mount(
      'rider',
      'dark',
      <WaitingState description="You can lock your phone. When an offer arrives, it fills the screen and plays a sound." />,
    );
    expect(screen.getByRole('header')).toBeTruthy();
    expect(screen.getByText('Waiting for offers')).toBeTruthy();
    expect(spoken).toHaveLength(1);
  });
});
