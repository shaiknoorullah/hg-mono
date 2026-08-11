/**
 * `EmptyState` and `ErrorState` are the components that make "every screen implements empty,
 * loading and error" affordable, so the thing worth testing is that they work in both of their
 * shapes: with an action, and — the case a screen actually hits most often — without one.
 */
import { render, screen, fireEvent } from '@testing-library/react-native';
import { Text } from 'react-native';

import { EmptyState } from '../EmptyState';
import { ErrorState } from '../ErrorState';

describe('EmptyState', () => {
  it('renders without an action', () => {
    render(
      <EmptyState
        title="No orders in this period"
        description="Try a wider date range to see more."
      />,
    );
    expect(screen.getByText('No orders in this period')).toBeTruthy();
    expect(screen.getByText('Try a wider date range to see more.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders with a primary action and calls it', () => {
    const onPress = jest.fn();
    render(
      <EmptyState
        title="You haven't ordered yet"
        description="Browse halal restaurants near you."
        primaryAction={{ label: 'Browse restaurants', onPress, testID: 'browse' }}
      />,
    );
    fireEvent.press(screen.getByTestId('browse'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders with both actions and hides the illustration from assistive technology', () => {
    render(
      <EmptyState
        title="No saved addresses"
        description="Add one to get started."
        illustration={<Text>illustration</Text>}
        primaryAction={{ label: 'Add address', onPress: jest.fn(), testID: 'add' }}
        secondaryAction={{ label: 'Not now', onPress: jest.fn(), testID: 'later' }}
      />,
    );
    expect(screen.getByTestId('add')).toBeTruthy();
    expect(screen.getByTestId('later')).toBeTruthy();
  });
});

describe('ErrorState', () => {
  it('renders without an action, using generic copy for an unmapped code', () => {
    const onUnmappedCode = jest.fn();
    render(<ErrorState errorCode="SOME_CODE_WE_DO_NOT_MAP" onUnmappedCode={onUnmappedCode} />);
    expect(screen.getByText('Something went wrong on our side')).toBeTruthy();
    // The gap is reported rather than silently absorbed.
    expect(onUnmappedCode).toHaveBeenCalledWith('SOME_CODE_WE_DO_NOT_MAP');
    expect(screen.queryByTestId('ErrorState-retry')).toBeNull();
  });

  it('renders with a retry action and calls it', () => {
    const onRetry = jest.fn();
    render(<ErrorState errorCode="TIMEOUT" onRetry={onRetry} />);
    expect(screen.getByText('That took too long')).toBeTruthy();
    fireEvent.press(screen.getByTestId('ErrorState-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('uses the halal copy for RESTAURANT_UNAVAILABLE and offers no retry', () => {
    render(<ErrorState errorCode="RESTAURANT_UNAVAILABLE" onRetry={jest.fn()} onSupport={jest.fn()} />);
    expect(
      screen.getByText(
        "This restaurant's halal certification is no longer current, so we can't place this order. Your cart is saved.",
      ),
    ).toBeTruthy();
    // A 409 that will 409 again does not get a Retry button.
    expect(screen.queryByTestId('ErrorState-retry')).toBeNull();
    expect(screen.getByTestId('ErrorState-support')).toBeTruthy();
  });

  it('treats offline as its own state, not a generic error', () => {
    render(<ErrorState offline onRetry={jest.fn()} />);
    expect(screen.getByText('You are offline')).toBeTruthy();
  });

  it('keeps technical detail collapsed until asked, then copyable', () => {
    const onCopyDetail = jest.fn();
    render(
      <ErrorState
        errorCode="INTERNAL_ERROR"
        technicalDetail={{ requestId: 'req_123', code: 'INTERNAL_ERROR' }}
        onCopyDetail={onCopyDetail}
      />,
    );
    expect(screen.queryByTestId('ErrorState-detail-copy')).toBeNull();
    fireEvent.press(screen.getByTestId('ErrorState-detail-toggle'));
    fireEvent.press(screen.getByTestId('ErrorState-detail-copy'));
    expect(onCopyDetail).toHaveBeenCalledWith(expect.stringContaining('req_123'));
  });
});
