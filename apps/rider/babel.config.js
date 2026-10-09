// babel-preset-expo is a dependency of `expo`, not of this app, and pnpm only lets an app
// require its own dependencies. Resolve the preset through `expo` so Metro finds it in every
// build (a release bundle failed with "Cannot find module 'babel-preset-expo'"), always at the
// version this Expo SDK ships with.
const preset = require.resolve('babel-preset-expo', {
  paths: [require.resolve('expo/package.json')],
});

// NativeWind 4 (redesign, N0) — SCOPED. Only the redesign code compiles its JSX through
// NativeWind's runtime (so `className` resolves against the generated tokens):
//   packages/ui-native/src/lib/**   the RNR tier
//   apps/<app>/src/redesign/**      the flag-gated redesign roots
// Every other file keeps React's own JSX runtime, so a flag-off build neither imports
// NativeWind / css-interop nor wraps a single element: it shows and does what it did before.
//
// The override is what the `nativewind/babel` preset does, spelled out, because that preset
// names its plugins as bare strings that Babel resolves from the app's symlinked
// `node_modules/nativewind`, where pnpm does not put them ("Cannot find module
// '@babel/plugin-transform-react-jsx'" on `expo export`):
//   - the JSX transform with NativeWind's import source  -> babel-preset-expo's, re-optioned;
//   - `react-native-worklets/plugin` (Reanimated 4)      -> babel-preset-expo adds it whenever
//                                                            react-native-worklets is installed;
//   - css-interop's `createElement` rewrite              -> the plugin below, by absolute path.
const cssInteropPlugin = require.resolve('react-native-css-interop/dist/babel-plugin');
const NATIVEWIND_SCOPE = /[\\/](packages[\\/]ui-native[\\/]src[\\/]lib|apps[\\/][^\\/]+[\\/]src[\\/]redesign)[\\/]/;

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [[preset, { jsxRuntime: 'automatic' }]],
    overrides: [
      {
        test: (filename) => typeof filename === 'string' && NATIVEWIND_SCOPE.test(filename),
        presets: [[preset, { jsxRuntime: 'automatic', jsxImportSource: 'nativewind' }]],
        plugins: [cssInteropPlugin],
      },
    ],
  };
};
