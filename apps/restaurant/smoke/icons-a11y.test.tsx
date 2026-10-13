import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import * as icons from '../src/lib/icons';

// The app's own glyphs are decorative by default, as `@hg/ui-web`'s `Icon` is: a screen
// reader skips them, and the visible text or the control's label carries the name (#424).
// One that means something on its own takes `label` and is announced as a named image.
const glyphs = Object.entries(icons).filter(([name]) => name.startsWith('Icon')) as [
  string,
  (p: icons.IconProps) => ReactElement,
][];

afterEach(cleanup);

describe('restaurant glyphs', () => {
  it('finds every glyph', () => {
    expect(glyphs.length).toBeGreaterThan(10);
  });

  it.each(glyphs)('%s is hidden from screen readers by default', (_, Glyph) => {
    const { container } = render(<Glyph size={20} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it.each(glyphs)('%s with a label is a named image', (_, Glyph) => {
    render(<Glyph label="Store closed" />);
    const img = screen.getByRole('img', { name: 'Store closed' });
    expect(img.getAttribute('aria-hidden')).toBeNull();
  });
});
