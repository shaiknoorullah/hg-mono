/**
 * The module mocks the Account test files share. Imported first in each test file, so the mocks
 * are registered before any screen module loads.
 */
jest.mock('react-native-safe-area-context', () => {
  const mod = require('react-native-safe-area-context/jest/mock');
  return mod.default ?? mod;
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('../../../push', () => ({ registerForPush: jest.fn(), unregisterForPush: jest.fn(), takeRegisteredDeviceId: jest.fn(() => null) }));

export {};
