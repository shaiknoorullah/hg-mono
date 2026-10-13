/**
 * Manual Jest mock for `expo-notifications`: it needs the native module registry, which this
 * app's plain `react-native` preset does not have. Only what `src/api/push.ts` calls; a test
 * replaces any of them with `jest.spyOn`.
 */
module.exports = {
  getPermissionsAsync: async () => ({ granted: true, canAskAgain: true, status: 'granted' }),
  requestPermissionsAsync: async () => ({ granted: true, canAskAgain: true, status: 'granted' }),
  getExpoPushTokenAsync: async () => ({ type: 'expo', data: 'ExponentPushToken[jest]' }),
};
