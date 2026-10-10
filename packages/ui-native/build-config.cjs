/**
 * Build wiring the customer and rider apps share for the NativeWind redesign (N0), kept in one
 * place so the two apps cannot drift. Each app's `babel.config.js` and `metro.config.js` call
 * these with their own directory; module resolution always starts from the APP, because pnpm only
 * lets an app require its own dependencies.
 */
const path = require('path');

/**
 * Packages that must resolve to ONE physical copy, the app's, because `@hg/ui-native` is compiled
 * as source: a second react-native double-runs InitializeCore, and a second css-interop would be
 * a second, empty style registry. Metro's singleton branch collapses these.
 */
const NATIVE_SINGLETONS = [
  'react',
  'react-native',
  'react-native-safe-area-context',
  'nativewind',
  'react-native-css-interop',
  'react-native-reanimated',
  'react-native-worklets',
  '@rn-primitives/slot',
  '@rn-primitives/portal',
];

/**
 * The only files that compile their JSX through NativeWind's runtime: the RNR tier and the
 * flag-gated redesign folders. Everything else keeps React's runtime, so a flag-off build neither
 * imports NativeWind nor wraps a single element.
 */
const NATIVEWIND_SCOPE = /[\\/](packages[\\/]ui-native[\\/]src[\\/]lib|apps[\\/][^\\/]+[\\/]src[\\/]redesign)[\\/]/;

/**
 * The Babel config for an Expo app in this workspace.
 *
 * babel-preset-expo is resolved through `expo` (a release bundle once failed with "Cannot find
 * module 'babel-preset-expo'"). The NativeWind override spells out what the `nativewind/babel`
 * preset does, because that preset names its plugins as bare strings pnpm cannot resolve:
 * NativeWind's JSX import source, css-interop's createElement rewrite by absolute path, and the
 * worklets plugin, which babel-preset-expo adds itself.
 */
function hgBabelConfig(api, appDir) {
  api.cache(true);
  const preset = require.resolve('babel-preset-expo', {
    paths: [require.resolve('expo/package.json', { paths: [appDir] })],
  });
  const cssInteropPlugin = require.resolve('react-native-css-interop/dist/babel-plugin', { paths: [appDir] });
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
}

/**
 * Expo's default Metro config for an app in this workspace: the monorepo root is watched and
 * searched, so `@hg/ui-native` and `@hg/api-client` are consumed as TypeScript source.
 */
function hgWorkspaceConfig(projectRoot) {
  const { getDefaultConfig } = require(require.resolve('expo/metro-config', { paths: [projectRoot] }));
  const monorepoRoot = path.resolve(__dirname, '../..');
  const config = getDefaultConfig(projectRoot);
  config.watchFolders = [monorepoRoot];
  config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(monorepoRoot, 'node_modules'),
  ];
  config.resolver.unstable_enableSymlinks = true;
  config.resolver.unstable_enablePackageExports = true;
  return config;
}

/**
 * Wraps a finished Metro config with NativeWind, applied LAST: its resolveRequest calls the app's
 * first, so the singleton branch still runs first for every request, and it only swaps the
 * resolved `global.<theme>.css` for the compiled style module.
 */
function withHgNativeWind(config, { projectRoot, theme }) {
  const { withNativeWind } = require(require.resolve('nativewind/metro', { paths: [projectRoot] }));
  return withNativeWind(config, {
    input: path.resolve(__dirname, `src/tokens/generated/global.${theme}.css`),
    configPath: path.resolve(projectRoot, 'tailwind.config.js'),
    // Otherwise NativeWind rewrites tsconfig.json on every Metro start; nativewind-env.d.ts is
    // committed instead.
    disableTypeScriptGeneration: true,
    // NativeWind's default rem is 14; the design system's is 16.
    inlineRem: 16,
  });
}

module.exports = { NATIVE_SINGLETONS, NATIVEWIND_SCOPE, hgBabelConfig, hgWorkspaceConfig, withHgNativeWind };
