/**
 * Design-system N1 (core) on the React Native Reusables tier, measured through the REAL
 * generated stylesheet (harness.ts): `/ds` Button, IconButton, Badge, Card, Price, KeyValueList,
 * StatCard and `/proposed` Text, Skeleton, Spinner, Separator, Avatar, in customer and rider ×
 * light and dark.
 *
 * Few and high-value: targets (44 / 56 / 72), accessibility role, name and state, the primary
 * label colour (on-brand, never white), no danger colour outside Button danger and Badge danger,
 * and the halal seal green nowhere.
 */
import type { ReactElement } from 'react';
import { fireEvent, screen } from '@testing-library/react-native';
import { cents } from '@hg/api-client';

import * as ds from '../../../ds';
import * as proposed from '../../../proposed';
import { themes, tokens } from '../../../tokens';
import type { ColorScheme, ThemeName } from '../../../tokens';
import { SCHEMES, flat, hex, loadThemeCss, paintedColours, renderNw } from './harness';

const { Badge, Button, Card, IconButton, KeyValueList, Price, StatCard } = ds;
const { Avatar, Separator, Skeleton, Spinner, Text } = proposed;

beforeAll(loadThemeCss, 120_000);

const SEAL = tokens.color.halal.certified.seal.toUpperCase();
const ON_BRAND = '#0F241C';

function dangerColours(theme: ThemeName, scheme: ColorScheme): Set<string> {
  const t = themes[theme][scheme].color;
  return new Set<string>(
    // `onSolid` is the white label on a danger fill, not a danger colour itself.
    [t.feedback.danger.tint, t.feedback.danger.tintText, t.feedback.danger.text, t.feedback.danger.icon, t.feedback.danger.border, t.feedback.danger.solid, t.action.danger]
      .map(hex),
  );
}

const BUTTON_VARIANTS = ['primary', 'secondary', 'tertiary', 'ghost', 'danger'] as const;
const BUTTON_SIZES = ['sm', 'md', 'lg', 'xl'] as const;

describe('Button', () => {
  it('renders every variant and size with the live heights, and the rider 56 floor', () => {
    const customer = { sm: 36, md: 44, lg: 52, xl: 60 };
    const rider = { sm: 56, md: 56, lg: 56, xl: 60 };
    for (const theme of ['customer', 'rider'] as const) {
      for (const variant of BUTTON_VARIANTS) {
        for (const size of BUTTON_SIZES) {
          const { unmount } = renderNw(
            <Button variant={variant} size={size}>
              Place order
            </Button>,
            { theme },
          );
          const button = screen.getByRole('button', { name: 'Place order' });
          expect(flat(button).minHeight).toBe((theme === 'rider' ? rider : customer)[size]);
          unmount();
        }
      }
      const { unmount } = renderNw(<Button critical>Accept</Button>, { theme });
      expect(flat(screen.getByRole('button', { name: 'Accept' })).minHeight).toBe(72);
      unmount();
    }
  });

  it('gives sm a 44pt hit area and never clamps or caps the label (it wraps at 200%)', () => {
    renderNw(<Button size="sm">Add</Button>);
    const button = screen.getByRole('button', { name: 'Add' });
    expect(button.props.hitSlop).toEqual({ top: 4, bottom: 4 });
    const label = screen.getByTestId('Button-label');
    expect(label.props.numberOfLines).toBeUndefined();
    expect(label.props.maxFontSizeMultiplier).toBeUndefined();
  });

  it('primary: brand fill with the on-brand label, never white, in every theme and scheme', () => {
    for (const [theme, scheme] of SCHEMES) {
      const { unmount } = renderNw(<Button iconStart="plus">Go online</Button>, { theme, scheme });
      expect(hex(flat(screen.getByRole('button')).backgroundColor)).toBe(hex(themes[theme][scheme].color.action.primary));
      const label = hex(flat(screen.getByText('Go online')).color);
      expect(label).toBe(ON_BRAND);
      expect(label).not.toBe('#FFFFFF');
      unmount();
    }
  });

  it('disabled stays focusable, announces disabled, swallows presses', () => {
    const onPress = jest.fn();
    renderNw(
      <Button disabled onPress={onPress}>
        Pay
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Pay' });
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });
    expect(button.props.accessible).not.toBe(false);
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
    expect(flat(button).opacity).toBeCloseTo(0.6);
  });

  it('loading keeps label and colour, is busy, ignores presses and keeps its width', () => {
    const onPress = jest.fn();
    const idle = renderNw(
      <Button loading={false} onPress={onPress}>
        Save
      </Button>,
    );
    const idleTree = JSON.stringify(idle.toJSON());
    idle.unmount();
    renderNw(
      <Button loading onPress={onPress}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.props.accessibilityState).toMatchObject({ busy: true });
    expect(screen.getByText('Save')).toBeTruthy();
    expect(hex(flat(button).backgroundColor)).toBe(hex(themes.customer.light.color.action.primary));
    expect(flat(button).opacity).toBeUndefined();
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
    // Width does not jump: both states reserve the same 20pt leading and trailing slots.
    const slots = (json: string) => (json.match(/"width":20,"height":20/g) ?? []).length;
    expect(slots(JSON.stringify(screen.toJSON()))).toBe(slots(idleTree));
    expect(screen.getByTestId('Button-spinner', { includeHiddenElements: true })).toBeTruthy();
  });

  it('href is a link; destructive defaults to the danger fill', () => {
    renderNw(<Button href="https://example.com/help">Get help</Button>);
    expect(screen.getByRole('link', { name: 'Get help' })).toBeTruthy();
    renderNw(<Button destructive>Cancel order</Button>);
    expect(hex(flat(screen.getByRole('button', { name: 'Cancel order' })).backgroundColor)).toBe(
      hex(themes.customer.light.color.action.danger),
    );
  });
});

