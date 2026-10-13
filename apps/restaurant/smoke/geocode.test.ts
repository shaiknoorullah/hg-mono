import { describe, expect, it } from 'vitest';
import { featureToResult } from '../src/lib/geocode';

// Recorded (trimmed) Mapbox Geocoding v6 forward response for "100 queen st w toronto".
const SAMPLE = {
  type: 'FeatureCollection',
  features: [
    {
      id: 'dXJuOm1ieGFkcjo0ZjJm',
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-79.384293, 43.652443] },
      properties: {
        mapbox_id: 'dXJuOm1ieGFkcjo0ZjJm',
        feature_type: 'address',
        name: '100 Queen Street West',
        coordinates: { longitude: -79.384293, latitude: 43.652443 },
        place_formatted: 'Toronto, Ontario M5H 2N2, Canada',
        full_address: '100 Queen Street West, Toronto, Ontario M5H 2N2, Canada',
        context: {
          address: { name: '100 Queen Street West', address_number: '100', street_name: 'Queen Street West' },
          postcode: { name: 'M5H 2N2' },
          place: { name: 'Toronto' },
          region: { name: 'Ontario', region_code: 'ON', region_code_full: 'CA-ON' },
          country: { name: 'Canada', country_code: 'CA' },
        },
      },
    },
    { id: 'x', properties: { name: 'No point' } },
  ],
};

describe('featureToResult', () => {
  it('maps a v6 address feature to form fields and a point', () => {
    expect(featureToResult(SAMPLE.features[0])).toEqual({
      id: 'dXJuOm1ieGFkcjo0ZjJm',
      label: '100 Queen Street West, Toronto, Ontario M5H 2N2, Canada',
      line1: '100 Queen Street West',
      city: 'Toronto',
      province: 'ON',
      postalCode: 'M5H 2N2',
      latitude: 43.652443,
      longitude: -79.384293,
    });
  });

  it('drops a feature that has no coordinates', () => {
    expect(featureToResult(SAMPLE.features[1])).toBeNull();
  });
});
