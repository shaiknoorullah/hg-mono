import { act, fireEvent, screen } from '@testing-library/react-native';

import { Toast } from '../Toast';
import { renderThemed, styleOf, themes } from './harness';

describe('Toast', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('announces politely and carries its message in the accessible name', () => {
    renderThemed(<Toast title="Order placed" description="We told the restaurant." />);
    const toast = screen.getByTestId('Toast');
    expect(toast.props.accessibilityLiveRegion).toBe('polite');
    expect(toast.props.accessibilityLabel).toBe('Order placed. We told the restaurant.');
  });

  it('renders success as a tint with a coloured glyph and no green fill (RULE H-1)', () => {
    renderThemed(<Toast variant="success" title="Address saved" />);
    const style = styleOf(screen.getByTestId('Toast'));
    const success = themes.customer.light.color.feedback.success;
    expect(style.backgroundColor).toBe(success.tint);
    // There is no solid to fall back to — the token itself refuses.
    expect(success.solid).toBeNull();
  });

  it('escalates danger to an assertive alert and never auto-dismisses it', () => {
    const onDismiss = jest.fn();
    renderThemed(
      <Toast variant="danger" title="Payment declined" onDismiss={onDismiss} />,
    );
    expect(screen.getByTestId('Toast').props.accessibilityRole).toBe('alert');
    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('auto-dismisses an ordinary toast after its duration', () => {
    const onDismiss = jest.fn();
    renderThemed(<Toast title="Address saved" onDismiss={onDismiss} />);
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('pauses the timer while the toast has focus — a message must not vanish mid-read', () => {
    const onDismiss = jest.fn();
    renderThemed(<Toast title="Address saved" onDismiss={onDismiss} />);
    fireEvent(screen.getByTestId('Toast-dismiss'), 'focus');
    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('stays put when it carries an action, and the action is reachable', () => {
    const onPress = jest.fn();
    const onDismiss = jest.fn();
    renderThemed(
      <Toast
        title="You are still on a delivery"
        action={{ label: 'Go offline after delivery', onPress }}
        onDismiss={onDismiss}
      />,
    );
    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('Toast-action'));
    expect(onPress).toHaveBeenCalled();
  });

  it('gives dismiss a real target, not a 12px glyph', () => {
    renderThemed(<Toast title="Address saved" onDismiss={() => {}} />);
    const dismiss = screen.getByTestId('Toast-dismiss');
    expect(dismiss.props.accessibilityLabel).toBe('Dismiss');
    expect(styleOf(dismiss).minHeight).toBeGreaterThanOrEqual(themes.customer.light.target.min);
  });
});
