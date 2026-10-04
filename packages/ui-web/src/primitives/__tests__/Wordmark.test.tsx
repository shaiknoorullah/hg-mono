/**
 * `Wordmark` — pins that the logo is the shared `@hg/brand` geometry (not a copy that can
 * drift), paints only theme roles, and names the business as one word.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WORDMARK } from '@hg/brand';

import { Wordmark } from '../Wordmark.js';

describe('Wordmark', () => {
  it('draws the shared brand geometry, named "HalalGoes"', () => {
    render(<Wordmark height={40} />);
    const svg = screen.getByRole('img', { name: 'HalalGoes' });
    const paths = [...svg.querySelectorAll('path')].map((p) => p.getAttribute('d'));
    expect(paths).toEqual([WORDMARK.silhouette, WORDMARK.swash]);
    expect(svg.getAttribute('width')).toBe(String(Math.round((40 * 556) / 186)));
  });

  it('paints theme roles only, and gives each instance its own gradient', () => {
    const { container } = render(
      <>
        <Wordmark />
        <Wordmark title="" />
      </>,
    );
    const html = container.innerHTML;
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    const ids = [...container.querySelectorAll('linearGradient')].map((g) => g.id);
    expect(new Set(ids).size).toBe(2);
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBe(1);
  });
});
