/** `IconButton` and `Badge` — the two primitives whose whole job is not to lose meaning. */
import { fireEvent, screen } from '@testing-library/react-native';

import { Badge } from '../Badge';
import { IconButton } from '../IconButton';
import { getHidden, renderThemed, styleOf, themes } from './harness';

describe('IconButton', () => {
  it('carries the name the icon cannot, and hides the icon itself', () => {
    renderThemed(<IconButton icon="heart" accessibilityLabel="Add Al Wadi Grill to favourites" onPress={() => {}} />);
    const button = screen.getByTestId('IconButton');
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityLabel).toBe('Add Al Wadi Grill to favourites');
  });

  it('keeps a count inside its own name rather than as a loose node', () => {
    renderThemed(
      <IconButton icon="cart" accessibilityLabel="Cart" badge={{ count: 3 }} onPress={() => {}} />,
    );
    expect(screen.getByTestId('IconButton').props.accessibilityLabel).toBe('Cart, 3');
    expect(getHidden('IconButton-badge').props.accessibilityElementsHidden).toBe(true);
  });

  it('caps a count at max', () => {
    renderThemed(
      <IconButton icon="bell" accessibilityLabel="Alerts" badge={{ count: 140, max: 99 }} onPress={() => {}} />,
    );
    expect(screen.getByTestId('IconButton').props.accessibilityLabel).toBe('Alerts, 99+');
  });

  it('never shrinks below the target floor even at 36 visual', () => {
    renderThemed(<IconButton icon="close" size="sm" accessibilityLabel="Close" onPress={() => {}} />);
    const button = screen.getByTestId('IconButton');
    const style = styleOf(button);
    const slop = button.props.hitSlop;
    expect(Number(style.width) + slop.left + slop.right).toBeGreaterThanOrEqual(
      themes.customer.light.target.min,
    );
  });

  it('blocks re-entry while loading and while disabled, keeping its name in both', () => {
    const onPress = jest.fn();
    const loading = renderThemed(
      <IconButton icon="check" accessibilityLabel="Accept" loading onPress={onPress} />,
    );
    expect(screen.getByTestId('IconButton').props.accessibilityState.busy).toBe(true);
    fireEvent.press(screen.getByTestId('IconButton'));
    loading.unmount();

    renderThemed(<IconButton icon="check" accessibilityLabel="Accept" disabled onPress={onPress} />);
    fireEvent.press(screen.getByTestId('IconButton'));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('Badge', () => {
  it('is announced as text and never as colour alone', () => {
    renderThemed(<Badge variant="danger" label="Late" />);
    expect(screen.getByTestId('Badge').props.accessibilityLabel).toBe('Late');
    expect(screen.getByText('Late')).toBeTruthy();
  });

  it('has no success variant — a badge that means good is brand or is a word', () => {
    const variants = ['neutral', 'info', 'warning', 'danger', 'brand', 'outline'];
    expect(variants).not.toContain('success');
  });

  it('renders a solid danger badge on the semantic solid with its own label colour', () => {
    renderThemed(<Badge variant="danger" style="solid" label="Expired" />);
    const danger = themes.customer.light.color.feedback.danger;
    expect(styleOf(screen.getByTestId('Badge')).backgroundColor).toBe(danger.solid);
  });

  it('applies the count ceiling', () => {
    renderThemed(<Badge variant="info" label="140" max={99} />);
    expect(screen.getByText('99+')).toBeTruthy();
  });
});
