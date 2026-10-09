/**
 * The cart's `tonal` stepper: the canvas's round buttons, and at the last unit the minus is a
 * remove action named for the dish. The value never moves until the server answers.
 */
import { fireEvent, screen } from '@testing-library/react-native';

import { QuantityStepper } from '../QuantityStepper';
import { renderThemed } from '../../primitives/__tests__/harness';

describe('QuantityStepper — tonal', () => {
  it('at one unit, the minus removes the line and says so', () => {
    const onChange = jest.fn();
    renderThemed(
      <QuantityStepper
        variant="tonal"
        value={1}
        min={0}
        removeAtZero
        itemName="Mango lassi"
        onChange={onChange}
      />,
    );
    const minus = screen.getByTestId('QuantityStepper-decrement');
    expect(minus.props.accessibilityLabel).toBe('Remove Mango lassi');
    fireEvent.press(minus);
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('freezes while a change is in flight', () => {
    const onChange = jest.fn();
    renderThemed(<QuantityStepper variant="tonal" value={2} loading onChange={onChange} />);
    fireEvent.press(screen.getByTestId('QuantityStepper-increment'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
