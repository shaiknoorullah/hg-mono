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
const places = [{ id: 'r', kind: 'restaurant' as const, label: 'Zaytoun Grill', latitude: 43.73, longitude: -79.26 }];
const RIDER_AT = { latitude: 43.731, longitude: -79.262 };
const rider = (agoSeconds: number) => [
  {
    id: 'rider',
    label: 'Ahmed K.',
    fix: { ...RIDER_AT, headingDeg: null, accuracyM: null, recordedAt: new Date(NOW - agoSeconds * 1000).toISOString(), coarse: false },
  },
];

type Spied = { prototype: { setLngLat: (p: [number, number]) => unknown } };

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
    const riderMoves = setLngLat.mock.calls.filter(([p]) => p[0] === RIDER_AT.longitude && p[1] === RIDER_AT.latitude);
    expect(riderMoves).toHaveLength(0);
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
