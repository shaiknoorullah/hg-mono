/**
 * The four halal display states, and the absent one.
 *
 * These assertions come straight out of `04-accessibility.md` §9's CI-blocking list. They are
 * few on purpose: each one is a rule the product would be wrong without.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { HalalBadge } from '../HalalBadge';
import { setHalalClientErrorReporter } from '../internal/client-error';

afterEach(() => {
  cleanup();
  setHalalClientErrorReporter(null);
});

describe('HalalBadge — the four display states', () => {
  it('CERTIFIED renders the fixed label on a card', () => {
    render(<HalalBadge state="CERTIFIED" />);
    const badge = screen.getByTestId('HalalBadge');

    // C-12 AC2 asserts this exact string across all six card surfaces, which is why it is not
    // parameterised.
    expect(badge).toHaveAttribute('aria-label', 'Halal certified');
    expect(badge).toHaveTextContent('Halal certified');
    expect(badge.getAttribute('role')).toBe('img');
    // The shape channel: a solid shield (04-accessibility.md §3.2).
    expect(screen.getByTestId('HalalShield')).toHaveAttribute('data-variant', 'solid');
  });

  it('EXPIRING_SOON renders identically to CERTIFIED — the distinction lives only in the panel', () => {
    const { container: certified } = render(<HalalBadge state="CERTIFIED" />);
    const certifiedHtml = certified.innerHTML;
    cleanup();

    const { container: expiring } = render(<HalalBadge state="EXPIRING_SOON" />);

    // Byte-identical. Downgrading the badge would tell the customer the halal status is in
    // doubt, which is false: the certificate is valid today.
    expect(expiring.innerHTML).toBe(certifiedHtml);
  });

  it('EXPIRED is slate with a hollow shield, never red, and says it cannot take orders', () => {
    render(<HalalBadge state="EXPIRED" surface="operational" />);
    const badge = screen.getByTestId('HalalBadge');

    expect(badge).toHaveAttribute(
      'aria-label',
      'Halal certification expired. This restaurant cannot take orders.',
    );
    expect(badge).toHaveTextContent('Certification expired');
    // The shape channel again: outline, not solid.
    expect(screen.getByTestId('HalalShield')).toHaveAttribute('data-variant', 'outline');

    // RULE H-3. A red halal state reads as a religious ruling the platform does not make, so no
    // danger token may appear anywhere in the render.
    expect(badge.className).not.toMatch(/danger/);
    expect(badge.outerHTML).not.toMatch(/danger/);
  });

  it('UNVERIFIED renders nothing on customer surfaces and dashed on operational ones', () => {
    const { container: card } = render(<HalalBadge state="UNVERIFIED" surface="card" />);
    expect(card).toBeEmptyDOMElement();
    cleanup();

    const { container: detail } = render(<HalalBadge state="UNVERIFIED" surface="detail" />);
    expect(detail).toBeEmptyDOMElement();
    cleanup();

    render(<HalalBadge state="UNVERIFIED" surface="operational" />);
    expect(screen.getByTestId('HalalBadge')).toHaveAttribute(
      'aria-label',
      'Halal certification not verified.',
    );
    expect(screen.getByTestId('HalalShield')).toHaveAttribute('data-variant', 'dashed');
  });

  it('a missing state renders nothing AND reports a client error — there is no "assume certified"', () => {
    const reporter = vi.fn();
    setHalalClientErrorReporter(reporter);

    const { container } = render(<HalalBadge state={undefined} restaurantId="r-1" />);

    expect(container).toBeEmptyDOMElement();
    expect(reporter).toHaveBeenCalledWith(
      'HALAL_DISPLAY_STATE_MISSING',
      expect.objectContaining({ restaurantId: 'r-1' }),
    );
  });

  it('an unrecognised enum value degrades to the same branch rather than crashing', () => {
    const reporter = vi.fn();
    setHalalClientErrorReporter(reporter);

    // A future server value the client has never heard of (§0 rule 10).
    const { container } = render(
      <HalalBadge state={'PROVISIONALLY_CERTIFIED' as never} restaurantId="r-2" />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(reporter).toHaveBeenCalledWith(
      'HALAL_DISPLAY_STATE_MISSING',
      expect.objectContaining({ restaurantId: 'r-2', received: 'PROVISIONALLY_CERTIFIED' }),
    );
  });

  it('names the certifying body first on the detail surface', () => {
    render(
      <HalalBadge
        state="CERTIFIED"
        surface="detail"
        size="lg"
        certifyingBodyName="Halal Monitoring Authority"
        expiresOn="2027-03-14"
        onPress={() => {}}
      />,
    );

    // The customer applies their own standard, so "who" must arrive without opening a panel,
    // and the date is absolute (`04-accessibility.md` §3.3).
    expect(screen.getByTestId('HalalBadge')).toHaveAttribute(
      'aria-label',
      'Halal certified by Halal Monitoring Authority. Valid until 14 March 2027. Double tap for certificate details.',
    );
  });
});
