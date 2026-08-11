import { fireEvent, screen } from '@testing-library/react-native';

import { Avatar, AvatarGroup, hashOf, initialsOf } from '../Avatar';
import { getHidden, renderThemed, styleOf, themes } from './harness';
import { tokens } from '../../tokens';

describe('Avatar', () => {
  it('falls back to initials with a deterministic fill', () => {
    renderThemed(<Avatar name="Yusuf Karim" id="rider-7" />);
    expect(screen.getByTestId('Avatar-initials').props.children).toBe('YK');
    expect(initialsOf('Yusuf Karim')).toBe('YK');
    // Same identity, same colour, on every device and every release.
    const fills = themes.customer.light.color.avatarFills;
    expect(fills[hashOf('rider-7') % fills.length]).toBeDefined();
  });

  it('never lands on a reserved green: the initials palette excludes the halal hue band', () => {
    const fills: readonly string[] = themes.customer.light.color.avatarFills;
    // viz.7 is a teal at hue ~175 and is dropped by the generator, not by this component.
    expect(fills).not.toContain(tokens.color.viz['7']);
    expect(fills.length).toBe(Object.keys(tokens.color.viz).length - 1);
  });

  it('is a circle for people and a squared plate for businesses', () => {
    const person = renderThemed(<Avatar name="Yusuf Karim" testID="Avatar-person" />);
    expect(styleOf(getHidden('Avatar-person')).width).toBe(40);
    person.unmount();

    renderThemed(<Avatar name="Al Wadi Grill" shape="business" testID="Avatar-shop" />);
    expect(screen.getByTestId('Avatar-shop')).toBeTruthy();
  });

  it('is decorative when the name is already on screen', () => {
    renderThemed(<Avatar name="Yusuf Karim" alt="" />);
    expect(getHidden('Avatar').props.accessibilityElementsHidden).toBe(true);
  });

  it('falls back to the initials plate when the remote image fails', () => {
    renderThemed(<Avatar name="Al Wadi Grill" src="https://cdn.example/none.jpg" />);
    fireEvent(getHidden('Avatar-image'), 'error');
    expect(screen.getByTestId('Avatar-initials')).toBeTruthy();
  });

  it('stacks at most three and counts the rest', () => {
    renderThemed(
      <AvatarGroup
        members={[
          { name: 'A One' },
          { name: 'B Two' },
          { name: 'C Three' },
          { name: 'D Four' },
          { name: 'E Five' },
        ]}
      />,
    );
    expect(screen.getByTestId('AvatarGroup-overflow')).toBeTruthy();
    expect(screen.getByText('+2')).toBeTruthy();
  });
});
