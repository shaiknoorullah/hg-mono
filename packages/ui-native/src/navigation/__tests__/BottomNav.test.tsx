/**
 * `BottomNav` — the raised bar and its detached primary action.
 *
 * Two things worth pinning beyond the existing hidden/badge behaviour (which has no dedicated
 * suite because nothing about it changed here): the action button is a SOFT TINT, never the
 * heavy solid fill that measured "too much on the eyes" in review, and it is ALWAYS orange
 * (`color.action.primary` / `color.border.brand`) — never green, per RULE H-1. A regression
 * that quietly swapped `brand.tint` for `brand.solid`, or swapped the brand tone for anything
 * touching `color.halal.*`, should fail here rather than in a design review.
 */
import { fireEvent, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { BottomNav } from '../BottomNav';
import { renderThemed, styleOf, themes } from '../../primitives/__tests__/harness';
import { palette } from '../../tokens';

const ITEMS = [
  { key: 'browse', label: 'Browse', icon: <Text>home</Text> },
  { key: 'orders', label: 'Orders', icon: <Text>orders</Text> },
];

describe('BottomNav — action button', () => {
  it('is a soft tint of the action colour, not a solid fill', () => {
    renderThemed(
      <BottomNav
        items={ITEMS}
        active="browse"
        onChange={() => {}}
        action={{
          label: 'New order',
          icon: <Text>plus</Text>,
          onPress: () => {},
        }}
      />,
    );
    const action = screen.getByTestId('BottomNav-action');
    const theme = themes.customer.light;
    const style = styleOf(action);
    expect(style.backgroundColor).toBe(theme.color.state.selectedTint);
    expect(style.backgroundColor).not.toBe(theme.color.action.primary);
  });

  it('is always orange — action colour or border, never a halal green', () => {
    const theme = themes.customer.light;
    renderThemed(
      <BottomNav
        items={ITEMS}
        active="browse"
        onChange={() => {}}
        action={{
          label: 'New order',
          icon: <Text>plus</Text>,
          onPress: () => {},
        }}
      />,
    );
    const style = styleOf(screen.getByTestId('BottomNav-action'));
    expect(style.borderColor).toBe(theme.color.border.brand);
    expect(style.borderColor).not.toBe(palette.halal.certified.seal);
    expect(style.backgroundColor).not.toBe(palette.halal.certified.seal);
  });

  it('carries the action label as its accessible name and fires onPress', () => {
    const onPress = jest.fn();
    renderThemed(
      <BottomNav
        items={ITEMS}
        active="browse"
        onChange={() => {}}
        action={{ label: 'New order', icon: <Text>plus</Text>, onPress }}
      />,
    );
    const action = screen.getByTestId('BottomNav-action');
    expect(action.props.accessibilityLabel).toBe('New order');
    fireEvent.press(action);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('omits the action entirely when no action prop is given', () => {
    renderThemed(<BottomNav items={ITEMS} active="browse" onChange={() => {}} />);
    expect(screen.queryByTestId('BottomNav-action')).toBeNull();
  });

  it('unmounts everything, action included, when hidden', () => {
    renderThemed(
      <BottomNav
        items={ITEMS}
        active="browse"
        onChange={() => {}}
        hidden
        action={{
          label: 'New order',
          icon: <Text>plus</Text>,
          onPress: () => {},
        }}
      />,
    );
    expect(screen.queryByTestId('BottomNav')).toBeNull();
    expect(screen.queryByTestId('BottomNav-action')).toBeNull();
  });
});

describe('BottomNav — the bar', () => {
  it('is the raised full-width bar, not the dark chrome pill', () => {
    const theme = themes.customer.light;
    renderThemed(<BottomNav items={ITEMS} active="browse" onChange={() => {}} />);
    const style = styleOf(screen.getByTestId('BottomNav-bar'));
    expect(style.backgroundColor).toBe(theme.color.surface.raised);
    expect(style.backgroundColor).not.toBe(theme.color.surface.chrome);
    expect(style.borderRadius).toBeUndefined();
  });

  it('marks only the active tab, in the brand colour', () => {
    const theme = themes.customer.light;
    renderThemed(<BottomNav items={ITEMS} active="orders" onChange={() => {}} />);
    expect(
      styleOf(
        screen.getByTestId('BottomNav-indicator-orders', {
          includeHiddenElements: true,
        }),
      ).backgroundColor,
    ).toBe(theme.color.border.brand);
    expect(
      styleOf(
        screen.getByTestId('BottomNav-indicator-browse', {
          includeHiddenElements: true,
        }),
      ).backgroundColor,
    ).toBe('transparent');
    expect(screen.getByTestId('BottomNav-tab-orders').props.accessibilityState).toMatchObject({
      selected: true,
    });
  });
});
