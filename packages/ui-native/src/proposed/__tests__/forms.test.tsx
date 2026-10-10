/**
 * The proposed form parts (design-system N3) on the real generated stylesheet: QuantityStepper
 * (Remove at the last unit, the limit state, the value frozen while loading), CheckboxGroup
 * (group error, maximum), DateInput (typed d/m/y to ISO), Textarea (counter), Field and
 * ErrorSummary (one announcement per submit).
 */
import { fireEvent, screen } from '@testing-library/react-native';

import { flat, loadThemeCss, renderNw } from '../../lib/ui/__tests__/harness';
import { CheckboxGroup, DateInput, ErrorSummary, Field, QuantityStepper, Textarea } from '..';
import { Input } from '../../ds';

beforeAll(loadThemeCss, 120_000);

describe('QuantityStepper', () => {
  it('at the last unit the minus becomes "Remove {item}" and removes it', () => {
    const onChange = jest.fn();
    renderNw(<QuantityStepper value={1} removeAtZero itemName="Chicken shawarma" onChange={onChange} />);
    const group = screen.getByTestId('QuantityStepper');
    expect([group.props.role, group.props.accessibilityLabel]).toEqual(['group', 'Quantity for Chicken shawarma']);
    fireEvent.press(screen.getByRole('button', { name: 'Remove Chicken shawarma' }));
    expect(onChange).toHaveBeenCalledWith(0);
    renderNw(<QuantityStepper value={2} removeAtZero itemName="Chicken shawarma" onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Decrease quantity' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove Chicken shawarma' })).toBeNull();
  });

  it('at max the plus is disabled, still focusable, and says why — visibly and with the button', () => {
    const onChange = jest.fn();
    renderNw(<QuantityStepper value={4} max={4} maxReason="Only 4 left today" onChange={onChange} />);
    const plus = screen.getByRole('button', { name: 'Increase quantity' });
    expect(plus.props.accessibilityState).toMatchObject({ disabled: true });
    expect(plus.props.accessibilityHint).toBe('Only 4 left today');
    expect(screen.getByText('Only 4 left today')).toBeTruthy();
    fireEvent.press(plus);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Quantity, 4').props.accessibilityValue).toEqual({ now: 4, min: 0, max: 4 });
  });

  it('loading freezes the value: busy, presses swallowed; the tonal cart variant removes with the same rule', () => {
    const onChange = jest.fn();
    renderNw(<QuantityStepper value={2} loading onChange={onChange} />);
    fireEvent.press(screen.getByRole('button', { name: 'Increase quantity' }));
    fireEvent.press(screen.getByRole('button', { name: 'Decrease quantity' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Updating quantity')).toBeTruthy();
    renderNw(<QuantityStepper variant="tonal" value={1} removeAtZero itemName="Mango lassi" onChange={onChange} />);
    fireEvent.press(screen.getByRole('button', { name: 'Remove Mango lassi' }));
    expect(onChange).toHaveBeenCalledWith(0);
  });
});

describe('CheckboxGroup', () => {
  const options = [
    { value: 'hummus', label: 'Hummus', priceDeltaCents: 200 },
    { value: 'pickles', label: 'Pickles' },
    { value: 'garlic', label: 'Garlic sauce', priceDeltaCents: 150 },
  ];

  it('at max the unchosen options are disabled with the reason; the chosen ones can still be cleared', () => {
    const onValueChange = jest.fn();
    renderNw(<CheckboxGroup label="Add-ons" max={2} value={['hummus', 'garlic']} options={options} onValueChange={onValueChange} />);
    const group = screen.getByTestId('CheckboxGroup');
    expect([group.props.role, group.props.accessibilityLabel]).toEqual(['group', 'Add-ons']);
    expect(group.props.accessibilityHint).toBe('Choose up to 2');
    const pickles = screen.getByRole('checkbox', { name: 'Pickles' });
    expect(pickles.props.accessibilityState).toMatchObject({ disabled: true, checked: false });
    expect(pickles.props.accessibilityHint).toBe('You can choose up to 2');
    fireEvent.press(pickles);
    expect(onValueChange).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('checkbox', { name: 'Hummus, plus 2 dollars' }));
    expect(onValueChange).toHaveBeenCalledWith(['garlic']);
    expect(screen.getByText('+$1.50')).toBeTruthy();
  });

  it('the group error is announced once, on the group', () => {
    renderNw(<CheckboxGroup label="Add-ons" min={1} required error="Choose at least one" value={[]} options={options} />);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    const group = screen.getByTestId('CheckboxGroup');
    expect(group.props.accessibilityLabel).toBe('Add-ons, required');
    expect(group.props.accessibilityHint).toBe('Choose at least 1. Choose at least one');
    for (const box of screen.getAllByRole('checkbox')) expect(box.props.accessibilityHint).toBeUndefined();
  });
});

