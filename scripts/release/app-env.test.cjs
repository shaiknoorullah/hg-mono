// The release environment's invariants. Run: node --test scripts/release/
'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { versionCode, resolveEnvironment, buildVariables, expoAppEnv } = require('./app-env.cjs');
const customer = require('../../apps/customer/app.config.js');
const rider = require('../../apps/rider/app.config.js');

const PROD_API = 'https://api.halalgoes.com';
const BUILD_VARS = ['APP_ENV', 'APP_VERSION', 'API_BASE_URL', 'EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_HG_REDESIGN', 'VITE_HG_REDESIGN'];

/** Evaluate an app config with exactly these build variables set, then put the old ones back. */
function configWith(config, vars) {
  const saved = Object.fromEntries(BUILD_VARS.map((k) => [k, process.env[k]]));
  try {
    for (const k of BUILD_VARS) {
      if (vars[k] === undefined) delete process.env[k];
      else process.env[k] = vars[k];
    }
    return config().expo;
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('versionCode grows with the version, so every release installs over the last', () => {
  const ordered = ['0.9.9', '1.0.0-rc.1', '1.0.0-rc.2', '1.0.0', '1.0.1-rc.1', '1.0.1', '1.1.0', '2.0.0'];
  const codes = ordered.map(versionCode);
  for (let i = 1; i < codes.length; i++) {
    assert.ok(codes[i] > codes[i - 1], `${ordered[i]} (${codes[i]}) must be above ${ordered[i - 1]} (${codes[i - 1]})`);
  }
  assert.ok(versionCode('999.99.99') <= 2_100_000_000, "Android's largest versionCode");
  for (const bad of ['1.0', 'v1.0.0', '1.0.0-rc', '1.0.0-rc.0', '1.100.0']) {
    assert.throws(() => versionCode(bad), undefined, bad);
  }
});

test('a prod build talks to the production API and nothing else', () => {
  assert.equal(resolveEnvironment('prod', { APP_VERSION: '1.0.0' }).apiBaseUrl, PROD_API);
  assert.throws(() => resolveEnvironment('prod', { APP_VERSION: '1.0.0', API_BASE_URL: 'http://10.0.2.2:8080' }));
  assert.throws(() => resolveEnvironment('prod', {}), /APP_VERSION/);
  // A local .env pointing at a laptop must not end up in a prod app.
  for (const url of [undefined, 'http://localhost:8080', 'https://staging-api.halalgoes.com']) {
    assert.throws(() => expoAppEnv({ APP_ENV: 'prod', APP_VERSION: '1.0.0', EXPO_PUBLIC_API_BASE_URL: url }));
  }
});

test('without APP_ENV an app is the dev one, never prod', () => {
  for (const config of [customer, rider]) {
    const expo = configWith(config, {});
    assert.equal(expo.extra.appEnv, 'dev');
    assert.match(expo.android.package, /\.dev$/);
  }
});

test('dev and prod builds install side by side: different package, name suffix on dev', () => {
  const prodVars = { APP_ENV: 'prod', APP_VERSION: '1.0.0', EXPO_PUBLIC_API_BASE_URL: PROD_API };
  for (const [config, pkg] of [
    [customer, 'com.halalgoes.customer'],
    [rider, 'com.halalgoes.rider'],
  ]) {
    const prod = configWith(config, prodVars);
    const dev = configWith(config, { ...prodVars, APP_ENV: 'dev' });
    assert.equal(prod.android.package, pkg);
    assert.equal(dev.android.package, `${pkg}.dev`);
    assert.equal(dev.name, `${prod.name} Dev`);
    assert.equal(prod.android.versionCode, versionCode('1.0.0'));
  }
});

test('the redesign flag: off unless a dev build asks for "1"; a prod build is always off', () => {
  const flags = (name, env) => {
    const v = buildVariables(resolveEnvironment(name, env));
    return [v.EXPO_PUBLIC_HG_REDESIGN, v.VITE_HG_REDESIGN];
  };
  assert.deepEqual(flags('dev', {}), ['0', '0']);
  for (const off of ['0', '', 'true', 'on', ' 1']) {
    assert.deepEqual(flags('dev', { EXPO_PUBLIC_HG_REDESIGN: off, VITE_HG_REDESIGN: off }), ['0', '0'], off);
  }
  assert.deepEqual(flags('dev', { EXPO_PUBLIC_HG_REDESIGN: '1' }), ['1', '1']);
  assert.deepEqual(flags('dev', { VITE_HG_REDESIGN: '1' }), ['1', '1']);
  assert.deepEqual(flags('prod', { APP_VERSION: '1.0.0', VITE_HG_REDESIGN: '0' }), ['0', '0']);
  for (const k of ['EXPO_PUBLIC_HG_REDESIGN', 'VITE_HG_REDESIGN']) {
    assert.throws(() => resolveEnvironment('prod', { APP_VERSION: '1.0.0', [k]: '1' }), /redesign/);
  }
  // A local .env that turns the redesign on cannot reach a prod app: app.config.js refuses it.
  const prodVars = { APP_ENV: 'prod', APP_VERSION: '1.0.0', EXPO_PUBLIC_API_BASE_URL: PROD_API };
  for (const config of [customer, rider]) {
    assert.throws(() => configWith(config, { ...prodVars, EXPO_PUBLIC_HG_REDESIGN: '1' }), /redesign/);
    assert.doesNotThrow(() => configWith(config, { ...prodVars, EXPO_PUBLIC_HG_REDESIGN: '0' }));
  }
});
