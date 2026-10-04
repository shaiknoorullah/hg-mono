/**
 * `Wordmark` — pins that the logo is the shared `@hg/brand` geometry, not a copy that can
 * drift, and that it names the business as one word.
 */
import { render, screen } from '@testing-library/react-native';
import { WORDMARK } from '@hg/brand';

import { Wordmark } from '../Wordmark';

describe('Wordmark', () => {
  it('renders the shared geometry at the artwork ratio, named "HalalGoes"', () => {
    render(<Wordmark height={48} />);
    const svg = screen.getByTestId('hg-wordmark');
    expect(svg.props.accessibilityLabel).toBe('HalalGoes');
    expect(svg.props.width).toBe(Math.round((48 * 556) / 186));
    expect(JSON.stringify(screen.toJSON())).toContain(WORDMARK.swash.slice(0, 40));
  });
});
