/**
 * Test double for `expo-location`. Jest runs neither the native module registry nor a browser,
 * so the real package (which requires one or the other) cannot load. Only what `src/location.ts`
 * calls is stubbed.
 */
export const Accuracy = { Balanced: 3 };

export async function requestForegroundPermissionsAsync() {
  return { status: 'granted' };
}

export async function getCurrentPositionAsync() {
  return {
    coords: { latitude: 43.65, longitude: -79.38, accuracy: 5 },
    timestamp: Date.now(),
  };
}
