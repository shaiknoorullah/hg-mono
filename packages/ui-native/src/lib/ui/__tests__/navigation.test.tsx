/**
 * Design-system N2 (navigation and overlays) on the React Native Reusables tier, measured through
 * the REAL generated stylesheet (harness.ts): `/ds` AppBar, BottomNav, Sheet, Modal, Toast and
 * `/proposed` StickyFooter, in customer and rider × light and dark.
 *
 * Few and high-value: roles, names and states (links with `selected`, modal dialogs, the
 * alertdialog), the rider offer contract (a full, non-dismissible sheet that ignores back and
 * the scrim and has no close button, with the BottomNav hidden), measured targets (44 / 56 / 72),
 * fills never edges for the selected link, no danger colour outside a danger Button or Toast, and
 * the halal seal green nowhere.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ReactElement } from 'react';
import { AccessibilityInfo, BackHandler, Dimensions, KeyboardAvoidingView, ScrollView } from 'react-native';
import { act, fireEvent, screen, within } from '@testing-library/react-native';

import * as ds from '../../../ds';
import * as proposed from '../../../proposed';
import { themes, tokens } from '../../../tokens';
import type { ColorScheme, ThemeName } from '../../../tokens';
import { bottomNavItemClasses, TOAST_INK } from '../..';
import { SCHEMES, flat, hex, loadThemeCss, paintedColours, renderNw } from './harness';

const { AppBar, BottomNav, Button, IconButton, Modal, Sheet, Toast } = ds;
const { StickyFooter } = proposed;

beforeAll(loadThemeCss, 120_000);

const SEAL = tokens.color.halal.certified.seal.toUpperCase();

function dangerColours(theme: ThemeName, scheme: ColorScheme): Set<string> {
  const t = themes[theme][scheme].color;
  const d = t.feedback.danger;
  return new Set<string>([d.tint, d.tintText, d.text, d.icon, d.border, d.solid, t.action.danger].map(hex));
}

const ITEMS: ds.BottomNavItem[] = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'search', label: 'Search', icon: 'search' },
  { key: 'orders', label: 'Orders', icon: 'orders', badge: 2, badgeNoun: 'active' },
  { key: 'account', label: 'Account', icon: 'profile', badge: true },
];

/** Captures the Android back handler an overlay registers, so a test can press back. */
function captureBack() {
  const handlers: Array<() => boolean | null | undefined> = [];
  const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, handler) => {
    handlers.push(handler);
    return { remove: () => handlers.splice(handlers.indexOf(handler), 1) };
  });
  return { press: () => handlers[handlers.length - 1]?.(), count: () => handlers.length, restore: () => spy.mockRestore() };
}

/**
 * `findNodeHandle` stand-in: under jest a host ref is the mocked component instance, so its
 * `testID` names it. React Native's index reads the function from RendererProxy on every access.
 */
function nodeTags(tags: Record<string, number>) {
  const proxy = require('react-native/Libraries/ReactNative/RendererProxy') as { findNodeHandle: (n: unknown) => number | null };
  jest.spyOn(proxy, 'findNodeHandle').mockImplementation((node) => {
    const id = (node as { props?: { testID?: string } } | null)?.props?.testID;
    return id && id in tags ? tags[id]! : null;
  });
}

/* ───────────────────────────── AppBar ───────────────────────────── */

