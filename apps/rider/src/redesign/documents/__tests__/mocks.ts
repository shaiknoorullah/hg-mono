/**
 * The module mocks the WP8 test files share. Imported first in each test file, so the mocks are
 * registered before any screen module loads.
 *
 * - `expo-camera`: the app's `__mocks__/expo-camera.ts` never grants the camera. This one lets a
 *   test choose the permission (`camera.permission`) and takes a real (tiny) JPEG-shaped photo
 *   through the ref, so the capture → upload path runs end to end.
 * - `src/push.ts`: the legacy client it posts with is bound to the fetch that existed at import,
 *   so the registration request itself is covered by `src/__tests__/push.test.ts`; here we assert
 *   the notifications ask calls it.
 */
jest.mock('react-native-safe-area-context', () => {
  const mod = require('react-native-safe-area-context/jest/mock');
  return mod.default ?? mod;
});

jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  const camera = {
    permission: { granted: true, canAskAgain: true, status: 'granted' } as { granted: boolean; canAskAgain: boolean; status: string } | null,
    shots: 0,
    fail: false,
  };
  const TINY = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  function useCameraPermissions() {
    const [p, setP] = React.useState(camera.permission);
    const request = async () => {
      const next = camera.permission && !camera.permission.granted ? { ...camera.permission, canAskAgain: false } : camera.permission;
      setP(next);
      return next;
    };
    return [p, request, async () => p];
  }
  const CameraView = React.forwardRef(function CameraView(props: { onCameraReady?: () => void; facing?: string; enableTorch?: boolean }, ref: unknown) {
    React.useImperativeHandle(ref, () => ({
      takePictureAsync: async () => {
        camera.shots += 1;
        if (camera.fail) throw new Error('camera failed');
        return { uri: `mock://shot-${camera.shots}.jpg`, width: 1, height: 1, base64: TINY };
      },
    }));
    React.useEffect(() => {
      props.onCameraReady?.();
    }, []);
    return React.createElement(View, { testID: `camera-${props.facing}${props.enableTorch ? '-torch' : ''}` });
  });
  return { __camera: camera, useCameraPermissions, CameraView };
});

jest.mock('../../../push', () => ({ registerForPush: jest.fn(async () => undefined), unregisterForPush: jest.fn() }));

export {};
