/**
 * Dynamic app config — a plain `app.json` cannot read `process.env`, and the `@rnmapbox/maps`
 * config plugin needs a Mapbox token at prebuild time (Android's `build.gradle` bakes it in as
 * a Maven credential, iOS reads it too). Everything else here is unchanged from the old static
 * `app.json`.
 *
 * Two DIFFERENT Mapbox tokens are in play, and conflating them is a real footgun:
 *   - `RNMapboxMapsDownloadToken` — a SECRET (`sk.…`) used only during native build to download
 *     the Mapbox SDK itself. Never `EXPO_PUBLIC_*` (that prefix ships to the client bundle).
 *   - `EXPO_PUBLIC_MAPBOX_TOKEN` — the PUBLIC runtime token (`pk.…`) `MapView` calls read at
 *     render time (see `.env.example`).
 *
 * This app has no download-token secret configured yet (O-05-adjacent: blocked on Mapbox
 * account setup, not tracked as a numbered decision). Falling back to the public token for the
 * plugin config keeps `expo config` and `prebuild` resolving without a secret in this repo, but
 * it is a placeholder — a real dev/production build needs `MAPBOX_DOWNLOAD_TOKEN` (a secret,
 * deliberately NOT `EXPO_PUBLIC_*`) set in the EAS project's environment before it will actually
 * fetch the native SDK.
 */
module.exports = ({ config }) => ({
  ...config,
  expo: {
    name: 'Halal Goes — Customer',
    slug: 'hg-customer',
    version: '0.0.0',
    orientation: 'portrait',
    scheme: 'hgcustomer',
    userInterfaceStyle: 'light',
    newArchEnabled: true,
    // The HalalGoes logo. Every file under assets/ is written by
    // `node packages/brand/build-assets.mjs` from the one traced geometry; do not
    // edit them by hand. #FFFAEA is the light theme's surface.base.
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
      bundleIdentifier: 'com.halalgoes.customer',
    },
    android: {
      edgeToEdgeEnabled: true,
      package: 'com.halalgoes.customer',
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#FFFAEA',
      },
    },
    plugins: [
      [
        '@rnmapbox/maps',
        {
          RNMapboxMapsDownloadToken:
            process.env.MAPBOX_DOWNLOAD_TOKEN || process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '',
        },
      ],
      'expo-dev-client',
    ],
    extra: {
      // Surfaced here (in addition to the plain `EXPO_PUBLIC_MAPBOX_TOKEN` read at call sites)
      // so `npx expo config --type public` shows a resolved value to sanity-check against.
      mapboxPublicTokenConfigured: Boolean(process.env.EXPO_PUBLIC_MAPBOX_TOKEN),
    },
  },
});
