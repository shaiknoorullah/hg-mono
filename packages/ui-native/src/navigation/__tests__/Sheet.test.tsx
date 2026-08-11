/**
 * The rider offer sheet is the highest-stakes piece of chrome in the product: the shipped app
 * dismissed it at 7 s against a 5-minute window and riders lost jobs they meant to take (D-14).
 * `dismissible={false}` is the contract that prevents that, so it gets a test.
 */
import { render, screen, fireEvent } from '@testing-library/react-native';
import { Text } from 'react-native';

import { Sheet } from '../Sheet';
import { BottomNav } from '../BottomNav';

describe('Sheet', () => {
  it('closes on backdrop press when dismissible, and offers a visible close button', () => {
    const onClose = jest.fn();
    render(
      <Sheet open title="Filters" onClose={onClose}>
        <Text>body</Text>
      </Sheet>,
    );
    expect(screen.getByTestId('Sheet-close')).toBeTruthy();
    // The backdrop is deliberately invisible to assistive technology — the close button is the
    // escape, not a nameless full-screen target — so the query has to opt into hidden elements.
    fireEvent.press(screen.getByTestId('Sheet-backdrop', { includeHiddenElements: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('cannot be dismissed, and shows no close affordance, when non-dismissible', () => {
    const onClose = jest.fn();
    render(
      <Sheet open variant="full" elevate="offer" dismissible={false} title="New offer" onClose={onClose}>
        <Text>$11.40</Text>
      </Sheet>,
    );
    // No close button at all: an affordance that does nothing is worse than none.
    expect(screen.queryByTestId('Sheet-close')).toBeNull();
    fireEvent.press(screen.getByTestId('Sheet-backdrop', { includeHiddenElements: true }));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('BottomNav', () => {
  const items = [
    { key: 'home', label: 'Home', icon: <Text>H</Text> },
    { key: 'orders', label: 'Orders', icon: <Text>O</Text>, badge: 2, badgeNoun: 'active' },
  ];

  it('folds the badge count into the tab name rather than exposing a separate node', () => {
    render(<BottomNav items={items} active="home" onChange={jest.fn()} />);
    expect(screen.getByLabelText('Orders, 2 active')).toBeTruthy();
  });

  it('unmounts entirely when hidden, so a modal flow has no escape hatch', () => {
    render(<BottomNav items={items} active="home" onChange={jest.fn()} hidden />);
    expect(screen.queryByTestId('BottomNav')).toBeNull();
  });
});
