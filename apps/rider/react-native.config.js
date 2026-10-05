/**
 * Native autolinking for the rider app: `@rnmapbox/maps` links only when the build has a Mapbox
 * download token.
 *
 * The Android build fetches the Mapbox native SDK from Mapbox's Maven repository, which needs the
 * secret `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` (`sk.`, `DOWNLOADS:READ`). Builds without it (pull-request
 * CI, e2e, local builds) leave the package unlinked, and the app shows its text fallback
 * (`src/map/mapbox.native.ts` checks for the native module before loading the JS).
 *
 * `platforms.<os> = null` is how React Native autolinking skips a dependency; Expo's autolinking
 * (`expo-modules-autolinking react-native-config`, which the Gradle and CocoaPods builds call)
 * reads this file and honours it the same way. `app.config.js` adds the `@rnmapbox/maps` config
 * plugin on the same condition, so linking and plugin never disagree.
 *
 * The token is only read here as a yes/no. It is never copied into config, the bundle or a log:
 * the native build reads it from the environment itself.
 */
const mapboxNative = Boolean(process.env.RNMAPBOX_MAPS_DOWNLOAD_TOKEN);

module.exports = {
  dependencies: mapboxNative
    ? {}
    : { '@rnmapbox/maps': { platforms: { android: null, ios: null } } },
};
