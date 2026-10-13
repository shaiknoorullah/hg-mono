/**
 * The map's numbers and words: the Directions request and parse, the straight-line fallback, the
 * "last updated" label, and the distance-and-ETA lines a build without a map shows on their own.
 */
import {
  directionsUrl,
  estimateRoute,
  parseDirections,
  staleLabel,
} from '../geo';
import { summaryLines } from '../DeliveryMap';

const A = { latitude: 43.65, longitude: -79.38 };
const B = { latitude: 43.66, longitude: -79.39 };

describe('Directions', () => {
  it('asks for lng,lat pairs with GeoJSON geometry and the public token', () => {
    const url = directionsUrl([A, B], 'pk.abc');
    expect(url).toBe(
      'https://api.mapbox.com/directions/v5/mapbox/driving/-79.380000,43.650000;-79.390000,43.660000' +
        '?geometries=geojson&overview=full&access_token=pk.abc',
    );
  });

  it('parses the first route with its legs, flipping [lng, lat] back', () => {
    const r = parseDirections({
      routes: [
        {
          distance: 1500,
          duration: 300,
          geometry: { coordinates: [[-79.38, 43.65], [-79.39, 43.66]] },
          legs: [{ distance: 1500, duration: 300 }],
        },
      ],
    });
    expect(r).toEqual({
      coordinates: [A, B],
      distance_m: 1500,
      duration_s: 300,
      legs: [{ distance_m: 1500, duration_s: 300 }],
    });
  });

  it('returns null, never a half route, for an empty or malformed response', () => {
    expect(parseDirections({ routes: [] })).toBeNull();
    expect(parseDirections({ code: 'NoRoute' })).toBeNull();
    expect(parseDirections(null)).toBeNull();
    expect(
      parseDirections({ routes: [{ distance: 1, duration: 1, geometry: { coordinates: [[0, 'x'], [1, 1]] } }] }),
    ).toBeNull();
  });
});

describe('straight-line fallback', () => {
  it('is the great-circle distance × 1.35, one leg per pair of stops', () => {
    const r = estimateRoute([A, B, A]);
    expect(r.legs).toHaveLength(2);
    expect(r.legs[0]!.distance_m).toBeCloseTo(1374.5 * 1.35, -1);
    expect(r.distance_m).toBeCloseTo(r.legs[0]!.distance_m * 2, 5);
  });
});

describe('staleLabel', () => {
  const now = Date.parse('2026-10-06T12:00:00Z');
  it('is silent for a fix up to 30 s old', () => {
    expect(staleLabel('2026-10-06T11:59:30Z', now)).toBeNull();
    expect(staleLabel(null, now)).toBeNull();
  });
  it('says how old the fix is after 30 s', () => {
    expect(staleLabel('2026-10-06T11:59:18Z', now)).toBe('Last updated 42s ago');
    expect(staleLabel('2026-10-06T11:55:00Z', now)).toBe('Last updated 5 min ago');
  });
});

describe('summaryLines', () => {
  const legs = [
    { distance_m: 1400, duration_s: 300 },
    { distance_m: 4200, duration_s: 720 },
  ];
  it('previews both legs of an offer from the rider’s position', () => {
    expect(summaryLines('preview', true, legs, 'Karachi Grill', 'Annex')).toEqual([
      'To Karachi Grill: 1.4 km · about 5 min',
      'Karachi Grill to Annex: 4.2 km · about 12 min',
    ]);
  });
  it('shows just the trip when the rider’s position is not known yet', () => {
    expect(summaryLines('preview', false, [legs[1]!], 'Karachi Grill', 'Annex')).toEqual([
      'Karachi Grill to Annex: 4.2 km · about 12 min',
    ]);
  });
  it('names the current stop during a delivery', () => {
    expect(summaryLines('dropoff', true, [legs[0]!], 'Karachi Grill', 'Aisha')).toEqual([
      'To Aisha: 1.4 km · about 5 min',
    ]);
  });
});
