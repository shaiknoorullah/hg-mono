/**
 * `Icon` — the Solar icon primitive, `@iconify/react/offline` build.
 *
 * The thing worth pinning is that it renders REAL svg markup with zero network access — jsdom
 * in this test environment has no `fetch`, so if the component ever fell through to the
 * default (online) `@iconify/react` export's API-fetch path, these renders would come back
 * empty instead of failing loudly. Asserting a real `<path>`/`<g>` landed in the DOM is the
 * proof the offline registration in `Icon.tsx` actually resolved the icon locally.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { Icon, ICON_NAMES, SOLAR_ICON_IDS } from '../Icon.js';

describe('Icon', () => {
  it('renders a real inline svg, decorative by default', () => {
    render(<Icon name="home" size={32} />);
    const el = document.querySelector('svg[data-hg-icon="home"]');
    expect(el).toBeTruthy();
    expect(el?.getAttribute('width')).toBe('32');
    expect(el?.getAttribute('height')).toBe('32');
    expect(el?.getAttribute('aria-hidden')).toBe('true');
    // Real path data resolved locally — not an empty shell waiting on a network fetch.
    expect(el?.innerHTML.length).toBeGreaterThan(0);
  });

  it('gives the icon an accessible name only when asked, and drops aria-hidden then', () => {
    render(<Icon name="bell" accessibilityLabel="3 unread notifications" />);
    const el = document.querySelector('svg[data-hg-icon="bell"]');
    expect(el?.getAttribute('role')).toBe('img');
    expect(el?.getAttribute('aria-label')).toBe('3 unread notifications');
    expect(el?.hasAttribute('aria-hidden')).toBe(false);
  });

  it('resolves every curated name to a real, distinct linear/bold pair', () => {
    for (const name of ICON_NAMES) {
      const { linear, bold } = SOLAR_ICON_IDS[name];
      expect(linear).not.toBe(bold);

      const linearRender = render(<Icon name={name} weight="linear" />);
      const linearHtml = document.querySelector(`svg[data-hg-icon="${name}"]`)?.innerHTML;
      linearRender.unmount();

      const boldRender = render(<Icon name={name} weight="bold" />);
      const boldHtml = document.querySelector(`svg[data-hg-icon="${name}"]`)?.innerHTML;
      boldRender.unmount();

      expect(linearHtml).toBeTruthy();
      expect(boldHtml).toBeTruthy();
      expect(linearHtml).not.toBe(boldHtml);
    }
  });

  it('reads currentColor from the ambient CSS colour, never a hardcoded fill', () => {
    render(<Icon name="star" className="text-action-primary-bg" />);
    const el = document.querySelector('svg[data-hg-icon="star"]');
    expect(el?.innerHTML).toContain('currentColor');
    expect(el?.getAttribute('class')).toContain('text-action-primary-bg');
  });
});
