/* eslint-env node */
/**
 * Metro for a pnpm workspace, plus one deliberate stub.
 *
 * 0. SINGLETON block (FIRST branch of resolveRequest). `@hg/ui-native` is consumed as SOURCE, so
 *    its own `react-native` import would otherwise resolve to a *second* physical copy under the
 *    package's own node_modules, and the app crashes on a duplicate `InitializeCore`
 *    ("property is not writable" from `setUpFuseboxReactDevToolsDispatcher`). Forcing react,
 *    react-native and react-native-safe-area-context to resolve as if imported from THIS app's
 *    entry collapses them back to a single instance.
 *
 * 1. `watchFolders` + `nodeModulesPaths` point at the monorepo root so `@hg/ui-native` and
 *    `@hg/api-client` are consumed as TypeScript source (their `main` is `src/index.ts`) rather
 *    than as a build artefact that does not exist.
 *
 * 2. `react-native-maps` is an *optional* peer of `@hg/ui-native`. `feedback/internal/maps.ts`
 *    resolves it inside a try/catch at render time so a host without it degrades to the text
 *    panel — but Metro resolves the literal string statically at bundle time and would fail the
 *    build before that try/catch ever runs. The stub below makes the require succeed and return
 *    nothing usable, which is the input `resolveNativeMaps()` is written to handle.
 */
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];
config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;

const MAPS_STUB = path.resolve(projectRoot, 'shims/react-native-maps.js');
const CLIPBOARD_SHIM = path.resolve(projectRoot, 'shims/clipboard.ts');
const A11Y_SHIM = path.resolve(projectRoot, 'shims/a11y.ts');
const UI_NATIVE_SRC = path.resolve(monorepoRoot, 'packages/ui-native/src');

/**
 * Modules inside `@hg/ui-native` that cannot run under react-native-web as written, mapped to a
 * host-side adapter with the same export contract. Both are documented in `shims/`; neither changes a component's behaviour, and neither is applied on native.
 */
const WEB_SHIMS = [
  { match: /(^|\/)internal\/clipboard$/, filePath: CLIPBOARD_SHIM },
  { match: /(^|\/)internal\/a11y$/, filePath: A11Y_SHIM },
];

/**
 * Because `@hg/ui-native` is source, react + react-native + safe-area-context must resolve to a
 * single physical copy — the app's — or the RN runtime initialises twice and throws on web.
 */
const SINGLETONS = ['react', 'react-native', 'react-native-safe-area-context'];
const isSingleton = (n) => SINGLETONS.some((s) => n === s || n.startsWith(s + '/'));

const upstreamResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
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

  if (typeof context.originModulePath === 'string' && context.originModulePath.startsWith(UI_NATIVE_SRC)) {
    for (const shim of WEB_SHIMS) {
      if (shim.match.test(moduleName)) {
        return { type: 'sourceFile', filePath: shim.filePath };
      }
    }
  }

  const resolve = upstreamResolveRequest ?? context.resolveRequest;

  /**
   * `@hg/api-client` is authored for NodeNext and writes `export * from './client.js'` against a
   * file that is actually `client.ts`. TypeScript remaps that extension; Metro does not. Fall back
   * to the extensionless specifier when the literal `.js` path does not exist.
   */
  if (/^\.\.?\//.test(moduleName) && /\.jsx?$/.test(moduleName)) {
    try {
      return resolve(context, moduleName, platform);
    } catch {
      return resolve(context, moduleName.replace(/\.jsx?$/, ''), platform);
    }
  }

  return resolve(context, moduleName, platform);
};

module.exports = config;
