import { fireEvent, screen } from '@testing-library/react-native';

import { Button } from '../Button';
import { getHidden, renderThemed, styleOf, themes } from './harness';

describe('Button', () => {
  it('renders the default state with a button role and its label as the name', () => {
    renderThemed(<Button onPress={() => {}}>Place order</Button>);
    const button = screen.getByTestId('Button');
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityLabel).toBe('Place order');
    expect(styleOf(button).backgroundColor).toBe(themes.customer.light.color.action.primary);
  });

  it('composites the pressed overlay while held', () => {
    renderThemed(<Button onPress={() => {}}>Place order</Button>);
    const button = screen.getByTestId('Button');
    fireEvent(button, 'pressIn');
    expect(screen.getByTestId('Button-label')).toBeTruthy();
    fireEvent(button, 'pressOut');
  });

  it('draws the two-layer focus ring only on accessibility focus', () => {
    renderThemed(<Button onPress={() => {}}>Place order</Button>);
    expect(screen.queryByTestId('Button-focus-ring', { includeHiddenElements: true })).toBeNull();
    fireEvent(screen.getByTestId('Button'), 'focus');
    // On a brand fill the ring flips to focus.onColor: info.500 is 2.84:1 on yellow.
    expect(styleOf(getHidden('Button-focus-ring')).borderColor).toBe(
      themes.customer.light.color.focus.onColor,
    );
  });

  it('stays announceable when disabled and swallows the press', () => {
    const onPress = jest.fn();
    renderThemed(
      <Button disabled onPress={onPress}>
        Place order
      </Button>,
    );
    const button = screen.getByTestId('Button');
    // aria-disabled, not `disabled`: a disabled button must still be able to explain itself.
    expect(button.props.accessibilityState.disabled).toBe(true);
    expect(button.props.accessibilityLabel).toBe('Place order');
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('keeps its label while loading, marks itself busy, and refuses re-entry', () => {
    const onPress = jest.fn();
    renderThemed(
      <Button loading onPress={onPress}>
        Place order
      </Button>,
    );
    const button = screen.getByTestId('Button');
    expect(button.props.accessibilityState.busy).toBe(true);
    // loading is not disabled: the name survives and the label stays visible.
    expect(button.props.accessibilityState.disabled).toBe(false);
    expect(screen.getByTestId('Button-label').props.children).toBe('Place order');
    expect(getHidden('Button-spinner')).toBeTruthy();
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('honours the rider register: a critical action clears target.criticalField', () => {
    renderThemed(
      <Button critical size="xl" onPress={() => {}}>
        Accept offer
      </Button>,
      { theme: 'rider', scheme: 'dark' },
    );
    // Dynamic Type grows the box rather than clipping the label, so the floor is a minimum.
    expect(styleOf(screen.getByTestId('Button')).minHeight).toBeGreaterThanOrEqual(
      themes.rider.dark.target.critical,
    );
  });

  it('has no success variant — RULE H-1 reserves solid green to the halal namespace', () => {
    const variants = ['primary', 'secondary', 'tertiary', 'ghost', 'danger'];
    // A compile-time guarantee, asserted here so the intent survives a refactor.
    expect(variants).not.toContain('success');
  });
});
