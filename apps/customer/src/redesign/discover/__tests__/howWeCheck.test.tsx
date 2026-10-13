/**
 * D8 How we check (AC/Legal "verify"): static, approved wording; the AppBar keeps the short
 * title and the full name is the page's one h1.
 */
import * as React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';

import { navSpy, renderRedesign } from '../../test/render';
import { HOW_WE_CHECK_TITLE, HowWeCheckScreen, SEVEN_CHECKS } from '../HowWeCheckScreen';

describe('How we check (D8)', () => {
  it('shows the approved wording, the seven checks and one h1', () => {
    const nav = navSpy({ name: 'howWeCheck' });
    renderRedesign(<HowWeCheckScreen />, { nav });
    expect(screen.getByText('How we check')).toBeTruthy();
    const headers = screen.getAllByRole('header');
    expect(headers[0]!.props.children).toBe(HOW_WE_CHECK_TITLE);
    expect(headers.map((h) => h.props.children)).toEqual([HOW_WE_CHECK_TITLE, 'What we check', "What we don't do"]);
    expect(SEVEN_CHECKS).toHaveLength(7);
    for (const check of SEVEN_CHECKS) expect(screen.getByText(check)).toBeTruthy();
    expect(screen.getByText(/All seven must pass\./)).toBeTruthy();
    expect(screen.getByText(/We don't decide whether food is halal\./)).toBeTruthy();
    expect(screen.getByText(/its badge shows the date, like "Halal certified · expires 20 Oct"/)).toBeTruthy();
    expect(
      screen.getByText('HalalGoes does not itself certify food. Certifying bodies certify food; we check their certificates.'),
    ).toBeTruthy();
    // Never "verified halal", never a blanket claim.
    expect(screen.queryByText(/verified halal/i)).toBeNull();
    fireEvent.press(screen.getByLabelText('Back to Home'));
    expect(nav.log).toContainEqual({ action: 'back' });
  });

  it('renders in dark', () => {
    renderRedesign(<HowWeCheckScreen />, { nav: navSpy({ name: 'howWeCheck' }), scheme: 'dark' });
    expect(screen.getByText(HOW_WE_CHECK_TITLE)).toBeTruthy();
  });
});
