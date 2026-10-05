/**
 * Whether a build carries the native Mapbox SDK (`@rnmapbox/maps`), decided by one secret.
 *
 * Mapbox's Maven repository serves the Android SDK only to a request carrying a secret
 * download token (`sk.` with DOWNLOADS:READ). Without it Gradle fails with "Could not find
 * com.mapbox.maps:android-ndk27" (#468). So the module is linked only when
 * `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` is set:
 *
 * - set:   autolinked, and the `@rnmapbox/maps` config plugin is added. The plugin itself writes
 *          a Gradle snippet that reads the token from this environment variable at build time;
 *          we pass it no options, so the token is never written into a config, a generated file
 *          or the JS bundle.
 * - unset: excluded from autolinking on both platforms (react-native.config.js), no plugin.
 *          The JS finds no native module and shows its text fallback (the ETA).
 *
 * Used by each app's `app.config.js` and `react-native.config.js`.
 */
'use strict';

/** True when the download token is present. Only its presence is read, never logged. */
function hasMapboxDownloadToken(env = process.env) {
  return Boolean(env.RNMAPBOX_MAPS_DOWNLOAD_TOKEN);
}

/** Entries for `expo.plugins`. */
function mapboxPlugins(env = process.env) {
  return hasMapboxDownloadToken(env) ? ['@rnmapbox/maps'] : [];
}

/** The `dependencies` of `react-native.config.js`. */
function mapboxNativeDependencies(env = process.env) {
  return hasMapboxDownloadToken(env)
    ? {}
    : { '@rnmapbox/maps': { platforms: { android: null, ios: null } } };
}

module.exports = { hasMapboxDownloadToken, mapboxPlugins, mapboxNativeDependencies };
