// babel-preset-expo is a dependency of `expo`, not of this app, and pnpm only lets an app
// require its own dependencies. Resolve the preset through `expo` so Metro finds it in every
// build (a release bundle failed with "Cannot find module 'babel-preset-expo'"), always at the
// version this Expo SDK ships with.
const preset = require.resolve('babel-preset-expo', {
  paths: [require.resolve('expo/package.json')],
});

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [[preset, { jsxRuntime: 'automatic' }]],
  };
};
