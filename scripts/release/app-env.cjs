#!/usr/bin/env node
/**
 * Which HalalGoes environment a build talks to, decided in one place.
 *
 * Every app build is either `dev` (the dev environment beside production,
 * https://github.com/shaiknoorullah/hg-mono/issues/235) or `prod` (the production API).
 * `APP_ENV` picks one; the table below says what that means. Docs: docs/release/README.md.
 *
 * As a CLI it runs a build with that environment's variables set:
 *
 *   node scripts/release/app-env.cjs dev -- vite build      run a command for dev
 *   node scripts/release/app-env.cjs prod --print            print KEY=VALUE lines (for $GITHUB_ENV)
 *
 *   APP_VERSION    the release's semantic version (required for prod)
 *   API_BASE_URL   dev only: point a dev build at another API, e.g. one on your own machine
 *   EXPO_PUBLIC_HG_REDESIGN, VITE_HG_REDESIGN
 *                  dev only: "1" builds the redesigned screens (tools/e2e/README.md, Redesign).
 *                  Anything else is off. A prod build is always off, and refuses to build when
 *                  either is "1".
 *
 * As a module it is what the Expo `app.config.js` files read (`expoAppEnv`).
 *
 * CommonJS on purpose: Expo evaluates app.config.js with `require`, and Vite builds reach it
 * through the CLI. No dependencies.
 */
'use strict';

const { spawnSync } = require('node:child_process');

/**
 * The API hosts are the contract's `servers` list (contracts/openapi.yaml), which wins over
 * anything else: change the contract first, then this table. Dev uses the contract's second
 * server until the dev environment's host is settled in #235.
 */
const ENVIRONMENTS = {
  dev: {
    apiBaseUrl: 'https://staging-api.halalgoes.com',
    // " Dev" on the app's name and ".dev" on its package, so a dev build installs beside the
    // prod one instead of replacing it.
    nameSuffix: ' Dev',
    idSuffix: '.dev',
  },
  prod: {
    apiBaseUrl: 'https://api.halalgoes.com',
    nameSuffix: '',
    idSuffix: '',
  },
};

/**
 * The redesign's build-time flags (web: Vite inlines `VITE_*`; native: Expo inlines
 * `EXPO_PUBLIC_*`). "1" is on; anything else, or unset, is off. Release 1.0 ships the current
 * screens, so a prod build is always off.
 */
const REDESIGN_FLAGS = ['EXPO_PUBLIC_HG_REDESIGN', 'VITE_HG_REDESIGN'];

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/;

/**
 * Android's `versionCode` from a semantic version. Android refuses to install an update whose
 * code is lower than the installed one, so the code must grow with the version:
 *
 *   MAJOR * 1,000,000 + MINOR * 10,000 + PATCH * 100 + (pre-release number, or 99 for a release)
 *
 * 1.0.0-rc.1 → 1000001, 1.0.0-rc.2 → 1000002, 1.0.0 → 1000099, 1.0.1 → 1000199.
 * Limits: MINOR and PATCH up to 99, a pre-release number from 1 to 98, and pre-releases of one
 * version numbered straight through (rc.1, rc.2 …) whatever their label.
 */
function versionCode(version) {
  const m = VERSION_RE.exec(version);
  if (!m) {
    throw new Error(
      `version "${version}" is not MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-label.N (for example 1.0.0 or 1.0.0-rc.1)`,
    );
  }
  const [major, minor, patch] = [m[1], m[2], m[3]].map(Number);
  const pre = m[5] === undefined ? 99 : Number(m[5]);
  if (major > 999 || minor > 99 || patch > 99) {
    throw new Error(`version "${version}": MAJOR must be at most 999, MINOR and PATCH at most 99`);
  }
  if (m[5] !== undefined && (pre < 1 || pre > 98)) {
    throw new Error(`version "${version}": the pre-release number must be from 1 to 98`);
  }
  return major * 1_000_000 + minor * 10_000 + patch * 100 + pre;
}

