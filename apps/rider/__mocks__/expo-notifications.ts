/**
 * Test double for `expo-notifications`: Jest has no native module registry, so the real package
 * cannot load. Only what `src/push.ts` calls is stubbed; tests override each with jest.spyOn.
 */
export async function getPermissionsAsync() {
  return { granted: true, canAskAgain: true, status: 'granted' };
}

export async function requestPermissionsAsync() {
  return { granted: true, canAskAgain: true, status: 'granted' };
}

export async function getExpoPushTokenAsync(_options?: { projectId?: string }) {
  return { type: 'expo', data: 'ExponentPushToken[test]' };
}
