import { fireEvent, screen } from '@testing-library/react-native';

import { Chip, FilterChip } from '../Chip';
import { getHidden, renderThemed, styleOf, themes } from './harness';

describe('Chip', () => {
  it('renders a static attribute chip that is not a control', () => {
    renderThemed(<Chip label="Lebanese" />);
    const chip = screen.getByTestId('Chip');
    expect(chip.props.accessibilityRole).toBeUndefined();
    expect(chip.props.accessibilityLabel).toBe('Lebanese');
  });

  it('reports a filter chip as a pressable with a selected state', () => {
    const onPress = jest.fn();
    renderThemed(<FilterChip label="Open now" selected onPress={onPress} />);
    const chip = screen.getByTestId('FilterChip');
    expect(chip.props.accessibilityRole).toBe('button');
    expect(chip.props.accessibilityState.selected).toBe(true);
    fireEvent.press(chip);
    expect(onPress).toHaveBeenCalled();
  });

  it('marks selection with border, tint and a check glyph — never fill alone', () => {
    renderThemed(<FilterChip label="Open now" selected onPress={() => {}} />);
    const style = styleOf(screen.getByTestId('FilterChip'));
    expect(style.borderWidth).toBe(2);
    expect(style.backgroundColor).toBe(themes.customer.light.color.state.selectedTint);
    expect(screen.getByText('✓', { includeHiddenElements: true })).toBeTruthy();
  });

  it('draws veg and non-veg as outlines, never as fills (RULE H-1)', () => {
    const veg = renderThemed(<Chip label="Vegetarian" tone="veg" testID="Chip-veg" />);
    const vegStyle = styleOf(screen.getByTestId('Chip-veg'));
    expect(vegStyle.backgroundColor).toBe('transparent');
    expect(vegStyle.borderColor).toBe(themes.customer.light.color.feedback.success.border);
    veg.unmount();

    renderThemed(<Chip label="Contains meat" tone="nonveg" testID="Chip-nonveg" />);
    const nonVegStyle = styleOf(screen.getByTestId('Chip-nonveg'));
    expect(nonVegStyle.backgroundColor).toBe('transparent');
    expect(nonVegStyle.borderColor).toBe(themes.customer.light.color.feedback.danger.border);
  });

  it('gives a removable chip its own named dismiss target', () => {
    const onRemove = jest.fn();
    renderThemed(<Chip label="Peanuts" variant="input" onRemove={onRemove} onPress={() => {}} />);
    const remove = screen.getByTestId('Chip-remove');
    expect(remove.props.accessibilityLabel).toBe('Remove Peanuts');
    fireEvent.press(remove);
    expect(onRemove).toHaveBeenCalled();
  });

  it('swallows the press and dims when disabled, and rings on focus', () => {
    const onPress = jest.fn();
    renderThemed(<FilterChip label="Open now" onPress={onPress} disabled />);
    const chip = screen.getByTestId('FilterChip');
    expect(styleOf(chip).opacity).toBe(themes.customer.light.color.state.disabledOpacity);
    fireEvent.press(chip);
    expect(onPress).not.toHaveBeenCalled();
    fireEvent(chip, 'focus');
    expect(getHidden('FilterChip-focus-ring')).toBeTruthy();
  });
});
