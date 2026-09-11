/**
 * Test double for `expo-image-picker` — same rationale as `expo-location.ts` next to it.
 */
export const MediaTypeOptions = { Images: 'Images' };

export async function requestCameraPermissionsAsync() {
  return { status: 'granted', canAskAgain: true };
}

export async function requestMediaLibraryPermissionsAsync() {
  return { status: 'granted', canAskAgain: true };
}

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

export async function launchCameraAsync() {
  return {
    canceled: false,
    assets: [{ base64: TINY_PNG_BASE64, mimeType: 'image/png', uri: 'mock://camera.png' }],
  };
}

export async function launchImageLibraryAsync() {
  return {
    canceled: false,
    assets: [{ base64: TINY_PNG_BASE64, mimeType: 'image/png', uri: 'mock://library.png' }],
  };
}
