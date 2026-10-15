/* eslint-env node */
/**
 * Metro for the rider app inside a pnpm workspace, plus the SINGLETON block required because
 * `@hg/ui-native` is consumed as SOURCE.
 *
 * 1. SINGLETONS: `@hg/ui-native` is not a built package — Metro compiles its TypeScript source
 *    in place. Its own `import 'react-native'` would otherwise resolve relative to the library
 *    directory and pull in a *second* physical copy of react-native, which double-runs
 *    InitializeCore and crashes the app on boot with a duplicate `setUpFuseboxReactDevTools-
 *    Dispatcher` ("property is not writable"). Forcing react / react-native /
 *    react-native-safe-area-context to resolve as if imported from THIS app's entry collapses
 *    them to one instance. This MUST be the first branch of resolveRequest.
 *
 * 2. `watchFolders` + `nodeModulesPaths` point at the monorepo root so `@hg/ui-native` and
 *    `@hg/api-client` are consumed as TypeScript source rather than as a build artefact.
 *
 * 3. `react-native-maps` is an optional peer of `@hg/ui-native`; the stub makes the static
 *    require succeed and hands the component its designed "map unavailable" fallback.
 *
 * 4. Two `@hg/ui-native` internals do not survive a web bundle as written (variable `require`
 *    of expo-clipboard; `findNodeHandle` in an effect). They are redirected to host-side
 *    adapters with the same export contract, exactly as the customer app does.
 *
 * 5. NativeWind 4 (redesign, N0). `withNativeWind` is applied LAST and WRAPS the config: its
 *    own resolveRequest calls ours first (so the singleton branch still runs first for every
 *    request) and only swaps the resolved `global.rider.css` for the compiled style module.
 *    `nativewind`, `react-native-css-interop` (the JSX runtime every compiled file imports), its
 *    reanimated/worklets peers and the `@rn-primitives/*` packages join the singletons: ui-native
 *    is compiled as source with the same JSX runtime, and a second css-interop copy would mean a
 *    second, empty style registry.
 */
const path = require('path');
const { NATIVE_SINGLETONS, hgWorkspaceConfig, withHgNativeWind } = require('@hg/ui-native/build-config');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

// Expo's defaults plus the workspace watch folders (packages/ui-native/build-config.cjs).
const config = hgWorkspaceConfig(projectRoot);

const MAPS_STUB = path.resolve(projectRoot, 'shims/react-native-maps.js');
const CLIPBOARD_SHIM = path.resolve(projectRoot, 'shims/clipboard.ts');
const A11Y_SHIM = path.resolve(projectRoot, 'shims/a11y.ts');
const UI_NATIVE_SRC = path.resolve(monorepoRoot, 'packages/ui-native/src');

const WEB_SHIMS = [
  { match: /(^|\/)internal\/clipboard$/, filePath: CLIPBOARD_SHIM },
  { match: /(^|\/)internal\/a11y$/, filePath: A11Y_SHIM },
];

const SINGLETONS = NATIVE_SINGLETONS;
const isSingleton = (n) => SINGLETONS.some((s) => n === s || n.startsWith(s + '/'));


const upstreamResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // 1. Collapse the singleton packages to a single physical copy, resolved as if imported
  //    from this app's entry. MUST stay the first branch.
  if (isSingleton(moduleName)) {
    return context.resolveRequest(
      { ...context, originModulePath: path.join(projectRoot, 'index.js') },
      moduleName,
      platform,
    );
  }

  if (moduleName === 'react-native-maps') {
    return { type: 'sourceFile', filePath: MAPS_STUB };
  }

  if (
    typeof context.originModulePath === 'string' &&
    context.originModulePath.startsWith(UI_NATIVE_SRC)
  ) {
    for (const shim of WEB_SHIMS) {
      if (shim.match.test(moduleName)) {
        return { type: 'sourceFile', filePath: shim.filePath };
      }
    }
  }

  const resolve = upstreamResolveRequest ?? context.resolveRequest;

  // `@hg/api-client` writes `export * from './client.js'` against a file that is `client.ts`.
  // Metro does not remap the extension; fall back to the extensionless specifier.
  if (/^\.\.?\//.test(moduleName) && /\.jsx?$/.test(moduleName)) {
    try {
      return resolve(context, moduleName, platform);
    } catch {
      return resolve(context, moduleName.replace(/\.jsx?$/, ''), platform);
    }
  }

  return resolve(context, moduleName, platform);
};

// NativeWind (redesign N0) wraps the finished config last; its resolveRequest calls ours first.
module.exports = withHgNativeWind(config, { projectRoot, theme: 'rider' });
