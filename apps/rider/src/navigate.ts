/**
 * Hand-off to the phone's maps app: pure URL builders (unit-tested) plus the open helper.
 * Android prefers `google.navigation:` with a `geo:` fallback; iOS prefers Apple Maps with a
 * Google Maps URL fallback; the https Google Maps directions URL is the last resort everywhere.
 */
import { Linking } from 'react-native';

export type Destination = { latitude: number; longitude: number; label?: string };
type Os = 'android' | 'ios' | string;

export function navigateUrls(dest: Destination, os: Os): string[] {
  const ll = `${dest.latitude},${dest.longitude}`;
  const https = `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`;
  if (os === 'android') {
    const label = dest.label ? `(${encodeURIComponent(dest.label)})` : '';
    return [`google.navigation:q=${ll}`, `geo:${ll}?q=${ll}${label}`, https];
  }
  if (os === 'ios') {
    return [`maps://?daddr=${ll}`, `comgooglemaps://?daddr=${ll}&directionsmode=driving`, https];
  }
  return [https];
}

/** Opens the first URL the device can handle; the https URL is tried even if canOpenURL says no. */
export async function openNavigation(dest: Destination, os: Os): Promise<void> {
  const urls = navigateUrls(dest, os);
  for (const url of urls.slice(0, -1)) {
    try {
      if (await Linking.canOpenURL(url)) {
        await Linking.openURL(url);
        return;
      }
    } catch {
      // try the next one
    }
  }
  await Linking.openURL(urls[urls.length - 1]!);
}
