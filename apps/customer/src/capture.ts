/**
 * Photo capture → the bytes the real 3-call upload flow needs (`sha256`, `byte_size`,
 * `content_type`). One thin wrapper around `expo-image-picker` so KYC document capture
 * (`OnboardingScreen`) and proof-of-delivery photo capture (`AssignmentScreen`) share it instead
 * of each hand-rolling a picker call.
 *
 * `launchCameraAsync` is preferred (it opens the camera on native, and a capture-enabled file
 * input on web); `pickImage` falls back to the library picker when the camera is unavailable —
 * the Expo web/simulator path has no camera device — rather than failing the whole capture.
 */
import * as ImagePicker from 'expo-image-picker';

import { base64ToBytes } from './base64';

export interface CapturedImage {
  bytes: Uint8Array;
  contentType: string;
  sha256: (hex: (bytes: Uint8Array) => string) => string;
}

export type CaptureOutcome =
  | { ok: true; image: CapturedImage }
  | { ok: false; reason: 'CANCELLED' | 'PERMISSION_DENIED' | 'UNAVAILABLE'; message: string };

async function launch(
  fn: () => Promise<ImagePicker.ImagePickerResult>,
): Promise<CaptureOutcome> {
  try {
    const result = await fn();
    if (result.canceled) {
      return { ok: false, reason: 'CANCELLED', message: 'Capture cancelled.' };
    }
    const asset = result.assets[0];
    if (!asset?.base64) {
      return { ok: false, reason: 'UNAVAILABLE', message: 'No image data returned.' };
    }
    const bytes = base64ToBytes(asset.base64);
    const contentType = asset.mimeType ?? 'image/jpeg';
    return {
      ok: true,
      image: { bytes, contentType, sha256: (hex) => hex(bytes) },
    };
  } catch (e) {
    return {
      ok: false,
      reason: 'UNAVAILABLE',
      message: e instanceof Error ? e.message : 'Capture failed.',
    };
  }
}

/** Take a photo with the device camera, falling back to the library where no camera exists. */
export async function captureImage(): Promise<CaptureOutcome> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (perm.status !== 'granted') {
    if (!perm.canAskAgain) {
      return {
        ok: false,
        reason: 'PERMISSION_DENIED',
        message: 'Camera access is denied. Enable it in settings, or pick a photo instead.',
      };
    }
    return pickImage();
  }
  const outcome = await launch(() =>
    ImagePicker.launchCameraAsync({ base64: true, quality: 0.7, allowsEditing: false }),
  );
  if (!outcome.ok && outcome.reason === 'UNAVAILABLE') {
    // No camera device (common on web / simulators) — fall back to the library rather than dead-end.
    return pickImage();
  }
  return outcome;
}

/** Pick an existing photo from the device library. */
export async function pickImage(): Promise<CaptureOutcome> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (perm.status !== 'granted') {
    return {
      ok: false,
      reason: 'PERMISSION_DENIED',
      message: 'Photo library access is denied. Enable it in settings.',
    };
  }
  return launch(() =>
    ImagePicker.launchImageLibraryAsync({
      base64: true,
      quality: 0.7,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
    }),
  );
}
