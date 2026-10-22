/**
 * `LiveMap`'s two promises that a picture cannot show:
 *
 * - A position that stops arriving stays exactly where it was. Time passing, and the age ticking
 *   in the words, never moves the pin (the map does not guess where a rider has got to).
 * - The tile-free map needs no token and asks for none: it is what mock mode and the design
 *   captures draw, so a capture never depends on Mapbox being reachable.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { loadFakeMapbox } from '../__fixtures__/fake-mapbox';
import { LiveMap } from '../index';

const NOW = Date.parse('2026-10-10T22:52:48Z');
const PLACE = { id: 'r', kind: 'restaurant' as const, label: 'Zaytoun Grill', latitude: 43.73, longitude: -79.26 };
const places = [PLACE];
const RIDER_AT = { latitude: 43.731, longitude: -79.262 };
const rider = (agoSeconds: number) => [
  {
    id: 'rider',
    label: 'Ahmed K.',
    fix: { ...RIDER_AT, headingDeg: null, accuracyM: null, recordedAt: new Date(NOW - agoSeconds * 1000).toISOString(), coarse: false },
  },
];

type Spied = { prototype: { setLngLat: (p: [number, number]) => unknown } };

const seatedAt = (p: [number, number], at: { longitude: number; latitude: number }) =>
  p[0] === at.longitude && p[1] === at.latitude;

describe('LiveMap: a stale position freezes', () => {
  it('does not move the pin when the clock moves on and no newer fix arrived', async () => {
    const gl = await loadFakeMapbox();
    const setLngLat = vi.spyOn((gl.default.Marker as unknown as Spied).prototype, 'setLngLat');
    const props = { accessToken: 'pk.test', loadMapbox: () => Promise.resolve(gl), places, riders: rider(240), ariaLabel: 'Map' };
    const { rerender } = render(<LiveMap {...props} now={() => NOW} />);
    await screen.findByRole('group', { name: 'Map controls' });
    expect(screen.getAllByText('Stale').length).toBeGreaterThan(0);

    setLngLat.mockClear();
    rerender(<LiveMap {...props} now={() => NOW + 600_000} />);
    // Seats, not writes. A marker re-created on a later render is seated at its own position
    // again, and a re-seat where the pin already is moves nothing — counting those made this
    // assertion depend on how many times React committed, which is why it failed under CI's
    // scheduling and passed here (#1067). What would break the promise is a seat anywhere the
    // rider has not been seen, so that is what is forbidden.
    const movedElsewhere = setLngLat.mock.calls
      .map(([p]) => p)
      .filter((p) => !seatedAt(p, RIDER_AT) && !seatedAt(p, PLACE));
    expect(movedElsewhere).toEqual([]);
    setLngLat.mockRestore();
  });
});

describe('LiveMap: the tile-free map', () => {
  it('opens without a token, sets none on the engine, and the map region is hidden from assistive technology', async () => {
    const gl = await loadFakeMapbox();
    gl.default.accessToken = '';
    const loadMapbox = vi.fn(() => Promise.resolve(gl));
    render(<LiveMap accessToken={undefined} flatStyle loadMapbox={loadMapbox} places={places} riders={rider(8)} ariaLabel="Map of order HG-6RN4KP" textEquivalentId="words" />);
    await screen.findByRole('group', { name: 'Map controls' });
    expect(loadMapbox).toHaveBeenCalledTimes(1);
    expect(gl.default.accessToken).toBe('');
    const region = screen.getByRole('region', { name: 'Map of order HG-6RN4KP' });
    expect(region).toHaveAttribute('aria-describedby', 'words');
    expect(region.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
