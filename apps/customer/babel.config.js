// Shared with the other Expo app: babel-preset-expo resolved through `expo`, and NativeWind's
// JSX runtime scoped to the redesign code only (packages/ui-native/build-config.cjs).
const { hgBabelConfig } = require('@hg/ui-native/build-config');

module.exports = (api) => hgBabelConfig(api, __dirname);
