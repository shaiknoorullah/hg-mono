import { fireEvent, screen } from '@testing-library/react-native';

import { Checkbox, formatCentsDelta } from '../Checkbox';
import { Radio, RadioGroup } from '../Radio';
import { getHidden, renderThemed, styleOf, themes } from './harness';

describe('Checkbox', () => {
  it('is a checkbox whose whole row is the target', () => {
    renderThemed(<Checkbox checked={false} onChange={() => {}} label="Extra sauce" />);
    const box = screen.getByTestId('Checkbox');
    expect(box.props.accessibilityRole).toBe('checkbox');
    expect(box.props.accessibilityState.checked).toBe(false);
    expect(styleOf(box).minHeight).toBeGreaterThanOrEqual(themes.customer.light.target.min);
  });

  it('fills with the brand control colour when checked — never green (RULE H-1)', () => {
    renderThemed(<Checkbox checked onChange={() => {}} label="Extra sauce" />);
    expect(styleOf(getHidden('Checkbox-box')).backgroundColor).toBe(
      themes.customer.light.color.action.control,
    );
  });

  it('reports the mixed state rather than guessing', () => {
    renderThemed(<Checkbox checked={false} indeterminate onChange={() => {}} label="All items" />);
    expect(screen.getByTestId('Checkbox').props.accessibilityState.checked).toBe('mixed');
  });

  it('shows the focus ring on the control, not on the row', () => {
    renderThemed(<Checkbox checked={false} onChange={() => {}} label="Extra sauce" />);
    fireEvent(screen.getByTestId('Checkbox'), 'focus');
    expect(getHidden('Checkbox-focus-ring')).toBeTruthy();
  });

  it('says why it is disabled instead of going quietly grey', () => {
    const onChange = jest.fn();
    renderThemed(
      <Checkbox
        checked={false}
        onChange={onChange}
        label="Grilled halloumi"
        disabled
        disabledReason="Out of stock"
      />,
    );
    expect(screen.getByTestId('Checkbox-disabled-reason')).toBeTruthy();
    fireEvent.press(screen.getByTestId('Checkbox'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders a price delta from int64 cents with no float in the path', () => {
    expect(formatCentsDelta(150)).toBe('+$1.50');
    expect(formatCentsDelta(-75)).toBe('-$0.75');
    expect(formatCentsDelta(1005)).toBe('+$10.05');
    renderThemed(
      <Checkbox checked={false} onChange={() => {}} label="Extra sauce" priceDeltaCents={150} />,
    );
    expect(screen.getByTestId('Checkbox-price').props.children).toBe('+$1.50');
  });
});

describe('RadioGroup', () => {
  it('is one group with one label, and options report their selection', () => {
    const onChange = jest.fn();
    renderThemed(
      <RadioGroup name="size" label="Size" value="regular" onChange={onChange}>
        <Radio value="regular" label="Regular" testID="Radio-regular" />
        <Radio value="large" label="Large" priceDeltaCents={200} testID="Radio-large" />
      </RadioGroup>,
    );
    expect(screen.getByTestId('RadioGroup').props.accessibilityRole).toBe('radiogroup');
    expect(screen.getByTestId('Radio-regular').props.accessibilityState.checked).toBe(true);
    fireEvent.press(screen.getByTestId('Radio-large'));
    expect(onChange).toHaveBeenCalledWith('large');
  });

  it('announces a required-group error on the group, not on the last option', () => {
    renderThemed(
      <RadioGroup name="reason" label="Refund reason" value={null} onChange={() => {}} required errorText="Choose a reason">
        <Radio value="late" label="Arrived late" testID="Radio-late" />
      </RadioGroup>,
    );
    const error = screen.getByTestId('RadioGroup-error');
    expect(error.props.accessibilityLiveRegion).toBe('assertive');
    expect(screen.getByTestId('Radio-late').props.accessibilityState.checked).toBe(false);
  });
});