describe('DateInput', () => {
  it('typed day, month and year become ISO; an impossible date marks the part and is one alert', () => {
    const onValueChange = jest.fn();
    renderNw(<DateInput label="Date of birth" onValueChange={onValueChange} />, { theme: 'rider' });
    fireEvent.changeText(screen.getByTestId('DateInput-day-field'), '7');
    fireEvent.changeText(screen.getByTestId('DateInput-month-field'), '03');
    fireEvent.changeText(screen.getByTestId('DateInput-year-field'), '1994');
    expect(onValueChange).toHaveBeenLastCalledWith('1994-03-07');
    fireEvent.changeText(screen.getByTestId('DateInput-day-field'), '31');
    fireEvent.changeText(screen.getByTestId('DateInput-month-field'), '4');
    expect(onValueChange).toHaveBeenLastCalledWith(null);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert', { name: 'The day must be between 1 and 30' })).toBeTruthy();
    // Rider parts are 56pt fields.
    expect(flat(screen.getByTestId('DateInput-day-frame')).minHeight).toBe(56);
  });

  it('respects max (the 18-year rule) and a controlled value fills the parts', () => {
    renderNw(<DateInput label="Date of birth" value="2001-12-25" max="2008-10-10" />);
    expect(screen.getByTestId('DateInput-day-field').props.value).toBe('25');
    expect(screen.getByTestId('DateInput-month-field').props.value).toBe('12');
    expect(screen.getByTestId('DateInput-year-field').props.value).toBe('2001');
    fireEvent.changeText(screen.getByTestId('DateInput-year-field'), '2010');
    expect(screen.getByRole('alert', { name: 'The date must be on or before 2008-10-10' })).toBeTruthy();
  });
});

describe('Textarea, Field and ErrorSummary', () => {
  it('Textarea is multiline with a counter by default when it has a limit', () => {
    const onValueChange = jest.fn();
    renderNw(<Textarea label="Override reason" maxLength={500} onValueChange={onValueChange} />);
    const field = screen.getByTestId('Textarea-field');
    expect(field.props.multiline).toBe(true);
    fireEvent.changeText(field, 'Gate code missing');
    expect(onValueChange).toHaveBeenCalledWith('Gate code missing');
    expect(screen.getByTestId('Textarea-count').props.children).toBe('17/500');
  });

  it('one submit, one announcement: the summary alerts, the fields show their errors silently', () => {
    const focusDob = jest.fn();
    renderNw(
      <>
        <ErrorSummary errors={[{ message: 'Enter your date of birth', onPress: focusDob }, { message: 'Enter your email' }]} />
        <Input label="Email" errorText="Enter your email" announceError={false} />
        <Field label="Photo" errorText="Add a photo" announceError={false}>
          {null}
        </Field>
      </>,
    );
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert', { name: 'There is a problem. 2 problems' })).toBeTruthy();
    // The field still shows its error, silently: once in the summary, once under the field.
    expect(screen.getAllByText('Enter your email')).toHaveLength(2);
    expect(screen.getByText('Add a photo')).toBeTruthy();
    fireEvent.press(screen.getByRole('link', { name: 'Enter your date of birth' }));
    expect(focusDob).toHaveBeenCalled();
    renderNw(<ErrorSummary errors={[]} />);
    expect(screen.queryByTestId('ErrorSummary')).toBeNull();
  });
});
