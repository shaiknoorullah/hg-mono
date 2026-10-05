/**
 * The live map degrades to text, never to a crash. Jest has no Mapbox native module — exactly
 * like a build without the download token — so rendering the real loader must give the distance
 * and ETA text and no map. With a stand-in Mapbox module and a token, the map draws the route,
 * the pins and the rider, and the text stays (the map is never the only way to know).
 */
import * as React from 'react';
import { View } from 'react-native';
import { render, screen, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => {
  const mod = require('react-native-safe-area-context/jest/mock');
  return mod.default ?? mod;
});

const { DeliveryMap } = require('../DeliveryMap') as typeof import('../DeliveryMap');
const { loadMapbox } = require('../mapbox') as typeof import('../mapbox');
const { ThemeProvider } = require('@hg/ui-native') as typeof import('@hg/ui-native');

const pickup = { latitude: 43.65, longitude: -79.38, label: 'Karachi Grill' };
const dropoff = { latitude: 43.66, longitude: -79.39, label: 'Aisha' };
const fix = {
  status: 'ok' as const,
  fix: { latitude: 43.645, longitude: -79.375, recorded_at: new Date().toISOString() },
};

// The map canvas is hidden from assistive technology by design; the text is its content.
const HIDDEN = { includeHiddenElements: true };

function wrap(node: React.ReactElement) {
  return render(
    <ThemeProvider theme="rider" scheme="light">
      {node}
    </ThemeProvider>,
  );
}

/** A stand-in for `@rnmapbox/maps`: each component renders a View tagged with its name. */
function fakeMapbox(): NonNullable<ReturnType<typeof loadMapbox>> {
  const tag = (name: string) =>
    function Fake(props: { id?: string; children?: React.ReactNode }) {
      return (
        <View testID={props.id ? `mb-${name}-${props.id}` : `mb-${name}`}>{props.children}</View>
      );
    };
  return {
    setAccessToken: jest.fn(async () => undefined),
    StyleURL: { Street: 'mapbox://styles/mapbox/streets-v12' },
    MapView: tag('MapView'),
    Camera: tag('Camera'),
    ShapeSource: tag('ShapeSource'),
    LineLayer: tag('LineLayer'),
    CircleLayer: tag('CircleLayer'),
  } as unknown as NonNullable<ReturnType<typeof loadMapbox>>;
}

describe('DeliveryMap', () => {
  it('without the native SDK: no map, the distance and ETA text instead, and Navigate still works', () => {
    expect(loadMapbox()).toBeNull();
    wrap(<DeliveryMap leg="pickup" pickup={pickup} dropoff={dropoff} rider={fix} navigable />);
    expect(screen.queryByTestId('delivery-map-canvas', HIDDEN)).toBeNull();
    expect(screen.getByText(/^To Karachi Grill: .* · about \d+ min$/)).toBeTruthy();
    expect(screen.getByText('Route unavailable: straight-line estimate')).toBeTruthy();
    expect(screen.getByText('Navigate to restaurant')).toBeTruthy();
  });

  it('with the SDK and a token: draws pins, route and rider, and keeps the text', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          routes: [
            {
              distance: 2100,
              duration: 420,
              geometry: { coordinates: [[-79.375, 43.645], [-79.38, 43.65], [-79.39, 43.66]] },
              legs: [{ distance: 2100, duration: 420 }],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    try {
      wrap(
        <DeliveryMap
          leg="dropoff"
          pickup={pickup}
          dropoff={dropoff}
          rider={fix}
          mapbox={fakeMapbox()}
          token="pk.test"
        />,
      );
      expect(screen.getByTestId('delivery-map-canvas', HIDDEN)).toBeTruthy();
      expect(screen.getByTestId('mb-ShapeSource-hg-dropoff', HIDDEN)).toBeTruthy();
      expect(screen.getByTestId('mb-ShapeSource-hg-rider', HIDDEN)).toBeTruthy();
      // The drop-off leg routes to the customer only; the restaurant pin is off the map.
      expect(screen.queryByTestId('mb-ShapeSource-hg-pickup', HIDDEN)).toBeNull();
      await waitFor(() => expect(screen.getByText('To Aisha: 2.1 km · about 7 min')).toBeTruthy());
      expect(screen.getByTestId('mb-LineLayer-hg-route-line', HIDDEN)).toBeTruthy();
      expect(screen.queryByText('Route unavailable: straight-line estimate')).toBeNull();
      expect(String(fetchSpy.mock.calls[0]![0])).toContain('/directions/v5/mapbox/driving/');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('says how old the rider’s position is once it is over 30 s old', () => {
    const old = { status: 'ok' as const, fix: { ...fix.fix, recorded_at: new Date(Date.now() - 45_000).toISOString() } };
    wrap(<DeliveryMap leg="pickup" pickup={pickup} dropoff={dropoff} rider={old} />);
    expect(screen.getByTestId('delivery-map-stale')).toHaveTextContent(/^Last updated 4[5-6]s ago$/);
  });

  it('explains a denied location permission instead of failing', () => {
    wrap(<DeliveryMap leg="preview" pickup={pickup} dropoff={dropoff} rider={{ status: 'denied' }} />);
    expect(screen.getByText('Allow location access to see yourself on the map.')).toBeTruthy();
    expect(screen.getByText(/^Karachi Grill to Aisha: /)).toBeTruthy();
  });
});

