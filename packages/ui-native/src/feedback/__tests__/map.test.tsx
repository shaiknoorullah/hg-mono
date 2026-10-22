/**
 * `MapView` and `MapPinPicker` on `@rnmapbox/maps` (02-components.md §26).
 *
 * What must never regress: every state has words (the map is never the only way to know where an
 * order is); a `stale` rider marker FREEZES instead of drifting to the new point; the map is
 * hidden from assistive technology while the summary is not; a build with no linked SDK or no
 * public token draws the text panel, not a crash and not a bare grey box; the draggable pin reports
 * its final coordinate.
 *
 * `@rnmapbox/maps` is not installed in this package. It is replaced by plain Views that record the
 * props they were given, the way apps/rider/src/map/__tests__ does.
 */
import { NativeModules, Text, View } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { MapView, type MapViewProps } from '../MapView';
import { MapPinPicker } from '../MapPinPicker';
import { __setMapboxForTest, resolveMapbox, type MapboxModule } from '../internal/maps';

const Pass = ({ children, testID }: { children?: ReactNode; testID?: string }) => (
  <View testID={testID}>{children}</View>
);
const FakeMapView = (props: { children?: ReactNode; testID?: string }) => <Pass {...props} />;
const FakeCamera = () => null;
const FakeMarkerView = ({ children }: { children?: ReactNode; coordinate: number[]; id: string }) => <>{children}</>;
const FakePointAnnotation = ({ children }: { children?: ReactNode; coordinate: number[]; draggable?: boolean }) => <>{children}</>;
const FakeShapeSource = ({ children }: { children?: ReactNode; id: string }) => <>{children}</>;
const FakeLineLayer = () => null;

const setAccessToken = jest.fn();
// Only required once the native module is present; see the loader test below.
jest.mock('@rnmapbox/maps', () => ({ default: mockMapbox }), { virtual: true });
const mockMapbox: MapboxModule = {
  MapView: FakeMapView,
  Camera: FakeCamera,
  MarkerView: FakeMarkerView,
  PointAnnotation: FakePointAnnotation,
  ShapeSource: FakeShapeSource,
  LineLayer: FakeLineLayer,
  StyleURL: { Street: 'mapbox://styles/mapbox/streets-v12' },
  setAccessToken,
};

const SUMMARY = 'Rider is 1.2 km away, about 6 minutes.';
const RESTAURANT = { latitude: 43.65, longitude: -79.38 };
const CUSTOMER = { latitude: 43.7, longitude: -79.4 };

function map(props: Partial<MapViewProps> = {}) {
  return (
    <MapView
      summary={SUMMARY}
      accessToken="pk.test"
      restaurant={RESTAURANT}
      customer={CUSTOMER}
      rider={{ latitude: 43.66, longitude: -79.39, headingDeg: 90 }}
      {...props}
    />
  );
}

const riderCoordinate = () => screen.UNSAFE_getAllByType(FakeMarkerView as never).find((m) => m.props.id === 'hg-rider')?.props.coordinate;

beforeEach(() => {
  __setMapboxForTest(mockMapbox);
  setAccessToken.mockClear();
});
afterAll(() => __setMapboxForTest(undefined));

