/**
 * Test double for `expo-camera`. Jest runs neither the native module registry nor a browser, so
 * the real package (which resolves through `expo-modules-core`'s native `EventEmitter`) cannot
 * load. Only what `src/components/SealScanCard.tsx` imports is stubbed.
 *
 * `useCameraPermissions` returns `null`, the real hook's value before the permission status has
 * loaded, so the card renders its "Enable camera to scan" path and never mounts `CameraView`.
 * Nothing is granted and no scan is ever faked: a test that wants the camera path has to say so.
 */
import * as React from 'react';
import { View } from 'react-native';

const DENIED = { status: 'denied', granted: false, canAskAgain: true, expires: 'never' } as const;

export function useCameraPermissions() {
  return [null, async () => DENIED, async () => DENIED] as const;
}

export function CameraView(props: { style?: unknown }): React.ReactElement {
  return React.createElement(View, { testID: 'expo-camera-mock', style: props.style });
}
