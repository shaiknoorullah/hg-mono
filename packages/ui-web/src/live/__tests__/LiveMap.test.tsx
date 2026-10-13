import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveMap, interpolate, metresToPixels } from '../LiveMap.js';
import { lastUpdatedLabel, newerFix, type RiderFix } from '../riderFix.js';

const fix = (recordedAt: string, latitude = 43.65): RiderFix => ({
  latitude,
  longitude: -79.38,
  headingDeg: null,
  accuracyM: null,
  recordedAt,
  coarse: false,
});

describe('LiveMap', () => {
  it('without a token renders the empty state and the caller facts, and never loads the engine', () => {
    const loadMapbox = vi.fn();
    render(
      <LiveMap
        accessToken=""
        loadMapbox={loadMapbox}
        places={[{ id: 'r', kind: 'restaurant', label: 'Restaurant', latitude: 43.6, longitude: -79.4 }]}
        riders={[]}
        ariaLabel="Map"
      >
        <span>Rider arriving 12:40</span>
      </LiveMap>,
    );
    expect(screen.getByText('Live map not configured')).toBeTruthy();
    expect(screen.getByText('Rider arriving 12:40')).toBeTruthy();
    expect(loadMapbox).not.toHaveBeenCalled();
  });

  it('renders the error state with retry when the map engine fails to load', async () => {
    const loadMapbox = vi.fn().mockRejectedValue(new Error('offline'));
    render(
      <LiveMap
        accessToken="pk.test"
        loadMapbox={loadMapbox}
        places={[{ id: 'r', kind: 'restaurant', label: 'Restaurant', latitude: 43.6, longitude: -79.4 }]}
        riders={[]}
        ariaLabel="Map"
      />,
    );
    expect(await screen.findByText('The map could not load')).toBeTruthy();
  });
});

describe('rider fixes', () => {
  it('never moves a rider backwards to an older, replayed fix', () => {
    const now = fix('2026-10-05T12:00:10Z', 43.66);
    const replayed = fix('2026-10-05T12:00:05Z', 43.64);
    expect(newerFix(now, replayed)).toBe(now);
    expect(newerFix(replayed, now)).toBe(now);
  });

  it('labels a fix by its age and glides between positions', () => {
    expect(lastUpdatedLabel(fix('2026-10-05T12:00:00Z'), Date.parse('2026-10-05T12:00:42Z'))).toBe('Last updated 42s ago');
    expect(interpolate([0, 0], [10, 20], 0)).toEqual([0, 0]);
    expect(interpolate([0, 0], [10, 20], 1)).toEqual([10, 20]);
    // ~100 m is a few pixels zoomed out and fills the view zoomed in.
    expect(metresToPixels(100, 43.65, 10)).toBeLessThan(10);
    expect(metresToPixels(100, 43.65, 17)).toBeGreaterThan(100);
  });
});