/** Everything a build needs to know about one environment. */
function resolveEnvironment(name, env = process.env) {
  const base = ENVIRONMENTS[name];
  if (!base) {
    throw new Error(`APP_ENV must be "dev" or "prod", not "${name}"`);
  }
  let apiBaseUrl = base.apiBaseUrl;
  if (env.API_BASE_URL) {
    if (name === 'prod') {
      throw new Error('API_BASE_URL cannot change a prod build: prod always talks to the production API');
    }
    apiBaseUrl = env.API_BASE_URL.replace(/\/+$/, '');
  }
  if (name === 'prod' && !env.APP_VERSION) {
    throw new Error('a prod build needs APP_VERSION, the release\'s semantic version (for example 1.0.0)');
  }
  const redesignOn = REDESIGN_FLAGS.filter((k) => env[k] === '1');
  if (name === 'prod' && redesignOn.length > 0) {
    throw new Error(
      `a prod build ships the current screens, but ${redesignOn.join(' and ')} is "1" (the redesign). ` +
        'Unset it, or build dev (tools/e2e/README.md, Redesign).',
    );
  }
  const version = env.APP_VERSION || '0.0.0';
  return {
    name,
    apiBaseUrl,
    // The realtime socket lives on the API host (contracts/websocket.md).
    wsUrl: `${apiBaseUrl.replace(/^http/, 'ws')}/v1/ws`,
    nameSuffix: base.nameSuffix,
    idSuffix: base.idSuffix,
    version,
    versionCode: versionCode(version),
    // Only a dev build can carry the redesign: "1" or "0", never anything in between.
    redesign: redesignOn.length > 0 ? '1' : '0',
  };
}

/** The variables a build reads: Expo inlines `EXPO_PUBLIC_*`, Vite inlines `VITE_*`. */
function buildVariables(resolved) {
  return {
    APP_ENV: resolved.name,
    APP_VERSION: resolved.version,
    EXPO_PUBLIC_API_BASE_URL: resolved.apiBaseUrl,
    EXPO_PUBLIC_WS_URL: resolved.wsUrl,
    VITE_API_BASE_URL: resolved.apiBaseUrl,
    VITE_WS_URL: resolved.wsUrl,
    // Set explicitly, on or off, so a local .env file cannot change it: Vite and Expo never let
    // a .env file override a variable already in the environment.
    EXPO_PUBLIC_HG_REDESIGN: resolved.redesign,
    VITE_HG_REDESIGN: resolved.redesign,
  };
}

/**
 * The environment an Expo `app.config.js` builds for. Without `APP_ENV` it is dev, so only a
 * build that asks for prod by name gets the production app name and package.
 *
 * A prod build must also bundle the production API. Expo loads an app's `.env` file, and a
 * local `.env` usually points at a laptop; this refuses that instead of shipping it.
 */
function expoAppEnv(env = process.env) {
  const resolved = resolveEnvironment(env.APP_ENV || 'dev', env);
  if (resolved.name === 'prod' && env.EXPO_PUBLIC_API_BASE_URL !== resolved.apiBaseUrl) {
    throw new Error(
      `a prod build must bundle the production API (${resolved.apiBaseUrl}), but EXPO_PUBLIC_API_BASE_URL is ` +
        `"${env.EXPO_PUBLIC_API_BASE_URL ?? ''}". Build through \`node scripts/release/app-env.cjs prod -- <command>\` ` +
        '(docs/release/README.md).',
    );
  }
  return resolved;
}

const USAGE = `usage:
  node scripts/release/app-env.cjs <dev|prod> -- <command> [args…]   run a command with the environment set
  node scripts/release/app-env.cjs <dev|prod> --print                 print KEY=VALUE lines`;

function main(argv) {
  const [name, ...rest] = argv;
  if (!name || name === '--help' || name === '-h') {
    console.log(USAGE);
    return name ? 0 : 2;
  }
  const vars = buildVariables(resolveEnvironment(name));
  if (rest[0] === '--print') {
    for (const [key, value] of Object.entries(vars)) console.log(`${key}=${value}`);
    return 0;
  }
  const command = rest[0] === '--' ? rest.slice(1) : rest;
  if (command.length === 0) {
    console.error(USAGE);
    return 2;
  }
  const run = spawnSync(command[0], command.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, ...vars },
    shell: process.platform === 'win32',
  });
  if (run.error) throw run.error;
  return run.status ?? 1;
}

module.exports = { ENVIRONMENTS, REDESIGN_FLAGS, versionCode, resolveEnvironment, buildVariables, expoAppEnv };

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`app-env: ${err.message}`);
    process.exitCode = 1;
  }
}
