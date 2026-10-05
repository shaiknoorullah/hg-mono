/**
 * `AppBar` tone. The `cream` bar is the page's own surface with the page's ink; the default
 * `chrome` bar stays the dark forest with light ink. A cream bar that kept the chrome's light
 * title would be unreadable on the cream page, so pin both pairings.
 */
import { screen } from '@testing-library/react-native';

import { AppBar } from '../AppBar';
import { renderThemed, styleOf, themes } from '../../primitives/__tests__/harness';

const light = themes.customer.light;

describe('AppBar — tone', () => {
  it('cream: the page surface with text.primary', () => {
    renderThemed(<AppBar tone="cream" title="Account" />);
    expect(styleOf(screen.getByTestId('AppBar')).backgroundColor).toBe(light.color.surface.base);
    expect(styleOf(screen.getByText('Account')).color).toBe(light.color.text.primary);
  });

  it('chrome (default): the dark chrome with light ink', () => {
    renderThemed(<AppBar title="Discover" />);
    expect(styleOf(screen.getByTestId('AppBar')).backgroundColor).toBe(light.color.surface.chrome);
    expect(styleOf(screen.getByText('Discover')).color).toBe(light.color.text.onInverse);
  });
});