describe('IconButton', () => {
  it('sm 36 (hit 44), md 44, lg 56; every size is 56 on rider; the badge is in the name', () => {
    const sizes = { sm: 36, md: 44, lg: 56 } as const;
    for (const theme of ['customer', 'rider'] as const) {
      for (const size of ['sm', 'md', 'lg'] as const) {
        for (const variant of ['plain', 'filled', 'tonal'] as const) {
          const { unmount } = renderNw(
            <IconButton icon="cart" accessibilityLabel="Cart" badge={3} badgeNoun="items" size={size} variant={variant} />,
            { theme },
          );
          const s = flat(screen.getByRole('button', { name: 'Cart, 3 items' }));
          const px = theme === 'rider' ? 56 : sizes[size];
          expect([s.minHeight, s.minWidth]).toEqual([px, px]);
          unmount();
        }
      }
    }
    renderNw(<IconButton icon="search" accessibilityLabel="Search" size="sm" />);
    expect(screen.getByRole('button', { name: 'Search' }).props.hitSlop).toEqual({ top: 4, bottom: 4, left: 4, right: 4 });
  });

  it('filled is the brand fill with the dark label; loading is busy and swallows presses', () => {
    const onPress = jest.fn();
    renderNw(<IconButton icon="plus" accessibilityLabel="Add item" variant="filled" loading onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Add item' });
    expect(hex(flat(button).backgroundColor)).toBe(hex(themes.customer.light.color.action.primary));
    expect(button.props.accessibilityState).toMatchObject({ busy: true });
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('Badge', () => {
  it('renders every variant × appearance × size; a dot still carries its word; field size on rider', () => {
    const variants = ['neutral', 'info', 'warning', 'danger', 'brand', 'outline'] as const;
    for (const variant of variants) {
      for (const appearance of ['tint', 'solid', 'dot'] as const) {
        for (const size of ['sm', 'md', 'lg'] as const) {
          const { unmount } = renderNw(
            <Badge variant={variant} appearance={appearance} size={size}>
              Busy
            </Badge>,
          );
          expect(screen.getByLabelText('Busy')).toBeTruthy();
          expect(screen.getByText('Busy')).toBeTruthy();
          expect(flat(screen.getByTestId('Badge')).minHeight).toBe({ sm: 18, md: 22, lg: 26 }[size]);
          unmount();
        }
      }
    }
    renderNw(<Badge label={120} max={99} />, { theme: 'rider' });
    expect(screen.getByText('99+')).toBeTruthy();
    expect(flat(screen.getByTestId('Badge')).minHeight).toBe(32);
  });

  it('danger tint uses the feedback danger roles; brand solid is the on-brand pair', () => {
    renderNw(<Badge variant="danger">Overdue</Badge>);
    expect(hex(flat(screen.getByTestId('Badge')).backgroundColor)).toBe(hex(themes.customer.light.color.feedback.danger.tint));
    renderNw(
      <Badge variant="brand" appearance="solid" testId="b">
        New
      </Badge>,
    );
    expect(hex(flat(screen.getByText('New')).color)).toBe(ON_BRAND);
  });
});

describe('Card', () => {
  it('surfaces per variant; one press target with one name; media, header and footer render', () => {
    const t = themes.customer.light.color;
    const bg = { elevated: t.surface.raised, outlined: t.surface.raised, filled: t.surface.subtle } as const;
    for (const variant of ['elevated', 'outlined', 'filled'] as const) {
      const { unmount } = renderNw(<Card variant={variant}>{null}</Card>);
      expect(hex(flat(screen.getByTestId('Card')).backgroundColor)).toBe(hex(bg[variant]));
      unmount();
    }
    const onPress = jest.fn();
    renderNw(
      <Card
        onPress={onPress}
        accessibilityLabel="Zaytoun, 25 minutes"
        media={<Text>media</Text>}
        header={<Text>header</Text>}
        footer={<Text>footer</Text>}
      >
        <Text>body</Text>
      </Card>,
    );
    const card = screen.getByRole('button', { name: 'Zaytoun, 25 minutes' });
    expect(flat(card).borderRadius).toBe(tokens.radius.lg);
    fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
    for (const part of ['media', 'header', 'body', 'footer']) expect(screen.getByText(part)).toBeTruthy();
  });
});

describe('Price', () => {
  it('formats with U+2212, speaks money, uses tabular figures, follows Dynamic Type', () => {
    renderNw(<Price cents={cents(-300)} sign="always" size="lg" />);
    const price = screen.getByText('−$3.00');
    expect(price.props.accessibilityLabel).toBe('minus 3 dollars');
    expect(flat(price).fontVariant).toEqual(['tabular-nums']);
    expect(price.props.maxFontSizeMultiplier).toBeUndefined();
    expect(flat(price).fontSize).toBe(tokens.typography['heading.sm'].fontSize);
  });

  it('strikethrough announces "was"; onDark is the on-accent role; loading is a skeleton', () => {
    renderNw(<Price cents={cents(1599)} strikethrough />);
    const was = screen.getByLabelText('was 15 dollars and 99 cents');
    expect(flat(was).textDecorationLine).toBe('line-through');
    renderNw(<Price cents={cents(1850)} onDark testId="earned" />, { theme: 'rider', scheme: 'dark' });
    expect(hex(flat(screen.getByTestId('earned')).color)).toBe(hex(themes.rider.dark.color.text.onAccent));
    renderNw(<Price cents={cents(1850)} loading />);
    expect(screen.getByTestId('Price-skeleton', { includeHiddenElements: true })).toBeTruthy();
  });
});

describe('proposed core parts', () => {
  it('Text maps the type scale and bumps body.md to body.lg on rider', () => {
    renderNw(<Text variant="heading.lg">Title</Text>);
    expect(flat(screen.getByText('Title')).fontSize).toBe(tokens.typography['heading.lg'].fontSize);
    renderNw(<Text>Body</Text>, { theme: 'rider' });
    expect(flat(screen.getByText('Body')).fontSize).toBe(tokens.typography['body.lg'].fontSize);
  });

  it('Skeleton is visible on dark (neutral.700), hidden from assistive tech; Spinner, Separator, Avatar render', () => {
    renderNw(<Skeleton variant="card" />, { scheme: 'dark' });
    const blocks = paintedColours(screen.toJSON());
    expect(blocks).toContain(hex(tokens.color.neutral['700']));
    expect(screen.queryByTestId('Skeleton')).toBeNull();
    renderNw(<Spinner label="Loading your orders" />);
    expect(screen.getByLabelText('Loading your orders')).toBeTruthy();
    renderNw(<Separator label="or" />);
    expect(screen.getByLabelText('or')).toBeTruthy();
    renderNw(<Avatar name="Amina Yusuf" status="online" />);
    expect(screen.getByLabelText('Amina Yusuf')).toBeTruthy();
    expect(screen.getByText('AY')).toBeTruthy();
  });

  it('KeyValueList takes objects or canvas tuples and skips falsy rows; StatCard is an outlined tile', () => {
    renderNw(
      <KeyValueList
        rows={[{ label: 'Order', value: 'HG-1042', mono: true }, false, ['Placed', '7:42 pm']]}
      />,
    );
    expect(screen.getAllByTestId('KeyValueList-row')).toHaveLength(2);
    expect(screen.getByLabelText('Order, HG-1042')).toBeTruthy();
    renderNw(
      <StatCard label="Today" sub="12 deliveries">
        <Price cents={cents(18450)} size="xl" />
      </StatCard>,
    );
    const card = flat(screen.getByTestId('StatCard'));
    expect(hex(card.borderColor)).toBe(hex(themes.customer.light.color.border.decorative));
    expect(screen.getByText('12 deliveries')).toBeTruthy();
  });
});

describe('colour invariants across customer and rider × light and dark', () => {
  const everything = (): ReactElement[] => [
    <Button key="p">Pay</Button>,
    <Button key="s" variant="secondary" loading iconEnd="chevron-right">
      Next
    </Button>,
    <Button key="t" variant="tertiary" iconStart="info">
      Details
    </Button>,
    <Button key="g" variant="ghost" disabled>
      Skip
    </Button>,
    <IconButton key="i" icon="cart" accessibilityLabel="Cart" badge={4} variant="filled" />,
    <IconButton key="j" icon="bell" accessibilityLabel="Alerts" badge variant="tonal" />,
    ...(['neutral', 'info', 'warning', 'brand', 'outline'] as const).flatMap((variant) =>
      (['tint', 'solid', 'dot'] as const).map((appearance) => (
        <Badge key={`${variant}-${appearance}`} variant={variant} appearance={appearance} icon="clock">
          Word
        </Badge>
      )),
    ),
    <Card key="c" variant="outlined" header={<Text>h</Text>}>
      <Price cents={cents(1234)} />
    </Card>,
    <Price key="d" cents={cents(-500)} sign="always" strikethrough />,
    <StatCard key="sc" label="Week">
      <Price cents={cents(0)} free="Free delivery" />
    </StatCard>,
    <KeyValueList key="kv" rows={[['Rider', 'Sam']]} />,
    <Skeleton key="sk" variant="text" lines={2} />,
    <Spinner key="sp" />,
    <Separator key="se" />,
    <Avatar key="av" name="Sam Lee" status="offline" />,
  ];

  it('no danger colour outside Button danger and Badge danger, and never the seal green', () => {
    for (const [theme, scheme] of SCHEMES) {
      const danger = dangerColours(theme, scheme);
      for (const node of everything()) {
        const { toJSON, unmount } = renderNw(node, { theme, scheme });
        const painted = paintedColours(toJSON());
        expect(painted.filter((c) => danger.has(c))).toEqual([]);
        expect(painted).not.toContain(SEAL);
        unmount();
      }
      for (const node of [<Button key="x" variant="danger">Delete</Button>, <Badge key="y" variant="danger" appearance="solid">Late</Badge>]) {
        const { toJSON, unmount } = renderNw(node, { theme, scheme });
        expect(paintedColours(toJSON())).not.toContain(SEAL);
        unmount();
      }
    }
  });
});