describe('AppBar', () => {
  const VARIANTS = ['default', 'large', 'search', 'contextual', 'transparent'] as const;
  const TONES = ['cream', 'raised', 'chrome', 'field'] as const;

  it('renders every variant × tone in every theme and scheme on its role surface, title unclamped', () => {
    for (const [theme, scheme] of SCHEMES) {
      const c = themes[theme][scheme].color;
      const surface = { cream: c.surface.base, raised: c.surface.raised, chrome: c.surface.chrome, field: c.surface.chrome };
      for (const variant of VARIANTS) {
        for (const tone of TONES) {
          const { unmount, toJSON } = renderNw(
            <AppBar
              variant={variant}
              tone={tone}
              title="Zaytoun Grill"
              subtitle="Scarborough, ON"
              onBack={() => {}}
              backLabel="Back to Home"
              search={<IconButton icon="search" accessibilityLabel="Search" />}
            />,
            { theme, scheme },
          );
          const bar = flat(screen.getByTestId('AppBar'));
          const expected =
            variant === 'contextual' ? c.state.selectedTint : variant === 'transparent' ? c.surface.scrim : surface[tone];
          expect(hex(bar.backgroundColor)).toBe(hex(expected));
          if (variant !== 'search') {
            const title = screen.getByText('Zaytoun Grill');
            expect(title.props.numberOfLines).toBeUndefined();
            expect(title.props.maxFontSizeMultiplier).toBeUndefined();
          }
          expect(flat(screen.getByTestId('AppBar-row')).minHeight).toBe(variant === 'large' ? 72 : 56);
          expect(paintedColours(toJSON())).not.toContain(SEAL);
          unmount();
        }
      }
    }
  });

  it('back is "Back to {previous}", 44pt on customer and 56pt on the field tone and the rider theme', () => {
    const cases: Array<[ThemeName, 'cream' | 'field', number]> = [
      ['customer', 'cream', 44],
      ['customer', 'field', 56],
      ['rider', 'cream', 56],
      ['rider', 'field', 56],
    ];
    for (const [theme, tone, px] of cases) {
      const onBack = jest.fn();
      const { unmount } = renderNw(<AppBar tone={tone} title="Orders" backLabel="Back to Home" onBack={onBack} />, { theme });
      const back = screen.getByRole('button', { name: 'Back to Home' });
      expect(flat(back).minHeight).toBe(px);
      expect(flat(back).minWidth).toBe(px);
      fireEvent.press(back);
      expect(onBack).toHaveBeenCalledTimes(1);
      unmount();
    }
    // Contextual: the leading control leaves selection mode.
    renderNw(<AppBar variant="contextual" title="2 selected" onBack={() => {}} />);
    expect(screen.getByRole('button', { name: 'Clear selection' })).toBeTruthy();
  });

  it('the title is the heading; the address title is one button; loading is a named progress bar; elevated has a hairline', () => {
    const onTitlePress = jest.fn();
    const { unmount } = renderNw(
      <AppBar title="Deliver to 12 Main St" onTitlePress={onTitlePress} titleAccessibilityHint="Changes the delivery address" />,
    );
    const address = screen.getByRole('button', { name: 'Deliver to 12 Main St' });
    expect(flat(address).minHeight).toBe(44);
    fireEvent.press(address);
    expect(onTitlePress).toHaveBeenCalled();
    unmount();

    renderNw(<AppBar tone="raised" title="Orders" loading elevated />);
    expect(screen.getByRole('header', { name: 'Orders' })).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeTruthy();
    const bar = flat(screen.getByTestId('AppBar'));
    expect(hex(bar.borderBottomColor ?? bar.borderColor)).toBe(hex(themes.customer.light.color.border.decorative));
    expect(bar.shadowOpacity).toBeGreaterThan(0);
  });

  it('actions render as given, with their own names', () => {
    renderNw(<AppBar title="Menu" actions={<IconButton icon="cart" accessibilityLabel="Cart" badge={3} badgeNoun="items" />} />);
    expect(screen.getByRole('button', { name: 'Cart, 3 items' })).toBeTruthy();
  });
});

/* ───────────────────────────── BottomNav ───────────────────────────── */

