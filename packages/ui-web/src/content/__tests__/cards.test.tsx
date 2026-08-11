/**
 * The two card invariants that are not stylistic.
 *
 * 1. `RestaurantCard`'s accessible name says the halal state **second**, immediately after the
 *    name — before rating, before distance (`04-accessibility.md` §3.4). A screen-reader user
 *    hears the certification in the first two seconds of every card, matching what a sighted
 *    user sees at the top of every card.
 * 2. `OrderCard variant="rider"` shows no price, ever (D-19). The wire type makes it impossible;
 *    this asserts the render agrees.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Schema } from '@hg/api-client';
import { RestaurantCard } from '../RestaurantCard';
import { OrderCard } from '../OrderCard';
import { HalalCertificationPanel } from '../../certification/HalalCertificationPanel';

afterEach(cleanup);

const restaurant: Schema['RestaurantCard'] = {
  id: 'rest-1',
  name: 'Al Noor Kitchen',
  cuisines: ['Pakistani', 'Indian'],
  halal: { display_state: 'CERTIFIED', certifying_body_name: 'HMA', expires_on: '2027-03-14' },
  rating_avg: 4.6,
  rating_count: 312,
  price_band: '$$',
  availability: {
    state: 'OPEN',
    distance_m: 1200,
    eta_min_minutes: 25,
    eta_max_minutes: 35,
  },
};

describe('RestaurantCard', () => {
  it('puts the halal state second in the accessible name, before rating and distance', () => {
    render(<RestaurantCard restaurant={restaurant} onPress={() => {}} />);

    const name = screen.getByTestId('RestaurantCard').getAttribute('aria-label') ?? '';

    expect(name).toBe(
      'Al Noor Kitchen. Halal certified. Pakistani, Indian. 4.6 stars, 312 reviews. 1.2 kilometres. 25–35 minutes.',
    );
    expect(name.indexOf('Halal certified')).toBeLessThan(name.indexOf('4.6 stars'));
    expect(name.indexOf('Halal certified')).toBeLessThan(name.indexOf('kilometres'));
  });

  it('reserves the seal slot in the loading skeleton so the card does not reflow', () => {
    render(<RestaurantCard restaurant={restaurant} loading />);
    expect(screen.getByTestId('RestaurantCard-skeleton')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders a closed-hours scrim but keeps the card pressable — browsing a closed menu is legitimate', () => {
    render(
      <RestaurantCard
        restaurant={{
          ...restaurant,
          availability: { ...restaurant.availability, state: 'CLOSED_HOURS' },
        }}
        onPress={() => {}}
      />,
    );
    expect(screen.getByTestId('RestaurantCard-overlay')).toHaveTextContent('Closed');
    expect(screen.getByTestId('RestaurantCard').tagName).toBe('BUTTON');
  });
});

describe('OrderCard', () => {
  it('shows a rider the earnings and no basket value', () => {
    const assignment: Schema['Assignment'] = {
      id: 'asn-1',
      order_id: 'ord-1',
      assigned_at: '2026-08-11T12:00:00Z',
      state: 'EN_ROUTE_TO_PICKUP',
      required_pod_method: 'PHOTO',
      pickup: {
        address: '1 Danforth Ave',
        latitude: 43.6,
        longitude: -79.3,
        order_state: 'PREPARING',
        restaurant_name: 'Al Noor Kitchen',
      },
      dropoff: {
        address: '55 Bloor St W',
        customer_display_name: 'Aisha K.',
        latitude: 43.67,
        longitude: -79.39,
      },
      items: [{ name: 'Chicken Biryani', quantity: 2 }],
      earnings: { currency: 'CAD', estimated_total_cents: 1140 },
    };

    render(<OrderCard variant="rider" order={assignment} />);

    expect(screen.getByTestId('OrderCard')).toHaveTextContent('$11.40');
    // Exactly one money value on the card, and it is the rider's own.
    expect(screen.getAllByTestId('Price')).toHaveLength(1);
  });
});

describe('HalalCertificationPanel', () => {
  const certification: Schema['CertificationPanel'] = {
    display_state: 'EXPIRING_SOON',
    certifying_body_name: 'Halal Monitoring Authority',
    certificate_number: 'HMA-2026-0041',
    issued_on: '2026-01-10',
    expires_on: '2027-03-14',
    verified_at: '2026-08-03T10:00:00Z',
    scope: 'WHOLE_ESTABLISHMENT',
    disclaimer:
      'Certification verified by Halal Goes on 3 August 2026. Halal Goes does not itself certify food.',
  };

  it('renders expiry absolutely and puts the renewal note only in the panel', () => {
    render(<HalalCertificationPanel restaurantId="rest-1" certification={certification} />);

    // Never "expires in 7 months".
    expect(screen.getByTestId('HalalCertificationPanel-expiry')).toHaveTextContent('14 March 2027');
    expect(screen.getByTestId('HalalCertificationPanel-renewal-note')).toHaveTextContent(
      'Certificate renews 14 March 2027',
    );
    // The badge itself is unchanged: still the certified render.
    expect(screen.getByTestId('HalalBadge')).toHaveAttribute('data-halal-render', 'certified');
    // The standing line is always present and never collapsible.
    expect(screen.getByTestId('HalalCertificationPanel-disclaimer')).toHaveTextContent(
      'Halal Goes does not itself certify food.',
    );
  });

  it('keeps the panel but draws no seal when certification could not be loaded', () => {
    render(<HalalCertificationPanel restaurantId="rest-1" status="error" onRetry={() => {}} />);

    expect(screen.getByTestId('HalalCertificationPanel')).toBeInTheDocument();
    // No cached or defaulted state is trusted (C-12 R4).
    expect(screen.queryByTestId('HalalBadge')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t load certification details.');
  });
});
