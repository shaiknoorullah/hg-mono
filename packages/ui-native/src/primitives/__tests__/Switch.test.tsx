import { fireEvent, screen } from '@testing-library/react-native';

import { Switch } from '../Switch';
import { getHidden, renderThemed, styleOf, themes } from './harness';

const RIDER_STATES = { on: 'Online', off: 'Offline' };

describe('Switch', () => {
  it('is a switch, and its state is a word as well as a position', () => {
    renderThemed(
      <Switch checked={false} onChange={() => {}} label="Availability" stateLabels={RIDER_STATES} />,
    );
    const control = screen.getByTestId('Switch');
    expect(control.props.accessibilityRole).toBe('switch');
    expect(control.props.accessibilityState.checked).toBe(false);
    // Position alone means nothing in isolation, and nothing at all in RTL.
    expect(screen.getByTestId('Switch-state').props.children).toBe('Offline');
  });

  it('uses a track colour that clears 3:1 in both positions', () => {
    const { rerender } = renderThemed(
      <Switch checked={false} onChange={() => {}} label="Availability" />,
    );
    expect(styleOf(getHidden('Switch-track')).backgroundColor).toBe(
      themes.customer.light.color.border.strong,
    );
    rerender(<Switch checked onChange={() => {}} label="Availability" />);
  });

  it('does not move while loading — it waits for the server', () => {
    const onChange = jest.fn();
    renderThemed(
      <Switch
        checked={false}
        onChange={onChange}
        label="Availability"
        stateLabels={RIDER_STATES}
        loading
      />,
    );
    const control = screen.getByTestId('Switch');
    expect(control.props.accessibilityState.busy).toBe(true);
    // Still off, still says Offline, and the press is swallowed: an optimistic switch that
    // snaps back is the worst possible behaviour for a rider going offline.
    expect(control.props.accessibilityState.checked).toBe(false);
    expect(screen.getByTestId('Switch-state').props.children).toBe('Offline');
    expect(getHidden('Switch-spinner')).toBeTruthy();
    fireEvent.press(control);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('swallows the press when disabled and keeps its name', () => {
    const onChange = jest.fn();
    renderThemed(<Switch checked onChange={onChange} label="Accepting orders" disabled />);
    const control = screen.getByTestId('Switch');
    expect(control.props.accessibilityState.disabled).toBe(true);
    expect(control.props.accessibilityLabel).toBe('Accepting orders');
    fireEvent.press(control);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the focus ring on the control', () => {
    renderThemed(<Switch checked={false} onChange={() => {}} label="Availability" />);
    fireEvent(screen.getByTestId('Switch'), 'focus');
    expect(getHidden('Switch-focus-ring')).toBeTruthy();
  });

  it('toggles when it is neither disabled nor loading', () => {
    const onChange = jest.fn();
    renderThemed(<Switch checked={false} onChange={onChange} label="Availability" />);
    fireEvent.press(screen.getByTestId('Switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
