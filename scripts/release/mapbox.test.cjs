// The native Mapbox SDK is linked only with the download token. Run: node --test scripts/release/
'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { hasMapboxDownloadToken, mapboxPlugins, mapboxNativeDependencies } = require('./mapbox.cjs');

const KEY = 'RNMAPBOX_MAPS_DOWNLOAD_TOKEN';

/** Run `fn` with the token set to `value` (or absent), then restore it. */
function withToken(value, fn) {
  const saved = process.env[KEY];
  try {
    if (value === undefined) delete process.env[KEY];
    else process.env[KEY] = value;
    return fn();
  } finally {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  }
}

test('without the token: excluded on both platforms, no plugin', () => {
  for (const value of [undefined, '']) {
    assert.equal(hasMapboxDownloadToken({ [KEY]: value }), false);
    assert.deepEqual(mapboxPlugins({ [KEY]: value }), []);
    assert.deepEqual(mapboxNativeDependencies({ [KEY]: value }), {
      '@rnmapbox/maps': { platforms: { android: null, ios: null } },
    });
  }
});

test('with the token: linked, plugin added with no options, so the token is never written to a config', () => {
  const env = { [KEY]: 'sk.not-a-real-token' };
  assert.equal(hasMapboxDownloadToken(env), true);
  assert.deepEqual(mapboxPlugins(env), ['@rnmapbox/maps']);
  assert.deepEqual(mapboxNativeDependencies(env), {});
});

test('both apps follow the one switch, in app.config.js and react-native.config.js', () => {
  for (const app of ['customer', 'rider']) {
    for (const [token, linked] of [
      [undefined, false],
      ['sk.x', true],
    ]) {
      withToken(token, () => {
        const plugins = require(`../../apps/${app}/app.config.js`)().expo.plugins;
        assert.equal(plugins.includes('@rnmapbox/maps'), linked, `${app} plugin, token ${token}`);
        assert.ok(!JSON.stringify(plugins).includes('sk.x'), 'the token must not appear in plugins');
        delete require.cache[require.resolve(`../../apps/${app}/react-native.config.js`)];
        const deps = require(`../../apps/${app}/react-native.config.js`).dependencies;
        assert.equal('@rnmapbox/maps' in deps, !linked, `${app} autolinking, token ${token}`);
      });
    }
  }
});