describe('MapView states', () => {
  it('ready: draws the pins and the route, hidden from assistive technology, with the summary beside it', () => {
    render(map({ route: [RESTAURANT, CUSTOMER] }));
    const ids = screen.UNSAFE_getAllByType(FakeMarkerView as never).map((m) => m.props.id);
    expect(ids).toEqual(['hg-restaurant', 'hg-customer', 'hg-rider']);
    expect(screen.UNSAFE_getAllByType(FakeLineLayer as never).length).toBeGreaterThan(0);

    // The summary is the accessible content and is reachable; the map around it is not.
    expect(screen.getByText(SUMMARY)).toBeTruthy();
    const hidden = screen.UNSAFE_getAllByProps({ accessibilityElementsHidden: true })[0]!;
    expect(hidden.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(hidden.findAllByType(FakeMapView as never)).toHaveLength(1);
    expect(screen.getByTestId('MapView-summary').props.accessibilityRole).toBe('summary');
  });

  it('ready: shows the caller-supplied detail under the summary', () => {
    render(map({ fallbackDetail: <Text>12 King St W · Arriving 6:40 PM</Text> }));
    expect(screen.getByText('12 King St W · Arriving 6:40 PM')).toBeTruthy();
  });

  it('loading: a skeleton frame labelled in words, never a blank rectangle, plus the summary', () => {
    render(map({ state: 'loading' }));
    expect(screen.getByLabelText('Loading map')).toBeTruthy();
    expect(screen.getByText(SUMMARY)).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(FakeMapView as never)).toHaveLength(0);
  });

  it('stale: says "Location updating…" and the rider marker FREEZES at the last known point', () => {
    const { rerender } = render(map());
    expect(riderCoordinate()).toEqual([-79.39, 43.66]);

    rerender(map({ state: 'stale', rider: { latitude: 43.66, longitude: -79.39, headingDeg: 90 } }));
    expect(screen.getByText('Location updating…')).toBeTruthy();

    // A newer point arrives while the state is still stale: the marker must not move toward it.
    rerender(map({ state: 'stale', rider: { latitude: 43.69, longitude: -79.395, headingDeg: 90 } }));
    expect(riderCoordinate()).toEqual([-79.39, 43.66]);
    rerender(map({ state: 'stale', rider: null }));
    expect(riderCoordinate()).toEqual([-79.39, 43.66]);

    // The fix is back: the banner goes and the marker takes the new point.
    rerender(map({ state: 'ready', rider: { latitude: 43.69, longitude: -79.395, headingDeg: 90 } }));
    expect(screen.queryByText('Location updating…')).toBeNull();
    expect(riderCoordinate()).toEqual([-79.395, 43.69]);
  });

  it('degraded: the map stays, with a note that updates are slower', () => {
    render(map({ state: 'degraded' }));
    expect(screen.getByText('Updates may be delayed')).toBeTruthy();
    expect(screen.UNSAFE_getAllByType(FakeMapView as never)).toHaveLength(1);
  });

  it('error: the text panel with the summary and a retry, no map', () => {
    const onRetry = jest.fn();
    render(map({ state: 'error', onRetry, fallbackDetail: <Text>Addresses and ETA</Text> }));
    expect(screen.getByText('Map unavailable')).toBeTruthy();
    expect(screen.getByText(SUMMARY)).toBeTruthy();
    expect(screen.getByText('Addresses and ETA')).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(FakeMapView as never)).toHaveLength(0);
    fireEvent.press(screen.getByText('Try the map again'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('error: a tile failure reported by the SDK collapses the map to the text panel', () => {
    render(map());
    fireEvent(screen.UNSAFE_getByType(FakeMapView as never), 'didFailLoadingMap');
    expect(screen.getByText('Map unavailable')).toBeTruthy();
    expect(screen.getByText(SUMMARY)).toBeTruthy();
  });

  it('permission-denied: an explanation and a way to system settings, never a bare map', () => {
    const onOpenSettings = jest.fn();
    render(map({ state: 'permission-denied', onOpenSettings }));
    expect(screen.getByText('Location access is off')).toBeTruthy();
    expect(screen.getByText(SUMMARY)).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(FakeMapView as never)).toHaveLength(0);
    fireEvent.press(screen.getByText('Open settings'));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});

describe('when this build cannot draw a map', () => {
  it('SDK not linked (no download token): the text panel, not a crash', () => {
    __setMapboxForTest(null);
    render(map());
    expect(screen.getByText('Map unavailable')).toBeTruthy();
    expect(screen.getByText(SUMMARY)).toBeTruthy();
  });

  it('SDK linked but no public token: the text panel, not a grey tile', () => {
    render(map({ accessToken: '' }));
    expect(screen.getByText('Map unavailable')).toBeTruthy();
    expect(screen.getByText(SUMMARY)).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(FakeMapView as never)).toHaveLength(0);
    expect(setAccessToken).not.toHaveBeenCalled();
  });

  it('the loader checks the native module BEFORE requiring the JS package, then sets the token once', () => {
    const native = NativeModules as Record<string, unknown>;
    __setMapboxForTest(undefined);
    delete native.RNMBXModule;
    // Not linked: the package is never required (it would throw here, as it does in a real build).
    expect(resolveMapbox('pk.test')).toEqual({ mapbox: null, reason: 'module-unlinked' });

    native.RNMBXModule = {};
    __setMapboxForTest(undefined);
    expect(resolveMapbox('')).toEqual({ mapbox: null, reason: 'no-token' });
    expect(resolveMapbox('pk.test').mapbox).toBe(mockMapbox);
    resolveMapbox('pk.test');
    expect(setAccessToken).toHaveBeenCalledTimes(1);
    expect(setAccessToken).toHaveBeenCalledWith('pk.test');
    delete native.RNMBXModule;
  });
});

describe('MapPinPicker', () => {
  const PIN = { latitude: 43.7, longitude: -79.4 };

  it('shows the summary, with the map hidden from assistive technology and the pin on the value', () => {
    render(<MapPinPicker accessToken="pk.test" value={PIN} onChange={jest.fn()} summary="Pin on 12 King St" />);
    expect(screen.getByText('Pin on 12 King St')).toBeTruthy();
    expect(screen.UNSAFE_getAllByProps({ accessibilityElementsHidden: true })[0]!.props.importantForAccessibility).toBe('no-hide-descendants');
    const pin = screen.UNSAFE_getByType(FakePointAnnotation as never);
    expect(pin.props.coordinate).toEqual([-79.4, 43.7]);
    expect(pin.props.draggable).toBe(true);
  });

  it('reports the final coordinate when the pin is dropped', () => {
    const onChange = jest.fn();
    render(<MapPinPicker accessToken="pk.test" value={PIN} onChange={onChange} summary="Pin" />);
    fireEvent(screen.UNSAFE_getByType(FakePointAnnotation as never), 'dragEnd', { geometry: { coordinates: [-79.41, 43.71] } });
    expect(onChange).toHaveBeenCalledWith({ latitude: 43.71, longitude: -79.41 }, 'drag');
  });

  it('places the pin where the map is tapped', () => {
    const onChange = jest.fn();
    render(<MapPinPicker accessToken="pk.test" value={null} onChange={onChange} summary="No pin yet" />);
    expect(screen.UNSAFE_queryAllByType(FakePointAnnotation as never)).toHaveLength(0);
    fireEvent(screen.UNSAFE_getByType(FakeMapView as never), 'press', { geometry: { coordinates: [-79.3, 43.6] } });
    expect(onChange).toHaveBeenCalledWith({ latitude: 43.6, longitude: -79.3 }, 'tap');
  });

  it('disabled: the pin is not draggable and a tap changes nothing', () => {
    const onChange = jest.fn();
    render(<MapPinPicker accessToken="pk.test" value={PIN} onChange={onChange} disabled summary="Saving" />);
    expect(screen.UNSAFE_getByType(FakePointAnnotation as never).props.draggable).toBe(false);
    fireEvent(screen.UNSAFE_getByType(FakeMapView as never), 'press', { geometry: { coordinates: [-79.3, 43.6] } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('without a map: the summary on a plain panel, nothing pretends to be draggable', () => {
    __setMapboxForTest(null);
    render(<MapPinPicker value={PIN} onChange={jest.fn()} summary="Pin on 12 King St" />);
    expect(screen.getByText('Pin on 12 King St')).toBeTruthy();
    expect(screen.getByText('Map unavailable. Use the buttons to place the pin.')).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(FakePointAnnotation as never)).toHaveLength(0);
  });
});
