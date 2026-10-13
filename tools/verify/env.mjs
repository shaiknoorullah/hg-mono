// Shared settings for the tools/verify drivers. The repository is public, so a
// login, a TOTP secret or a machine path never lives in these scripts: each one
// comes from the environment, and a missing one stops the run naming it.
//
//   SEED_EMAIL        email of the account the driver signs in as
//   SEED_PASSWORD     its password
//   SEED_TOTP_SECRET  its base32 TOTP secret (admin and restaurant MFA), as
//                     printed by services/hg/cmd/seedtotp
//   VERIFY_OUT        where screenshots go (default: tools/verify)
//
// Run from the repo root, for example:
//   SEED_EMAIL=... SEED_PASSWORD=... SEED_TOTP_SECRET=... node tools/verify/admin-login.mjs
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const VERIFY_OUT = process.env.VERIFY_OUT ?? path.join(REPO_ROOT, 'tools/verify');

// The value of an environment variable the driver cannot run without.
export function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set: see tools/verify/env.mjs for the variables these drivers read.`);
    process.exit(2);
  }
  return value;
}

// The current six-digit TOTP code for SEED_TOTP_SECRET, from services/hg/cmd/totpnow.
export function totpNow() {
  return execFileSync('go', ['run', './cmd/totpnow'], {
    cwd: path.join(REPO_ROOT, 'services/hg'),
    env: { ...process.env, SECRET: requireEnv('SEED_TOTP_SECRET') },
    encoding: 'utf8',
  }).trim();
}
