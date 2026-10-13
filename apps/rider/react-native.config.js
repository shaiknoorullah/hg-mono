/**
 * Links the native Mapbox SDK only in a build that has the Mapbox download token
 * (scripts/release/mapbox.cjs explains why). Read by autolinking on Android and iOS.
 */
const { mapboxNativeDependencies } = require('../../scripts/release/mapbox.cjs');

module.exports = { dependencies: mapboxNativeDependencies() };
