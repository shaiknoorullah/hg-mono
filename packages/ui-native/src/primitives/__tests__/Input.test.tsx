import { fireEvent, screen } from '@testing-library/react-native';

import { Input, formatTel } from '../Input';
import { getHidden, renderThemed, styleOf, themes } from './harness';

describe('Input', () => {
  it('renders the label as a real visible node, never as a placeholder', () => {
    renderThemed(<Input label="Delivery address" value="" onChange={() => {}} placeholder="123 Main St" />);
    expect(screen.getByText('Delivery address')).toBeTruthy();
    expect(screen.getByTestId('Input-field').props.accessibilityLabel).toBe('Delivery address');
  });

  it('thickens the border and shows the ring on focus, and drops both on blur', () => {
    renderThemed(<Input label="Email" value="" onChange={() => {}} />);
    const field = screen.getByTestId('Input-field');
    fireEvent(field, 'focus');
    expect(getHidden('Input-focus-ring')).toBeTruthy();
    fireEvent(field, 'blur');
    expect(screen.queryByTestId('Input-focus-ring', { includeHiddenElements: true })).toBeNull();
  });

  it('announces an error assertively, with a glyph as the second channel', () => {
    renderThemed(
      <Input label="Email" value="nope" onChange={() => {}} errorText="Enter a valid email" />,
    );
    const error = screen.getByTestId('Input-error');
    expect(error.props.accessibilityLiveRegion).toBe('assertive');
    // Never colour-only: the warning glyph rides with the text.
    expect(error.props.children).toContain('⚠ ');
    expect(styleOf(error).color).toBe(themes.customer.light.color.feedback.danger.text);
  });

  it('greys the field but keeps it addressable when disabled', () => {
    const onChange = jest.fn();
    renderThemed(<Input label="Email" value="" onChange={onChange} disabled />);
    const field = screen.getByTestId('Input-field');
    expect(field.props.accessibilityState.disabled).toBe(true);
    expect(field.props.editable).toBe(false);
    fireEvent.changeText(field, 'x');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('stays editable while loading — a trailing spinner is not a lock', () => {
    const onChange = jest.fn();
    renderThemed(<Input label="Email" value="" onChange={onChange} loading />);
    expect(getHidden('Input-spinner')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('Input-field'), 'a@b.ca');
    expect(onChange).toHaveBeenCalledWith('a@b.ca');
  });

  it('announces remaining characters once the count passes 80%', () => {
    renderThemed(
      <Input label="Notes" value={'x'.repeat(9)} onChange={() => {}} maxLength={10} characterCount />,
    );
    const count = screen.getByTestId('Input-count');
    expect(count.props.accessibilityLiveRegion).toBe('polite');
    expect(count.props.accessibilityLabel).toBe('1 characters remaining');
  });

  it('masks a phone number to the E.164 +1 display form and stores digits only', () => {
    const onChange = jest.fn();
    expect(formatTel('4165550123')).toBe('+1 (416) 555-0123');
    renderThemed(<Input label="Phone" variant="tel" value="4165550123" onChange={onChange} />);
    expect(screen.getByTestId('Input-field').props.value).toBe('+1 (416) 555-0123');
    fireEvent.changeText(screen.getByTestId('Input-field'), '+1 (416) 555-9999');
    expect(onChange).toHaveBeenCalledWith('4165559999');
  });

  it('renders the otp variant as six cells over one paste-aware field', () => {
    renderThemed(<Input label="Code" variant="otp" value="1234" onChange={() => {}} />);
    expect(getHidden('Input-cell-5')).toBeTruthy();
    const field = screen.getByTestId('Input-field');
    expect(field.props.autoComplete).toBe('one-time-code');
    expect(field.props.maxLength).toBe(6);
  });
});
