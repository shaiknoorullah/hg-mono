/**
 * The rider app's Expo config, per environment. It replaces the static `app.json`, which could
 * not read the environment.
 *
 * `APP_ENV` (dev or prod) picks the app's name, package and version; the API it talks to comes
 * from `EXPO_PUBLIC_API_BASE_URL`, which `scripts/release/app-env.cjs` sets for the same
 * environment. Without `APP_ENV` the app is the dev one, and a prod build refuses to bundle any
 * API but production's. How to build each: docs/release/README.md.
 *
 * `@rnmapbox/maps` is linked, with its config plugin, only when `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` is
 * set (scripts/release/mapbox.cjs; react-native.config.js does the autolinking half).
 *
 * `extra.eas.projectId` is only added when `EAS_PROJECT_ID` is set, so a local
 * `npx expo prebuild` / gradle build does not need EAS. Run `eas init` (owner step) before using
 * EAS Build and put the id it prints in `EAS_PROJECT_ID`.
 */
const { expoAppEnv } = require('../../scripts/release/app-env.cjs');
const { mapboxPlugins } = require('../../scripts/release/mapbox.cjs');

const CAMERA_REASON =
  'HalalGoes needs the camera to scan the handoff QR code at pickup and drop-off.';

module.exports = () => {
  const env = expoAppEnv(process.env);
  return {
    expo: {
      name: `HalalGoes — Rider${env.nameSuffix}`,
      slug: 'hg-rider',
      version: env.version,
      orientation: 'portrait',
      scheme: 'hgrider',
      userInterfaceStyle: 'light',
      newArchEnabled: true,
      // The HalalGoes logo. Every file under assets/ is written by
      // `pnpm --filter @hg/brand build:assets` from the one traced geometry; do
      // not edit them by hand. #FFFAEA is the light theme's surface.base.
      icon: './assets/icon.png',
      splash: {
        image: './assets/splash.png',
        resizeMode: 'contain',
        backgroundColor: '#FFFAEA',
      },
      platforms: ['ios', 'android', 'web'],
      web: {
        bundler: 'metro',
        output: 'single',
        favicon: './assets/favicon.png',
      },
      ios: {
        supportsTablet: true,
        infoPlist: {
          // canOpenURL for the Navigate buttons (apps/rider/src/navigate.ts).
          LSApplicationQueriesSchemes: ['maps', 'comgooglemaps'],
          NSCameraUsageDescription: CAMERA_REASON,
          NSLocationWhenInUseUsageDescription:
            'HalalGoes uses your location to route you to pickups and drop-offs.',
          NSLocationAlwaysAndWhenInUseUsageDescription:
            "HalalGoes uses your location in the background so dispatch can find you while you're online.",
        },
      },
      android: {
        edgeToEdgeEnabled: true,
        permissions: [
          'CAMERA',
          'ACCESS_FINE_LOCATION',
          'ACCESS_COARSE_LOCATION',
          'ACCESS_BACKGROUND_LOCATION',
          'RECORD_AUDIO',
        ],
        package: `com.halalgoes.rider${env.idSuffix}`,
        versionCode: env.versionCode,
        adaptiveIcon: {
          foregroundImage: './assets/adaptive-icon.png',
          backgroundColor: '#FFFAEA',
        },
      },
      plugins: [
        'expo-dev-client',
        'expo-font',
        ['expo-camera', { cameraPermission: CAMERA_REASON }],
        [
          'expo-location',
          {
            locationAlwaysAndWhenInUsePermission:
              "HalalGoes uses your location so dispatch can route you and find you while you're online.",
          },
        ],
        ...mapboxPlugins(),
      ],
      extra: {
        appEnv: env.name,
        mapboxPublicTokenConfigured: Boolean(process.env.EXPO_PUBLIC_MAPBOX_TOKEN),
        ...(process.env.EAS_PROJECT_ID ? { eas: { projectId: process.env.EAS_PROJECT_ID } } : {}),
      },
    },
  };
};
