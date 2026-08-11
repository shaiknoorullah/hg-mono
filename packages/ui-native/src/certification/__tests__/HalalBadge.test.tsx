/**
 * The halal badge is the component this product exists for. These tests assert the handful
 * of things that would be catastrophic to get wrong, and nothing else.
 */
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '../../tokens';
import { HalalBadge, resolveSeal } from '../HalalBadge';
import { ACCESSIBLE_LABEL, VISIBLE_LABEL } from '../internal/labels';
import { resetClientErrorReporter, setClientErrorReporter } from '../internal/reportClientError';

function renderThemed(ui: ReactElement) {
  return render(<ThemeProvider theme="customer" scheme="light">{ui}</ThemeProvider>);
}

afterEach(() => {
  resetClientErrorReporter();
});

describe('HalalBadge — the four states', () => {
  it('resolves CERTIFIED to a filled bottle-green seal, a brass ring and a solid shield', () => {
    const seal = resolveSeal('CERTIFIED', 'light');
    expect(seal.fill).toBe('#04482A');
    expect(seal.ring).toBe('#D4A72C');
    expect(seal.shield).toBe('solid');

    renderThemed(<HalalBadge state="CERTIFIED" restaurantId="r1" />);
    // C-12 R7 fixes the visible copy. Not "Halal", not "100% Halal", not "Verified halal".
    expect(screen.getByText(VISIBLE_LABEL.CERTIFIED)).toBeTruthy();
    expect(screen.getByTestId('HalalBadge').props.accessibilityLabel).toBe('Halal certified');
  });

  it('renders EXPIRING_SOON byte-identically to CERTIFIED', () => {
    // C-12: the certificate is valid today. Downgrading the card badge would tell the
    // customer the restaurant's halal status is in doubt, which is false. The renewal
    // signal lives only in HalalCertificationPanel.
    expect(resolveSeal('EXPIRING_SOON', 'light')).toEqual(resolveSeal('CERTIFIED', 'light'));
    expect(resolveSeal('EXPIRING_SOON', 'dark')).toEqual(resolveSeal('CERTIFIED', 'dark'));

    const certified = renderThemed(<HalalBadge state="CERTIFIED" restaurantId="r1" />).toJSON();
    const expiring = renderThemed(<HalalBadge state="EXPIRING_SOON" restaurantId="r1" />).toJSON();
    expect(expiring).toEqual(certified);
  });

  it('resolves EXPIRED to cool slate with a hollow shield and no ring', () => {
    const seal = resolveSeal('EXPIRED', 'light');
    // Cool slate, not the warm neutral ramp: it reads as a certification state rather than
    // as disabled chrome. "The platform's knowledge has lapsed", not "this is not halal".
    expect(seal.fill).toBe('#4E5862');
    expect(seal.ring).toBeNull();
    expect(seal.shield).toBe('outline');
    expect(ACCESSIBLE_LABEL.EXPIRED).toBe(
      'Halal certification expired. This restaurant cannot take orders.',
    );
  });

  it('never uses the danger ramp in any state, in either scheme (RULE H-3)', () => {
    // A red halal state reads as a religious ruling the platform does not make.
    const DANGER = ['#FDECEA', '#912018', '#D92D20', '#B42318', '#F08C82'];
    for (const scheme of ['light', 'dark'] as const) {
      for (const state of ['CERTIFIED', 'EXPIRING_SOON', 'EXPIRED', 'UNVERIFIED'] as const) {
        const seal = resolveSeal(state, scheme);
        for (const value of [seal.fill, seal.label, seal.ring, seal.borderColor]) {
          if (value) expect(DANGER).not.toContain(value.toUpperCase());
        }
      }
    }
  });

  it('renders null for UNVERIFIED on customer surfaces and draws it only on operational ones', () => {
    // C-12 R1: an uncertified kitchen is invisible to customers, so a customer never learns
    // that non-certified listings exist on the platform at all.
    expect(renderThemed(<HalalBadge state="UNVERIFIED" surface="card" />).toJSON()).toBeNull();
    expect(renderThemed(<HalalBadge state="UNVERIFIED" surface="detail" />).toJSON()).toBeNull();

    renderThemed(<HalalBadge state="UNVERIFIED" surface="operational" />);
    expect(screen.getByTestId('HalalBadge').props.accessibilityLabel).toBe(
      'Halal certification not verified.',
    );
  });
});

describe('HalalBadge — the absent state', () => {
  it('renders nothing and reports when halal_display_state is missing', () => {
    // C-12 R4/AC5. There is no default, no optimistic value and no "assume certified" —
    // that is the single worst failure mode this product has.
    const reporter = jest.fn();
    setClientErrorReporter(reporter);

    const tree = renderThemed(<HalalBadge state={undefined} restaurantId="rest-42" />).toJSON();

    expect(tree).toBeNull();
    expect(reporter).toHaveBeenCalledWith(
      'HALAL_DISPLAY_STATE_MISSING',
      expect.objectContaining({ restaurantId: 'rest-42' }),
    );
  });

  it('renders nothing and reports an unknown enum value rather than crashing', () => {
    // A server that grows a fifth state must not take the app down with it.
    const reporter = jest.fn();
    setClientErrorReporter(reporter);

    const tree = renderThemed(
      <HalalBadge state={'PROVISIONAL' as never} restaurantId="rest-43" />,
    ).toJSON();

    expect(tree).toBeNull();
    expect(reporter).toHaveBeenCalledWith(
      'HALAL_DISPLAY_STATE_UNKNOWN',
      expect.objectContaining({ restaurantId: 'rest-43', received: 'PROVISIONAL' }),
    );
  });
});

describe('HalalBadge — spoken labels', () => {
  it('gives every drawn state a meaningful sentence, never "image"', () => {
    for (const state of ['CERTIFIED', 'EXPIRING_SOON', 'EXPIRED', 'UNVERIFIED'] as const) {
      expect(ACCESSIBLE_LABEL[state].toLowerCase()).toContain('halal');
    }
    // C-12 AC2 asserts this exact string across all six card surfaces, which is why it is
    // a constant rather than something a caller can template.
    expect(ACCESSIBLE_LABEL.CERTIFIED).toBe('Halal certified');
    expect(ACCESSIBLE_LABEL.EXPIRING_SOON).toBe('Halal certified');
  });

  it('names the certifying body first on the detail surface', () => {
    // 04-accessibility.md §3.3: the customer applies their own standard, so a screen-reader
    // user must be told *who* certified it without opening the panel.
    renderThemed(
      <HalalBadge
        state="CERTIFIED"
        surface="detail"
        size="lg"
        certifyingBodyName="Halal Monitoring Authority"
        expiresOn="2027-03-14"
        onPress={() => {}}
      />,
    );
    expect(screen.getByTestId('HalalBadge').props.accessibilityLabel).toBe(
      'Halal certified by Halal Monitoring Authority. Valid until 14 March 2027. Double tap for certificate details.',
    );
  });
});
