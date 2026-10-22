/**
 * Manual Jest mock for `expo-location`: it needs the native module registry, which this app's plain
 * `react-native` preset does not have. Only what `src/redesign/account/locationPermission.ts`
 * calls (and `getCurrentPositionAsync`, for the address form's "Use my current location"); a test replaces any of them with `jest.spyOn`.
 */
module.exports = {
  Accuracy: { Balanced: 3, High: 4 },
  getCurrentPositionAsync: async () => ({ coords: { latitude: 43.6532, longitude: -79.3832, accuracy: 5 }, timestamp: 0 }),
  getForegroundPermissionsAsync: async () => ({ granted: true, canAskAgain: true, status: 'granted' }),
  requestForegroundPermissionsAsync: async () => ({ granted: true, canAskAgain: true, status: 'granted' }),
};
