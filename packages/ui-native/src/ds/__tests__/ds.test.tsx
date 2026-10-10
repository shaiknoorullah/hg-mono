/**
 * The `/ds` surface: the live design system's names and props, mapped onto today's components.
 * One table-driven pass over every export (states, accessible names, targets) plus the handful
 * of invariants that must never regress: money is integer cents, a missing halal state renders
 * nothing (invariant 8), no halal state paints danger (9), and no solid green outside the seal (10).
 */
import type { ReactElement } from 'react';
import { fireEvent, screen } from '@testing-library/react-native';
import { cents } from '@hg/api-client';

import * as ds from '..';
import * as proposed from '../../proposed';
import { renderThemed, styleOf, themes } from '../../primitives/__tests__/harness';
import { resetClientErrorReporter, setClientErrorReporter } from '../../certification/internal/reportClientError';
import type { ColorScheme, ThemeName } from '../../tokens';
import { hex, loadThemeCss, renderNw } from '../../lib/ui/__tests__/harness';

const {
  AppBar,
  Badge,
  BottomNav,
  Button,
  Card,
  Checkbox,
  HalalBadge,
  HalalCertificationPanel,
  Icon,
  IconButton,
  Input,
  Modal,
  Price,
  RadioGroup,
  Select,
  Sheet,
  StatusTimeline,
  Switch,
  Toast,
} = ds;

const reports: Array<[string, Record<string, unknown>]> = [];
beforeEach(() => {
  reports.length = 0;
  setClientErrorReporter((code, context) => reports.push([code, context]));
});
afterEach(() => resetClientErrorReporter());
// Button, IconButton, Badge, Card and Price render through the className tier (N1): targets are
// measured against the real generated stylesheet.
beforeAll(loadThemeCss, 120_000);

const SCHEMES: Array<[ThemeName, ColorScheme]> = [
  ['customer', 'light'],
  ['customer', 'dark'],
  ['rider', 'light'],
  ['rider', 'dark'],
];

/** Every colour any node in the rendered tree paints, flattened. */
function paintedColours(tree: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const n = node as { props?: Record<string, unknown>; children?: unknown };
    if (n.props) {
      const s = styleOf(n as { props: { style?: unknown } });
      for (const key of ['color', 'backgroundColor', 'borderColor', 'tintColor']) {
        if (typeof s[key] === 'string') out.push((s[key] as string).toUpperCase());
      }
      for (const key of ['color', 'fill', 'stroke']) {
        if (typeof n.props[key] === 'string') out.push((n.props[key] as string).toUpperCase());
      }
    }
    walk(n.children);
  };
  walk(tree);
  return out;
}

describe('the /ds surface', () => {
  it('exports every native component of the live index.d.ts', () => {
    const live = [
      'Icon',
      'ICON_NAMES',
      'ICON_MAP',
      'Button',
      'IconButton',
      'Badge',
      'Card',
      'Price',
      'Rating',
      'StatusTimeline',
      'ORDER_STATES',
      'ORDER_STATE_LABELS',
      'resolveTimeline',
      'Modal',
      'Dialog',
      'Sheet',
      'Toast',
      'Checkbox',
      'RadioGroup',
      'Radio',
      'Switch',
      'Input',
      'Select',
      'HalalBadge',
      'HALAL_VISIBLE_LABEL',
      'HALAL_ACCESSIBLE_LABEL',
      'HalalCertificationPanel',
      'AppBar',
      'BottomNav',
      'setClientErrorReporter',
      'setHalalClientErrorReporter',
    ];
    for (const name of live) expect(ds).toHaveProperty(name);
  });

  it('adds the owner-approved KeyValueList and StatCard, and the N1 core parts to /proposed', () => {
    expect(ds).toHaveProperty('KeyValueList');
    expect(ds).toHaveProperty('StatCard');
    for (const name of ['Text', 'Skeleton', 'Spinner', 'Separator', 'Avatar']) expect(proposed).toHaveProperty(name);
  });

  it('keeps the halal shield and the halal tokens out of both barrels', () => {
    for (const barrel of [ds, proposed]) {
      expect(barrel).not.toHaveProperty('HalalShield');
      expect(barrel).not.toHaveProperty('halalTokens');
    }
  });

  it('lists 14 shared icon names plus the 9 live extensions, all rendering', () => {
    expect(ds.ICON_NAMES).toHaveLength(23);
    expect(ds.ICON_MAP['chevron-down']).toEqual({
      linear: 'alt-arrow-down-linear',
      bold: 'alt-arrow-down-bold',
      extension: true,
    });
    expect(ds.ICON_MAP.home.extension).toBeUndefined();
    for (const name of ds.ICON_NAMES) {
      renderThemed(<Icon name={name} testId={`i-${name}`} />);
      expect(screen.getByTestId(`i-${name}`, { includeHiddenElements: true })).toBeTruthy();
    }
  });
});