describe('BottomNav', () => {
  it('is a named navigation of links (not tabs); the selected one says so; badges are in the name', () => {
    const onChange = jest.fn();
    renderNw(<BottomNav label="Main" items={ITEMS} active="orders" onChange={onChange} />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.props.accessibilityLabel)).toEqual(['Home', 'Search', 'Orders, 2 active', 'Account, new']);
    expect(screen.getByRole('link', { name: 'Orders, 2 active' }).props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByRole('link', { name: 'Home' }).props.accessibilityState).toEqual({ selected: false });
    expect(screen.getByTestId('BottomNav').props.role).toBe('navigation');
    expect(screen.getByTestId('BottomNav').props.accessibilityLabel).toBe('Main');
    fireEvent.press(screen.getByRole('link', { name: 'Search' }));
    expect(onChange).toHaveBeenCalledWith('search');
  });

  it('shows 99+ but names the real count; hidden renders nothing at all', () => {
    const { unmount } = renderNw(<BottomNav items={[{ key: 'orders', label: 'Orders', icon: 'orders', badge: 120, badgeNoun: 'active' }]} active="orders" />);
    expect(screen.getByRole('link', { name: 'Orders, 120 active' })).toBeTruthy();
    expect(screen.getByText('99+', { includeHiddenElements: true })).toBeTruthy();
    unmount();
    const hidden = renderNw(<BottomNav items={ITEMS} active="home" hidden />);
    expect(hidden.toJSON()).toBeNull();
  });

  it('raised and field tones in every theme and scheme: the selected link is a filled tile; every link is at least 56 × 44', () => {
    for (const [theme, scheme] of SCHEMES) {
      const c = themes[theme][scheme].color;
      for (const tone of ['raised', 'field'] as const) {
        const { unmount, toJSON } = renderNw(<BottomNav items={ITEMS} active="home" tone={tone} />, { theme, scheme });
        const bar = flat(screen.getByTestId('BottomNav'));
        expect(hex(bar.backgroundColor)).toBe(hex(tone === 'raised' ? c.surface.raised : c.surface.chrome));
        const on = flat(screen.getByRole('link', { name: 'Home' }));
        const off = flat(screen.getByRole('link', { name: 'Search' }));
        expect(on.backgroundColor).toBeDefined();
        if (tone === 'raised') expect(hex(on.backgroundColor)).toBe(hex(c.state.selectedTint));
        expect(off.backgroundColor).toBeUndefined();
        for (const link of screen.getAllByRole('link')) {
          expect(flat(link).minHeight).toBeGreaterThanOrEqual(56);
          expect(flat(link).minWidth).toBeGreaterThanOrEqual(44);
          // Labels wrap at 200%: never clamped.
          for (const label of within(link).queryAllByText(/./)) expect(label.props.numberOfLines).toBeUndefined();
        }
        const colours = paintedColours(toJSON());
        expect(colours).not.toContain(SEAL);
        expect(colours.filter((x) => dangerColours(theme, scheme).has(x))).toEqual([]);
        unmount();
      }
    }
    // The rider theme defaults to the field tone (dark chrome).
    renderNw(<BottomNav items={ITEMS} active="home" />, { theme: 'rider' });
    expect(hex(flat(screen.getByTestId('BottomNav')).backgroundColor)).toBe(hex(themes.rider.light.color.surface.chrome));
  });

  it('fills, never edges: no left, start or top border marks the selected link (static and rendered)', () => {
    const EDGE = /(^|\s)(border-[lts]|border-x|border-y|border-l-|border-t-|border-s-)/;
    for (const tone of ['raised', 'field'] as const) {
      expect(bottomNavItemClasses(tone, true)).not.toMatch(EDGE);
      expect(bottomNavItemClasses(tone, true)).not.toMatch(/(^|\s)border(\s|$)/);
    }
    const code = fs
      .readFileSync(path.join(__dirname, '..', 'bottom-nav.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/borderLeft|borderTop|borderStart|indicator/);
    renderNw(<BottomNav items={ITEMS} active="home" />);
    const on = flat(screen.getByRole('link', { name: 'Home' }));
    for (const key of ['borderTopWidth', 'borderLeftWidth', 'borderStartWidth', 'borderWidth']) expect(on[key] ?? 0).toBe(0);
  });
});

/* ───────────────────────────── Sheet ───────────────────────────── */

describe('Sheet', () => {
  afterEach(() => jest.restoreAllMocks());

  it('bottom, side and full render as modal dialogs named by a focusable heading, in every theme and scheme', () => {
    for (const [theme, scheme] of SCHEMES) {
      for (const variant of ['bottom', 'side', 'full'] as const) {
        const { unmount, toJSON } = renderNw(
          <Sheet open variant={variant} title="Choose a tip" onClose={() => {}} footer={<Button fullWidth>Confirm tip</Button>}>
            <Button variant="tertiary">15%</Button>
          </Sheet>,
          { theme, scheme },
        );
        const panel = screen.getByTestId('Sheet');
        expect(panel.props.role).toBe('dialog');
        expect(panel.props['aria-modal']).toBe(true);
        expect(panel.props['aria-label']).toBe('Choose a tip');
        expect(panel.props.accessibilityViewIsModal).toBe(true);
        expect(screen.getByRole('header', { name: 'Choose a tip' })).toBeTruthy();
        const surface = variant === 'full' ? themes[theme][scheme].color.surface.base : themes[theme][scheme].color.surface.raised;
        expect(hex(flat(panel).backgroundColor)).toBe(hex(surface));
        expect(paintedColours(toJSON())).not.toContain(SEAL);
        expect(paintedColours(toJSON()).filter((x) => dangerColours(theme, scheme).has(x))).toEqual([]);
        unmount();
      }
    }
  });

  it('dismissible: scrim, Android back and a 44pt close button each close it', () => {
    const back = captureBack();
    const onClose = jest.fn();
    renderNw(
      <Sheet open title="Filters" onClose={onClose}>
        <></>
      </Sheet>,
    );
    const close = screen.getByRole('button', { name: 'Close' });
    expect(flat(close).minHeight).toBe(44);
    fireEvent.press(close);
    fireEvent.press(screen.getByTestId('Sheet-scrim', { includeHiddenElements: true }));
    expect(back.press()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(3);
    back.restore();
  });

  it('the rider offer: full, non-dismissible, above everything; back and scrim are ignored and there is no close button', () => {
    const back = captureBack();
    const onClose = jest.fn();
    renderNw(
      <>
        <BottomNav items={ITEMS} active="home" hidden />
        <Sheet open variant="full" dismissible={false} title="Delivery offer" onClose={onClose}>
          <Button critical fullWidth>
            Accept
          </Button>
          <Button critical fullWidth variant="tertiary">
            Decline
          </Button>
        </Sheet>
      </>,
      { theme: 'rider' },
    );
    expect(screen.queryByTestId('BottomNav')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.queryByTestId('Sheet-close', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByTestId('Sheet-scrim', { includeHiddenElements: true })).toBeNull();
    // Back is consumed (it never reaches the screen underneath) and does not close the offer.
    expect(back.press()).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    // A bottom sheet that is not dismissible ignores its scrim too.
    expect(flat(screen.getByTestId('Sheet-layer')).zIndex).toBe(tokens.zIndex.offerSheet);
    for (const name of ['Accept', 'Decline']) expect(flat(screen.getByRole('button', { name })).minHeight).toBe(72);
    back.restore();
  });

  it('a non-dismissible bottom sheet ignores its scrim; a dismissible one sits at z-sheet', () => {
    const onClose = jest.fn();
    const { unmount } = renderNw(
      <Sheet open dismissible={false} title="Updating" onClose={onClose}>
        <></>
      </Sheet>,
    );
    fireEvent.press(screen.getByTestId('Sheet-scrim', { includeHiddenElements: true }));
    expect(onClose).not.toHaveBeenCalled();
    expect(flat(screen.getByTestId('Sheet-layer')).zIndex).toBe(tokens.zIndex.sheet);
    unmount();
  });

  it('the footer sits outside the scroll area inside the keyboard-avoiding view; hideTitle keeps the heading', () => {
    renderNw(
      <Sheet open title="Add a note" hideTitle onClose={() => {}} footer={<Button fullWidth>Save note</Button>}>
        <></>
      </Sheet>,
    );
    const avoiding = screen.UNSAFE_getByType(KeyboardAvoidingView);
    const footer = within(avoiding).getByTestId('Sheet-footer');
    const body = screen.UNSAFE_getByType(ScrollView);
    expect(within(body).queryByTestId('Sheet-footer')).toBeNull();
    expect(within(footer).getByRole('button', { name: 'Save note' })).toBeTruthy();
    const title = screen.getByRole('header', { name: 'Add a note' });
    expect(flat(title).position).toBe('absolute');
    expect(flat(title).width).toBe(1);
  });

  it('the rider theme reaches content inside the portal (56pt controls) and focus moves to the title on open', () => {
    jest.useFakeTimers();
    const focus = jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => {});
    nodeTags({ 'Sheet-title': 7 });
    renderNw(
      <Sheet open title="What's new" onClose={() => {}} footer={<Button>Got it</Button>}>
        <></>
      </Sheet>,
      { theme: 'rider' },
    );
    expect(flat(screen.getByRole('button', { name: 'Got it' })).minHeight).toBe(56);
    expect(flat(screen.getByRole('button', { name: 'Close' })).minHeight).toBe(56);
    act(() => jest.runOnlyPendingTimers());
    expect(focus).toHaveBeenCalledWith(7);
    jest.useRealTimers();
  });
});

/* ───────────────────────────── Modal ───────────────────────────── */

describe('Modal', () => {
  afterEach(() => jest.restoreAllMocks());

  it('dialog is a dialog; confirm and alert are alertdialogs; all modal and named; every theme and scheme', () => {
    for (const [theme, scheme] of SCHEMES) {
      for (const variant of ['dialog', 'confirm', 'alert'] as const) {
        const { unmount, toJSON } = renderNw(
          <Modal open variant={variant} title="Sign out?" description="You'll need a code to sign back in." actions={<Button>Done</Button>} onClose={() => {}} />,
          { theme, scheme },
        );
        const panel = screen.getByTestId('Modal');
        expect(panel.props.role).toBe(variant === 'dialog' ? 'dialog' : 'alertdialog');
        expect(panel.props['aria-modal']).toBe(true);
        expect(panel.props['aria-label']).toBe('Sign out?');
        expect(panel.props.accessibilityHint).toBe("You'll need a code to sign back in.");
        for (const b of screen.getAllByRole('button')) expect(flat(b).minHeight).toBeGreaterThanOrEqual(theme === 'rider' ? 56 : 44);
        expect(paintedColours(toJSON())).not.toContain(SEAL);
        expect(paintedColours(toJSON()).filter((x) => dangerColours(theme, scheme).has(x))).toEqual([]);
        unmount();
      }
    }
  });

  it('destructive confirm: cancel first and focused on open; danger only on the decisive Button', () => {
    jest.useFakeTimers();
    const focus = jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => {});
    nodeTags({ 'Modal-cancel': 11, 'Modal-confirm': 12, 'Modal-title': 13 });
    const { toJSON } = renderNw(
      <Modal
        open
        variant="confirm"
        destructive
        title="Cancel this order?"
        confirmLabel="Cancel order"
        cancelLabel="Keep order"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.props.accessibilityLabel)).toEqual(['Keep order', 'Cancel order']);
    act(() => jest.runOnlyPendingTimers());
    expect(focus).toHaveBeenCalledWith(11);
    expect(focus).not.toHaveBeenCalledWith(12);
    jest.useRealTimers();

    const danger = dangerColours('customer', 'light');
    const decisive = screen.getByRole('button', { name: 'Cancel order' });
    expect(hex(flat(decisive).backgroundColor)).toBe(hex(themes.customer.light.color.action.danger));
    const inDecisive = new Set(paintedColours(decisive));
    const everywhere = paintedColours(toJSON()).filter((x) => danger.has(x));
    expect(everywhere.length).toBeGreaterThan(0);
    for (const colour of everywhere) expect(inDecisive.has(colour)).toBe(true);
  });

  it('on a phone the actions stack full width, 24pt apart; wider, they sit in a row', () => {
    const window = Dimensions.get('window');
    act(() => Dimensions.set({ window: { ...window, width: 390 } }));
    const { unmount } = renderNw(<Modal open variant="confirm" title="Remove item?" onClose={() => {}} />);
    const stacked = flat(screen.getByTestId('Modal-actions'));
    expect(stacked.flexDirection).toBe('column');
    expect(stacked.rowGap ?? stacked.gap).toBe(24);
    unmount();
    act(() => Dimensions.set({ window: { ...window, width: 820 } }));
    renderNw(<Modal open variant="confirm" title="Remove item?" onClose={() => {}} />);
    expect(flat(screen.getByTestId('Modal-actions')).flexDirection).toBe('row');
    act(() => Dimensions.set({ window }));
  });

  it('dismissible closes on back and scrim; not dismissible swallows both; the Dialog alias still renders', () => {
    const back = captureBack();
    const onClose = jest.fn();
    const { unmount } = renderNw(<Modal open variant="alert" title="Saved" dismissible={false} onClose={onClose} />);
    expect(back.press()).toBe(true);
    fireEvent.press(screen.getByTestId('Modal-scrim', { includeHiddenElements: true }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: 'OK' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    const onDialogClose = jest.fn();
    renderNw(<ds.Dialog title="Details" onClose={onDialogClose} />);
    fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    back.press();
    expect(onDialogClose).toHaveBeenCalledTimes(2);
    back.restore();
  });
});

/* ───────────────────────────── Toast ───────────────────────────── */

describe('Toast', () => {
  afterEach(() => jest.useRealTimers());

  it('neutral, success, warning, danger and info are tint plates in every theme and scheme; success is never a green fill', () => {
    expect(Object.keys(TOAST_INK).sort()).toEqual(['danger', 'info', 'neutral', 'success', 'warning']);
    for (const [theme, scheme] of SCHEMES) {
      const c = themes[theme][scheme].color;
      for (const variant of ['neutral', 'success', 'warning', 'danger', 'info'] as const) {
        const { unmount, toJSON } = renderNw(<Toast variant={variant} title="Address saved" onDismiss={() => {}} />, { theme, scheme });
        const plate = flat(screen.getByTestId('Toast'));
        const expected = variant === 'neutral' ? c.surface.raised : c.feedback[variant].tint;
        expect(hex(plate.backgroundColor)).toBe(hex(expected));
        const colours = paintedColours(toJSON());
        expect(colours).not.toContain(SEAL);
        if (variant !== 'danger') expect(colours.filter((x) => dangerColours(theme, scheme).has(x))).toEqual([]);
        const dismiss = screen.getByRole('button', { name: 'Dismiss' });
        expect(flat(dismiss).minHeight).toBe(theme === 'rider' ? 56 : 44);
        expect(flat(dismiss).minWidth).toBe(theme === 'rider' ? 56 : 44);
        unmount();
      }
    }
    // The success solid does not exist: invariant 10 in the type system.
    expect(themes.customer.light.color.feedback.success.solid).toBeNull();
  });

  it('danger is an assertive alert and persistent; others are polite status and time out at 5 s', () => {
    jest.useFakeTimers();
    const onDanger = jest.fn();
    const a = renderNw(<Toast variant="danger" title="Payment declined" onDismiss={onDanger} />);
    expect(screen.getByTestId('Toast').props.role).toBe('alert');
    expect(screen.getByTestId('Toast').props.accessibilityLiveRegion).toBe('assertive');
    act(() => jest.advanceTimersByTime(20_000));
    expect(onDanger).not.toHaveBeenCalled();
    a.unmount();

    const onAction = jest.fn();
    const onActionDismiss = jest.fn();
    const b = renderNw(<Toast title="Item removed" action={{ label: 'Undo', onAction }} onDismiss={onActionDismiss} />);
    act(() => jest.advanceTimersByTime(20_000));
    expect(onActionDismiss).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    expect(onAction).toHaveBeenCalled();
    expect(flat(screen.getByRole('button', { name: 'Undo' })).minHeight).toBe(44);
    b.unmount();

    const onDone = jest.fn();
    renderNw(<Toast variant="success" title="Saved" onDismiss={onDone} />);
    expect(screen.getByTestId('Toast').props.role).toBe('status');
    expect(screen.getByTestId('Toast').props.accessibilityLiveRegion).toBe('polite');
    act(() => jest.advanceTimersByTime(4_999));
    expect(onDone).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(2));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('renders in the toast layer (z-toast) above the bottom inset, and takes the deprecated action.onPress', () => {
    const onPress = jest.fn();
    renderNw(<Toast title="Removed" action={{ label: 'Undo', onPress }} offset={72} />);
    const layer = flat(screen.getByTestId('Toast-layer'));
    expect(layer.zIndex).toBe(tokens.zIndex.toast);
    expect(layer.bottom).toBe(72);
    fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    expect(onPress).toHaveBeenCalled();
  });
});

/* ───────────────────────────── StickyFooter ───────────────────────────── */

describe('StickyFooter (proposed)', () => {
  it('sits on the sticky elevation surface: raised in light with the upward shadow, the surface step in dark', () => {
    for (const [theme, scheme] of SCHEMES) {
      const { unmount, toJSON } = renderNw(
        <StickyFooter>
          <Button fullWidth size="lg">
            Add to cart
          </Button>
        </StickyFooter>,
        { theme, scheme },
      );
      const bar = flat(screen.getByTestId('StickyFooter'));
      const fill = scheme === 'dark' ? (tokens.elevation.sticky as { surfaceStep: string }).surfaceStep : themes[theme][scheme].color.surface.raised;
      expect(hex(bar.backgroundColor)).toBe(hex(fill));
      if (scheme === 'light') expect((bar.shadowOffset as { height: number }).height).toBeLessThan(0);
      else expect(bar.shadowOpacity).toBeUndefined();
      expect(paintedColours(toJSON())).not.toContain(SEAL);
      unmount();
    }
  });
});

/* ───────────────────────────── one tree ───────────────────────────── */

it('a whole screen of N2 parts paints no seal green and no danger colour', () => {
  for (const [theme, scheme] of SCHEMES) {
    const tree: ReactElement = (
      <>
        <AppBar title="Home" tone={theme === 'rider' ? 'field' : 'cream'} loading elevated />
        <BottomNav items={ITEMS} active="orders" />
        <Toast variant="info" title="Offers are paused" />
        <StickyFooter>
          <Button fullWidth>Go online</Button>
        </StickyFooter>
      </>
    );
    const { toJSON, unmount } = renderNw(tree, { theme, scheme });
    const colours = paintedColours(toJSON());
    expect(colours).not.toContain(SEAL);
    expect(colours.filter((x) => dangerColours(theme, scheme).has(x))).toEqual([]);
    unmount();
  }
});
