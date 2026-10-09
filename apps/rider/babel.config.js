// babel-preset-expo is a dependency of `expo`, not of this app, and pnpm only lets an app
// require its own dependencies. Resolve the preset through `expo` so Metro finds it in every
// build (a release bundle failed with "Cannot find module 'babel-preset-expo'"), always at the
// version this Expo SDK ships with.
const preset = require.resolve('babel-preset-expo', {
  paths: [require.resolve('expo/package.json')],
});

// NativeWind 4 (redesign, N0): every JSX element goes through NativeWind's JSX runtime so a
// `className` prop resolves against the generated tokens. Elements without `className` render
// as before.
//
// This is what the `nativewind/babel` preset does, spelled out, because that preset names its
// plugins as bare strings ('@babel/plugin-transform-react-jsx', 'react-native-worklets/plugin')
// that Babel resolves from the app's symlinked `node_modules/nativewind`, where pnpm does not
// put them ("Cannot find module '@babel/plugin-transform-react-jsx'" on `expo export`):
//   - the JSX transform with NativeWind's import source  -> babel-preset-expo's own, below;
//   - `react-native-worklets/plugin` (Reanimated 4)      -> babel-preset-expo adds it whenever
//                                                            react-native-worklets is installed;
//   - css-interop's `createElement` rewrite              -> the plugin below, by absolute path.
const cssInteropPlugin = require.resolve('react-native-css-interop/dist/babel-plugin');

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [[preset, { jsxRuntime: 'automatic', jsxImportSource: 'nativewind' }]],
    plugins: [cssInteropPlugin],
  };
};
