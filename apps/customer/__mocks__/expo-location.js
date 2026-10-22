/**
 * Manual Jest mock for `expo-location`: it needs the native module registry, which this app's plain
 * `react-native` preset does not have. Only what `src/redesign/account/locationPermission.ts`
 * calls; a test replaces any of them with `jest.spyOn`.
 */
module.exports = {
  getForegroundPermissionsAsync: async () => ({ granted: true, canAskAgain: true, status: 'granted' }),
  requestForegroundPermissionsAsync: async () => ({ granted: true, canAskAgain: true, status: 'granted' }),
};
