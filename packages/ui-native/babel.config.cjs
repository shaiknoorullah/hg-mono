/*
 * Babel for @hg/ui-native's own jest run (apps compile this package with their own config,
 * build-config.cjs `hgBabelConfig`).
 *
 * The React Native Reusables tier (`src/lib/`) is the one place that compiles JSX through
 * NativeWind, exactly the `NATIVEWIND_SCOPE` the apps use, so its `className` tests exercise the
 * real runtime. Everything else keeps React's own JSX runtime. NativeWind's css-interop is
 * resolved through this package's `nativewind` devDependency (pnpm keeps it beside NativeWind,
 * not in this package's node_modules).
 */
const fs = require('fs');
const path = require('path');

const { NATIVEWIND_SCOPE } = require('./build-config.cjs');

const NATIVEWIND_DIR = fs.realpathSync(path.join(__dirname, 'node_modules/nativewind'));
const RN_PRESET = require.resolve('@react-native/babel-preset');

module.exports = {
  presets: [RN_PRESET],
  overrides: [
    {
      test: (filename) => typeof filename === 'string' && NATIVEWIND_SCOPE.test(filename),
      presets: [[RN_PRESET, { useTransformReactJSXExperimental: true }]],
      plugins: [
        [
          require.resolve('@babel/plugin-transform-react-jsx', { paths: [path.dirname(RN_PRESET)] }),
          { runtime: 'automatic', importSource: 'nativewind' },
        ],
        require.resolve('react-native-css-interop/dist/babel-plugin', { paths: [NATIVEWIND_DIR] }),
      ],
    },
  ],
};
