/**
 * The module mocks the WP11 test files share, imported first in each file so they are in place
 * before any screen module loads. WP8's set (safe area, a controllable `expo-camera`) and WP9's
 * (clipboard, push) are reused as they are.
 */
import '../../documents/__tests__/mocks';
import '../../account/__tests__/mocks';

export {};
