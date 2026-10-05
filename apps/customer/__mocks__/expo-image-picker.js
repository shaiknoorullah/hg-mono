/**
 * Manual Jest mock for `expo-image-picker`. Same reason as `expo-font.js` next to it: the real
 * package resolves through `expo-modules-core`'s native `EventEmitter`, which this app's plain
 * `react-native` jest preset does not provide, so `src/capture.ts` (imported by the KYC screens
 * that `App.tsx` pulls in) threw before any test body ran.
 *
 * Only what `src/capture.ts` calls is stubbed. Same shape as `apps/rider/__mocks__/
 * expo-image-picker.ts`, since the two apps share an identical `capture.ts`.
 */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

module.exports = {
  MediaTypeOptions: { Images: 'Images' },
  requestCameraPermissionsAsync: async () => ({ status: 'granted', canAskAgain: true }),
  requestMediaLibraryPermissionsAsync: async () => ({ status: 'granted', canAskAgain: true }),
  launchCameraAsync: async () => ({
    canceled: false,
    assets: [{ base64: TINY_PNG_BASE64, mimeType: 'image/png', uri: 'mock://camera.png' }],
  }),
  launchImageLibraryAsync: async () => ({
    canceled: false,
    assets: [{ base64: TINY_PNG_BASE64, mimeType: 'image/png', uri: 'mock://library.png' }],
  }),
};
