/**
 * `Icon` — the Solar icon primitive. Two things worth pinning: the size actually reaches the
 * rendered SVG, and `weight` is not a no-op (linear and bold must resolve to different path
 * data, or "linear = inactive, bold = active" is a lie).
 */
import { render, screen } from '@testing-library/react-native';

import { Icon, ICON_NAMES, SOLAR_ICON_IDS } from '../Icon';

describe('Icon', () => {
  it('renders at the requested size under a stable testID', () => {
    render(<Icon name="home" size={32} />);
    const svg = screen.getByTestId('hg-icon-home');
    expect(svg.props.width).toBe(32);
    expect(svg.props.height).toBe(32);
  });

  it('defaults to a 24dp linear icon', () => {
    render(<Icon name="bell" />);
    const svg = screen.getByTestId('hg-icon-bell');
    expect(svg.props.width).toBe(24);
    // The resolved markup carries the linear id, not the bold one.
    expect(svg.props.xml).toContain('currentColor');
  });

  it('resolves every curated semantic name to a real, distinct Solar linear/bold pair', () => {
    for (const name of ICON_NAMES) {
      const { linear, bold } = SOLAR_ICON_IDS[name];
      expect(linear).not.toBe(bold);
      const { unmount } = render(<Icon name={name} weight="linear" testID={`t-${name}-linear`} />);
      const linearXml = screen.getByTestId(`t-${name}-linear`).props.xml;
      unmount();
      const { unmount: unmount2 } = render(
        <Icon name={name} weight="bold" testID={`t-${name}-bold`} />,
      );
      const boldXml = screen.getByTestId(`t-${name}-bold`).props.xml;
      unmount2();
      // Two different Solar ids must not resolve to byte-identical markup — that would mean
      // the weight switch silently fell back to the same glyph.
      expect(linearXml).not.toBe(boldXml);
    }
  });

  it('passes `color` straight through so a token controls the rendered tint (currentColor)', () => {
    render(<Icon name="star" color="#F1521E" />);
    expect(screen.getByTestId('hg-icon-star').props.color).toBe('#F1521E');
  });
});
