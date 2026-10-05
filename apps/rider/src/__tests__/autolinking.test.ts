/**
 * The Mapbox native SDK links, and its config plugin loads, only when the build carries the
 * download token. Without it (pull-request CI, e2e, local builds) the Android build must not ask
 * Mapbox's Maven repository for the SDK, and the token itself must never land in the app config,
 * which is embedded in the app.
 */
const ENV = 'RNMAPBOX_MAPS_DOWNLOAD_TOKEN';

function load<T>(path: string, token: string | undefined): T {
  const saved = process.env[ENV];
  if (token === undefined) delete process.env[ENV];
  else process.env[ENV] = token;
  try {
    let mod: T | undefined;
    jest.isolateModules(() => {
      mod = require(path) as T;
    });
    return mod!;
  } finally {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
  }
}

type RnConfig = { dependencies: Record<string, { platforms?: Record<string, null> }> };
type AppConfig = () => { expo: { plugins: unknown[] } };

/** The app config reads the token when it is called, so call it while the token is set. */
function appConfig(token: string | undefined): { expo: { plugins: unknown[] } } {
  const saved = process.env[ENV];
  if (token === undefined) delete process.env[ENV];
  else process.env[ENV] = token;
  try {
    let fn: AppConfig | undefined;
    jest.isolateModules(() => {
      fn = require('../../app.config.js') as AppConfig;
    });
    return fn!();
  } finally {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
  }
}

describe('Mapbox native linking follows the download token', () => {
  it('without the token: unlinked on both platforms, and no plugin', () => {
    const rn = load<RnConfig>('../../react-native.config.js', undefined);
    expect(rn.dependencies['@rnmapbox/maps']?.platforms).toEqual({ android: null, ios: null });
    const app = appConfig(undefined);
    expect(app.expo.plugins).not.toContain('@rnmapbox/maps');
  });

  it('with the token: linked, plugin added, and the token value appears nowhere in the config', () => {
    const rn = load<RnConfig>('../../react-native.config.js', 'sk.test-secret');
    expect(rn.dependencies['@rnmapbox/maps']).toBeUndefined();
    const app = appConfig('sk.test-secret');
    expect(app.expo.plugins).toContain('@rnmapbox/maps');
    expect(JSON.stringify(app)).not.toContain('sk.test-secret');
  });
});
