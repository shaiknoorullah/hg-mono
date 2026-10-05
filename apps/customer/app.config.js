/**
 * The customer app's Expo config, per environment.
 *
 * `APP_ENV` (dev or prod) picks the app's name, package and version; the API it talks to comes
 * from `EXPO_PUBLIC_API_BASE_URL`, which `scripts/release/app-env.cjs` sets for the same
 * environment. Without `APP_ENV` the app is the dev one, and a prod build refuses to bundle any
 * API but production's. How to build each: docs/release/README.md.
 *
 * Maps: the Mapbox plugin is not loaded (no screen uses a map yet); add `@rnmapbox/maps` back to
 * `plugins` with the map screen. `EXPO_PUBLIC_MAPBOX_TOKEN` is still passed through for that.
 */
const { expoAppEnv } = require('../../scripts/release/app-env.cjs');

module.exports = () => {
  const env = expoAppEnv(process.env);
  return {
    expo: {
      name: `HalalGoes — Customer${env.nameSuffix}`,
      slug: 'hg-customer',
      version: env.version,
      orientation: 'portrait',
      scheme: 'hgcustomer',
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
        bundleIdentifier: `com.halalgoes.customer${env.idSuffix}`,
      },
      android: {
        edgeToEdgeEnabled: true,
        package: `com.halalgoes.customer${env.idSuffix}`,
        versionCode: env.versionCode,
        adaptiveIcon: {
          foregroundImage: './assets/adaptive-icon.png',
          backgroundColor: '#FFFAEA',
        },
      },
      plugins: ['expo-dev-client', ['@stripe/stripe-react-native', {}]],
      extra: {
        appEnv: env.name,
        // So `npx expo config --type public` shows whether a map token was present at build time.
        mapboxPublicTokenConfigured: Boolean(process.env.EXPO_PUBLIC_MAPBOX_TOKEN),
      },
    },
  };
};