describe('Icon', () => {
  it('is hidden unless it carries a label, and maps size tokens', () => {
    renderThemed(<Icon name="info" size="xl" />);
    const hidden = screen.getByTestId('Icon', { includeHiddenElements: true });
    expect(hidden.props.accessibilityElementsHidden).toBe(true);
    expect(ds.iconPx('xl')).toBe(32);
    expect(ds.iconPx(undefined)).toBe(20);
    expect(ds.iconPx('18px')).toBe(18);

    renderThemed(<Icon name="warning" accessibilityLabel="Warning" testID="w" />);
    expect(screen.getByLabelText('Warning')).toBeTruthy();
  });

  it('renders nothing for an unknown name and reports ICON_NAME_UNKNOWN', () => {
    const { toJSON } = renderThemed(<Icon name={'nope' as never} />);
    expect(toJSON()).toBeNull();
    expect(reports).toEqual([['ICON_NAME_UNKNOWN', { name: 'nope' }]]);
  });
});

describe('Button and IconButton', () => {
  it('takes icon names, keeps 44/56/72 targets and swallows presses while disabled', () => {
    const onPress = jest.fn();
    for (const [theme, scheme] of SCHEMES) {
      const { unmount } = renderNw(
        <Button iconStart="plus" onPress={onPress} disabled>
          Add to order
        </Button>,
        { theme, scheme },
      );
      const button = screen.getByRole('button', { name: 'Add to order' });
      fireEvent.press(button);
      expect(button.props.accessibilityState).toMatchObject({ disabled: true });
      const min = Number(styleOf(button).minHeight);
      expect(min).toBeGreaterThanOrEqual(theme === 'rider' ? 56 : 44);
      unmount();
    }
    expect(onPress).not.toHaveBeenCalled();

    renderNw(
      <Button critical onPress={onPress} testId="accept">
        Accept
      </Button>,
    );
    expect(Number(styleOf(screen.getByTestId('accept')).minHeight)).toBeGreaterThanOrEqual(72);
    fireEvent.press(screen.getByTestId('accept'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('folds the badge into the IconButton name by the live rule', () => {
    renderThemed(<IconButton icon="cart" accessibilityLabel="Cart" badge={120} badgeNoun="items" />);
    expect(screen.getByRole('button', { name: 'Cart, 120 items' })).toBeTruthy();
    expect(ds.nameWithBadge('Alerts', true)).toBe('Alerts, new');
    expect(ds.nameWithBadge('Alerts', 0)).toBe('Alerts');
  });
});

describe('Price — integer cents only', () => {
  it('speaks money and prefixes "now" when asked', () => {
    renderThemed(<Price cents={cents(1234)} announceAs="now" />);
    expect(screen.getByLabelText('now 12 dollars and 34 cents')).toBeTruthy();
  });

  it('renders nothing for a non-integer and reports MONEY_NOT_INTEGER_CENTS', () => {
    const { toJSON } = renderThemed(<Price cents={12.5 as never} />);
    expect(toJSON()).toBeNull();
    expect(reports[0]?.[0]).toBe('MONEY_NOT_INTEGER_CENTS');
  });
});

describe('Badge', () => {
  it('takes children or label and never offers a success variant', () => {
    renderThemed(<Badge variant="warning">Busy</Badge>);
    expect(screen.getByText('Busy')).toBeTruthy();
    renderThemed(<Badge label={3} appearance="solid" testId="count" />);
    expect(screen.getByText('3')).toBeTruthy();
    // @ts-expect-error — no success badge: solid green is the halal seal's alone (L-4).
    void (<Badge variant="success">x</Badge>);
  });
});

describe('forms take the live callbacks', () => {
  it('Input works uncontrolled and calls onValueChange', () => {
    const onValueChange = jest.fn();
    renderThemed(<Input label="Phone" variant="tel" defaultValue="" onValueChange={onValueChange} errorText={null} />);
    fireEvent.changeText(screen.getByLabelText('Phone', { exact: false }), '4165550100');
    expect(onValueChange).toHaveBeenCalled();
  });

  it('Checkbox announces its error and calls onCheckedChange', () => {
    const onCheckedChange = jest.fn();
    renderThemed(<Checkbox label="Extra sauce" onCheckedChange={onCheckedChange} error="Choose at most two" />);
    fireEvent.press(screen.getByRole('checkbox'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('RadioGroup renders options and calls onValueChange', () => {
    const onValueChange = jest.fn();
    renderThemed(
      <RadioGroup
        label="Size"
        value={null}
        onValueChange={onValueChange}
        options={[
          { value: 's', label: 'Small' },
          { value: 'l', label: 'Large', priceDeltaCents: 200 },
        ]}
      />,
    );
    fireEvent.press(screen.getByTestId('RadioGroup-l'));
    expect(onValueChange).toHaveBeenCalledWith('l');
  });

  it('Switch shows its state word and Select takes onValueChange', () => {
    renderThemed(<Switch label="Availability" stateLabel={{ on: 'Online', off: 'Offline' }} checked={false} />);
    expect(screen.getByText('Offline')).toBeTruthy();
    renderThemed(<Select label="Province" options={[{ value: 'ON', label: 'Ontario' }]} value={null} />);
    expect(screen.getByTestId('Select')).toBeTruthy();
  });
});

describe('navigation and overlays', () => {
  it('AppBar names its back button and renders action nodes', () => {
    const onBack = jest.fn();
    renderNw(
      <AppBar
        tone="cream"
        title="Zaytoun"
        backLabel="Back to Home"
        onBack={onBack}
        actions={<IconButton icon="search" accessibilityLabel="Search menu" />}
      />,
    );
    fireEvent.press(screen.getByRole('button', { name: 'Back to Home' }));
    expect(onBack).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Search menu' })).toBeTruthy();
    // cream tone: primary ink on the cream surface, not the chrome bar.
    expect(hex(styleOf(screen.getByTestId('AppBar')).backgroundColor)).toBe(hex(themes.customer.light.color.surface.base));
  });

  it('BottomNav renders nothing when hidden and changes on press', () => {
    const items = [
      { key: 'home', label: 'Home', icon: 'home' as const },
      { key: 'orders', label: 'Orders', icon: 'orders' as const, badge: 2, badgeNoun: 'active' },
    ];
    const hidden = renderNw(<BottomNav items={items} active="home" hidden />);
    expect(hidden.toJSON()).toBeNull();
    hidden.unmount();
    const onChange = jest.fn();
    renderNw(<BottomNav items={items} active="home" onChange={onChange} />);
    fireEvent.press(screen.getByText('Orders'));
    expect(onChange).toHaveBeenCalledWith('orders');
  });

  it('Modal confirm offers cancel first and the decisive action second', () => {
    const onConfirm = jest.fn();
    const onClose = jest.fn();
    renderNw(
      <Modal open variant="confirm" title="Cancel this order?" confirmLabel="Cancel order" destructive onConfirm={onConfirm} onClose={onClose} />,
    );
    fireEvent.press(screen.getByRole('button', { name: 'Cancel order' }));
    expect(onConfirm).toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('Sheet and Toast render with the live props', () => {
    renderNw(
      <Sheet open variant="full" dismissible={false} title="New delivery offer">
        <ds.Button onPress={() => {}}>Accept</ds.Button>
      </Sheet>,
    );
    expect(screen.getByTestId('Sheet')).toBeTruthy();
    const onAction = jest.fn();
    renderNw(<Toast title="Removed" action={{ label: 'Undo', onAction }} icon="info" />);
    fireEvent.press(screen.getByText('Undo'));
    expect(onAction).toHaveBeenCalled();
  });

  it('Card is one press target; StatusTimeline accepts a missing state as loading', () => {
    const onPress = jest.fn();
    renderThemed(
      <Card onPress={onPress} accessibilityLabel="Zaytoun, 25 minutes" padding="16px" radius="lg">
        <></>
      </Card>,
    );
    fireEvent.press(screen.getByRole('button', { name: 'Zaytoun, 25 minutes' }));
    expect(onPress).toHaveBeenCalled();
    renderThemed(<StatusTimeline audience="customer" />);
    expect(screen.getByTestId('StatusTimeline-loading', { includeHiddenElements: true })).toBeTruthy();
    expect(ds.ORDER_STATES).toHaveLength(14);
  });
});

describe('halal invariants through /ds', () => {
  it('invariant 8: a missing or unknown state renders no badge and is reported', () => {
    for (const state of [null, undefined, 'HALAL_PROBABLY' as never]) {
      const { toJSON, unmount } = renderThemed(<HalalBadge state={state} restaurantId="r1" />);
      expect(toJSON()).toBeNull();
      unmount();
    }
    expect(reports.length).toBeGreaterThanOrEqual(3);
  });

  it('invariant 9: no halal state paints a danger colour, in any theme or scheme', () => {
    for (const [theme, scheme] of SCHEMES) {
      const t = themes[theme][scheme];
      const danger = new Set(
        [
          t.color.feedback.danger.tint,
          t.color.feedback.danger.tintText,
          t.color.feedback.danger.text,
          t.color.feedback.danger.icon,
          t.color.feedback.danger.border,
          t.color.feedback.danger.solid,
          t.color.action.danger,
        ]
          .map((v: string) => v.toUpperCase()),
      );
      for (const state of ['CERTIFIED', 'EXPIRING_SOON', 'EXPIRED', 'UNVERIFIED'] as const) {
        const tree = (render: ReactElement) => renderThemed(render, { theme, scheme }).toJSON();
        const colours = [
          ...paintedColours(tree(<HalalBadge state={state} restaurantId="r1" />)),
          ...paintedColours(tree(<HalalBadge state={state} surface="detail" restaurantId="r1" onPress={() => {}} />)),
        ];
        expect(colours.filter((c) => danger.has(c))).toEqual([]);
      }
    }
  });

  it('invariant 10: the seal green appears only on the CERTIFIED seal', () => {
    const seal = '#0F7A43';
    const certified = paintedColours(renderThemed(<HalalBadge state="CERTIFIED" restaurantId="r1" />).toJSON());
    expect(certified).toContain(seal);
    const others = [
      <Button key="b">Pay</Button>,
      <Badge key="g" variant="brand" appearance="solid">New</Badge>,
      <Toast key="t" variant="success" title="Saved" />,
      <HalalBadge key="x" state="EXPIRED" restaurantId="r1" />,
      <HalalBadge key="u" state="UNVERIFIED" restaurantId="r1" />,
    ];
    for (const node of others) {
      // renderNw: the className tier's real colours, and the PortalHost the Toast renders into.
      const painted = paintedColours(renderNw(node).toJSON());
      expect(painted.length).toBeGreaterThan(0);
      expect(painted).not.toContain(seal);
    }
  });

  it('the certification panel renders loading and error, and no panel without a state', () => {
    renderThemed(<HalalCertificationPanel restaurantId="r1" status="loading" />);
    expect(screen.getByTestId('HalalCertificationPanel', { includeHiddenElements: true })).toBeTruthy();
    const missing = renderThemed(
      <HalalCertificationPanel
        restaurantId="r1"
        certification={{ display_state: undefined as never, disclaimer: 'x' } as never}
      />,
    );
    expect(missing.toJSON()).toBeNull();
    expect(reports.map(([code]) => code)).toContain('CERTIFICATION_PANEL_STATE_MISSING');
    const unverified = renderThemed(
      <HalalCertificationPanel restaurantId="r1" certification={{ display_state: 'UNVERIFIED', disclaimer: 'x' }} />,
    );
    expect(unverified.toJSON()).toBeNull();
  });
});
