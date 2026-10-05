/** The tracking card: live map when the SDK and token exist, ETA text alone when they do not. */
import * as React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import type { TrackingSnapshot } from '../../tracking/trackingFeed';

jest.mock('react-native-safe-area-context', () => {
  const mod = require('react-native-safe-area-context/jest/mock');
  return mod.default ?? mod;
});

let mockSnapshot: TrackingSnapshot;
jest.mock('../../tracking/useLiveTracking', () => ({
  useLiveTracking: () => ({ ...mockSnapshot, retry: jest.fn() }),
  useGlide: (p: unknown) => p,
}));

let mockMapbox: unknown = null;
jest.mock('../../maps/nativeMapbox', () => ({ loadMapbox: () => mockMapbox }));

const { TrackingMap } = require('../TrackingMap') as typeof import('../TrackingMap');
const { ThemeProvider } = require('@hg/ui-native') as typeof import('@hg/ui-native');

const base = {
  order_id: 'o1',
  state: 'PICKED_UP',
  eta_at: '2026-10-06T12:30:00.000Z',
  eta_window_minutes: 10,
  restaurant_location: { latitude: 43.65, longitude: -79.38 },
  destination_location: { latitude: 43.7, longitude: -79.4 },
  rider_location: null,
};

function renderMap() {
  return render(
    <ThemeProvider>
      <TrackingMap orderId="o1" />
    </ThemeProvider>,
  );
}

function Wrap({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}
function Marker({ children }: { children?: React.ReactNode }) {
  return (
    <>
      <Text>marker</Text>
      {children}
    </>
  );
}
const fakeMapbox = {
  setAccessToken: jest.fn().mockResolvedValue(undefined),
  MapView: Wrap,
  Camera: Wrap,
  MarkerView: Marker,
};

beforeEach(() => {
  mockMapbox = null;
  process.env.EXPO_PUBLIC_MAPBOX_TOKEN = 'pk.test';
});

test('no native Mapbox module: only the ETA text, no crash', () => {
  mockSnapshot = { tracking: base as never, rider: null, link: 'polling', error: false };
  renderMap();
  expect(screen.getByText(/Arriving/)).toBeTruthy();
  expect(screen.queryByLabelText(/Live map/)).toBeNull();
});

test('native module but no public token: only the ETA text', () => {
  mockMapbox = fakeMapbox;
  delete process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
  mockSnapshot = { tracking: base as never, rider: null, link: 'polling', error: false };
  renderMap();
  expect(screen.queryByLabelText(/Live map/)).toBeNull();
});

test('with the module and token: the map, pins for the restaurant and drop-off, and the rider once known', () => {
  mockMapbox = fakeMapbox;
  mockSnapshot = { tracking: base as never, rider: null, link: 'live', error: false };
  const { unmount } = renderMap();
  expect(screen.getByLabelText(/Live map/)).toBeTruthy();
  expect(screen.getAllByText('marker')).toHaveLength(2);
  unmount();

  mockSnapshot = {
    tracking: base as never,
    rider: { latitude: 43.66, longitude: -79.39, headingDeg: null, recordedAtMs: Date.now() },
    link: 'live',
    error: false,
  };
  renderMap();
  expect(screen.getAllByText('marker')).toHaveLength(3);
  expect(screen.queryByText(/updated/)).toBeNull();
});

test('a rider fix older than 30 s says how old it is', () => {
  mockMapbox = fakeMapbox;
  mockSnapshot = {
    tracking: base as never,
    rider: { latitude: 43.66, longitude: -79.39, headingDeg: null, recordedAtMs: Date.now() - 45_000 },
    link: 'polling',
    error: false,
  };
  renderMap();
  expect(screen.getByText(/Rider location updated 4\ds ago/)).toBeTruthy();
});

test('error before any data: says so and offers a retry; loading renders nothing', () => {
  mockSnapshot = { tracking: null, rider: null, link: 'polling', error: true };
  const { unmount } = renderMap();
  expect(screen.getByText(/isn't available/)).toBeTruthy();
  expect(screen.getByText('Try again')).toBeTruthy();
  unmount();

  mockSnapshot = { tracking: null, rider: null, link: 'polling', error: false };
  renderMap();
  expect(screen.queryByText(/isn't available/)).toBeNull();
});
