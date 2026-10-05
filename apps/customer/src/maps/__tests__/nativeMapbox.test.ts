/** Without the native module (a build made without the Mapbox download token) there is no map, and no crash. */
import { NativeModules } from 'react-native';

import { loadMapbox, resetMapboxCacheForTests } from '../nativeMapbox';

afterEach(() => {
  delete (NativeModules as Record<string, unknown>).RNMBXModule;
  resetMapboxCacheForTests();
  jest.resetModules();
});

test('no native module: null, and the JS package is never required', () => {
  const required = jest.fn();
  jest.doMock('@rnmapbox/maps', () => {
    required();
    return {};
  });
  expect(loadMapbox()).toBeNull();
  expect(required).not.toHaveBeenCalled();
});

test('native module present: the package is returned', () => {
  (NativeModules as Record<string, unknown>).RNMBXModule = {};
  const fake = { MapView: () => null, Camera: () => null, MarkerView: () => null };
  jest.doMock('@rnmapbox/maps', () => fake);
  expect(loadMapbox()).toBe(fake);
});

test('native module present but the package throws: null', () => {
  (NativeModules as Record<string, unknown>).RNMBXModule = {};
  jest.doMock('@rnmapbox/maps', () => {
    throw new Error('boom');
  });
  expect(loadMapbox()).toBeNull();
});
