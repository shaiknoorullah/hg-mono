import { fireEvent, screen } from '@testing-library/react-native';

import { Input, formatTel } from '../Input';
import { getHidden, renderThemed, styleOf, themes } from './harness';

describe('Input', () => {
  it('renders the label as a real visible node, never as a placeholder', () => {
    renderThemed(<Input label="Delivery address" value="" onChange={() => {}} placeholder="123 Main St" />);
    expect(screen.getByText('Delivery address')).toBeTruthy();
    expect(screen.getByTestId('Input-field').props.accessibilityLabel).toBe('Delivery address');
  });

  // docs/decisions/focus-indicator.md: one indicator. Focus is the field's own 2px
  // brand border, never border + ring.
  it('shows focus as a 2px brand border with no ring, and reverts on blur', () => {
    renderThemed(<Input label="Email" value="" onChange={() => {}} />);
    const field = screen.getByTestId('Input-field');
    const box = () => styleOf(screen.getByTestId('Input-field').parent!.parent!);
    fireEvent(field, 'focus');
    expect(box().borderWidth).toBe(2);
    expect(box().borderColor).toBe(themes.customer.light.color.border.brand);
    expect(screen.queryByTestId('Input-focus-ring', { includeHiddenElements: true })).toBeNull();
    fireEvent(field, 'blur');
    expect(box().borderWidth).toBe(1);
  });

  it('keeps the danger border on an invalid field and draws the ring for focus', () => {
    renderThemed(<Input label="Email" value="x" onChange={() => {}} errorText="Enter a valid email" />);
    fireEvent(screen.getByTestId('Input-field'), 'focus');
    expect(getHidden('Input-focus-ring')).toBeTruthy();
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

  it('formats a phone number nationally behind a fixed +1 and stores digits only', () => {
    const onChange = jest.fn();
    expect(formatTel('4165550123')).toBe('416 555 0123');
    renderThemed(<Input label="Phone" variant="tel" value="4165550123" onChange={onChange} />);
    expect(screen.getByTestId('Input-field').props.value).toBe('416 555 0123');
    expect(getHidden('Input-tel-prefix')).toBeTruthy();
    // A pasted +1 number loses its country code; the field already draws it.
    fireEvent.changeText(screen.getByTestId('Input-field'), '+1 (416) 555-9999');
    expect(onChange).toHaveBeenCalledWith('4165559999');
  });

  it('keeps a pasted international number as typed instead of forcing +1 onto it', () => {
    const onChange = jest.fn();
    renderThemed(<Input label="Phone" variant="tel" value="" onChange={onChange} />);
    fireEvent.changeText(screen.getByTestId('Input-field'), '+44 7700 900123');
    expect(onChange).toHaveBeenCalledWith('+44 7700 900123');
    expect(formatTel('+44 7700 900123')).toBe('+44 7700 900123');
  });

  it('renders the otp variant as six cells over one paste-aware field', () => {
    renderThemed(<Input label="Code" variant="otp" value="1234" onChange={() => {}} />);
    expect(getHidden('Input-cell-5')).toBeTruthy();
    const field = screen.getByTestId('Input-field');
    expect(field.props.autoComplete).toBe('one-time-code');
    expect(field.props.maxLength).toBe(6);
  });
});
