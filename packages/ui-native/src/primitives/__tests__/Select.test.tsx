import { fireEvent, screen } from '@testing-library/react-native';

import { Select } from '../Select';
import { getHidden, renderThemed } from './harness';

const OPTIONS = [
  { value: 'halal-monitoring-authority', label: 'Halal Monitoring Authority' },
  { value: 'isna-canada', label: 'ISNA Canada', description: 'Islamic Society of North America' },
  { value: 'hmc', label: 'HMC', disabled: true },
];

describe('Select', () => {
  it('presents the trigger as a combobox that reports its collapsed state', () => {
    renderThemed(<Select label="Certifying body" options={OPTIONS} value={null} onChange={() => {}} />);
    const trigger = screen.getByTestId('Select-trigger');
    expect(trigger.props.accessibilityRole).toBe('combobox');
    expect(trigger.props.accessibilityState.expanded).toBe(false);
    expect(trigger.props.accessibilityValue.text).toBe('Select…');
  });

  it('opens the list, reports expanded, and returns the chosen value', () => {
    const onChange = jest.fn();
    renderThemed(<Select label="Certifying body" options={OPTIONS} value={null} onChange={onChange} />);
    fireEvent.press(screen.getByTestId('Select-trigger'));
    expect(screen.getByTestId('Select-trigger').props.accessibilityState.expanded).toBe(true);
    fireEvent.press(screen.getByTestId('Select-option-isna-canada'));
    expect(onChange).toHaveBeenCalledWith('isna-canada');
  });

  it('marks a disabled option rather than hiding it', () => {
    renderThemed(<Select label="Certifying body" options={OPTIONS} value={null} onChange={() => {}} />);
    fireEvent.press(screen.getByTestId('Select-trigger'));
    expect(screen.getByTestId('Select-option-hmc').props.accessibilityState.disabled).toBe(true);
  });

  it('shows a skeleton list while loading — never an empty list', () => {
    renderThemed(<Select label="Certifying body" options={[]} value={null} onChange={() => {}} loading />);
    fireEvent.press(screen.getByTestId('Select-trigger'));
    expect(getHidden('Select-loading')).toBeTruthy();
    expect(screen.queryByTestId('Select-empty')).toBeNull();
  });

  it('explains an empty result set instead of showing nothing', () => {
    renderThemed(
      <Select
        label="Certifying body"
        options={[]}
        value={null}
        onChange={() => {}}
        emptyText="No accepted bodies for this region yet"
      />,
    );
    fireEvent.press(screen.getByTestId('Select-trigger'));
    expect(screen.getByText('No accepted bodies for this region yet')).toBeTruthy();
  });

  it('renders the inline variant as a single-tab-stop radio group', () => {
    const onChange = jest.fn();
    renderThemed(
      <Select
        label="Order type"
        variant="inline"
        options={[
          { value: 'delivery', label: 'Delivery' },
          { value: 'pickup', label: 'Pickup' },
        ]}
        value="delivery"
        onChange={onChange}
      />,
    );
    const option = screen.getByTestId('Select-option-delivery');
    expect(option.props.accessibilityRole).toBe('radio');
    expect(option.props.accessibilityState.checked).toBe(true);
    fireEvent.press(screen.getByTestId('Select-option-pickup'));
    expect(onChange).toHaveBeenCalledWith('pickup');
  });

  it('swallows the press when disabled', () => {
    renderThemed(
      <Select label="Certifying body" options={OPTIONS} value={null} onChange={() => {}} disabled />,
    );
    fireEvent.press(screen.getByTestId('Select-trigger'));
    expect(screen.getByTestId('Select-trigger').props.accessibilityState.expanded).toBe(false);
  });
});
