import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import * as ds from '../index';
import * as proposed from '../../proposed/index';

describe('@hg/ui-web/ds', () => {
  it('exports the live design-system components the apps build on first', () => {
    for (const name of [
      'AppBar', 'Button', 'Card', 'Checkbox', 'HalalBadge', 'HalalCertificationPanel',
      'HalalChecklist', 'HalalShield', 'Icon', 'IconButton', 'Input', 'Price', 'RadioGroup',
      'Rating', 'Select', 'StatusTimeline', 'Switch', 'SideNav', 'setClientErrorReporter',
    ]) {
      expect(ds, name).toHaveProperty(name);
    }
    for (const name of ['Banner', 'EmptyState', 'ErrorState', 'Skeleton', 'Textarea']) {
      expect(proposed, name).toHaveProperty(name);
    }
  });

  it('Input calls onChange with the event and onValueChange with the value', () => {
    const onChange = vi.fn();
    const onValueChange = vi.fn();
    render(<ds.Input label="Email" onChange={onChange} onValueChange={onValueChange} />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.ca' } });
    expect(onValueChange).toHaveBeenCalledWith('a@b.ca');
    expect(onChange.mock.calls[0]?.[0]).toHaveProperty('target');
  });

  it('IconButton folds the count and its noun into the accessible name', () => {
    render(<ds.IconButton icon="cart" accessibilityLabel="Cart" badge={3} badgeNoun="items" />);
    expect(screen.getByRole('button', { name: 'Cart, 3 items' })).toBeInTheDocument();
  });

  it('an unknown icon renders nothing and reports ICON_NAME_UNKNOWN', () => {
    const report = vi.fn();
    ds.setClientErrorReporter(report);
    const { container } = render(<ds.Icon name={'nope' as never} />);
    expect(container).toBeEmptyDOMElement();
    expect(report).toHaveBeenCalledWith('ICON_NAME_UNKNOWN', { received: 'nope' });
    ds.setClientErrorReporter(null);
  });

  it('a missing halal state renders no badge and reports it (silence is never consent)', () => {
    const report = vi.fn();
    ds.setClientErrorReporter(report);
    const { container } = render(<ds.HalalBadge state={null} restaurantId="r1" />);
    expect(container).toBeEmptyDOMElement();
    expect(report).toHaveBeenCalledWith('HALAL_DISPLAY_STATE_MISSING', expect.anything());
    ds.setClientErrorReporter(null);
  });

  it('StatusTimeline reads the contract timeline shape and the reconnecting state', () => {
    render(
      <ds.StatusTimeline
        audience="customer"
        state="PREPARING"
        transitions={[{ to_state: 'RESTAURANT_PENDING', at: '2026-10-10T16:00:00Z' }]}
        connection="reconnecting"
      />,
    );
    expect(screen.getByText(/reconnecting/i)).toBeInTheDocument();
  });
});
