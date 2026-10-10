// The phone sign-in code the API just sent, read from the API's log. With HG_ENV=local and the
// `log` sign-in provider, the API writes each code it would have texted to its own log
// (services/hg/internal/auth/sms.go, LogSMSSender) and sends nothing. This is the only way the
// flows learn a code: no real SMS, no database shortcut.
//
//   node tools/e2e/lib/otp.mjs +14165550101           prints the newest code for that phone
//   node tools/e2e/lib/otp.mjs +14165550101 --after <ISO time>   only a code logged after then
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ROOT } from './paths.mjs';

// The API's log line for a code it would have texted (LogSMSSender.SendOTP).
const MARKER = 'otp sms enqueued';

function apiLogs(since) {
  const args = [
    'compose',
    '--project-name', 'hg-e2e',
    '--project-directory', path.join(ROOT, 'deploy'),
    '-f', path.join(ROOT, 'deploy/docker-compose.yml'),
    '--env-file', path.join(ROOT, 'deploy/.env.e2e'),
    'logs', '--no-color', '--no-log-prefix',
  ];
  if (since) args.push('--since', since);
  // Both replicas: Traefik sends the request to either.
  args.push('api');
  return execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** The newest code logged for `phone` (E.164), or null. */
export function latestCode(phone, { since } = {}) {
  const lines = apiLogs(since).split('\n');
  let best = null;
  for (const line of lines) {
    if (!line.includes(MARKER) || !line.includes(phone)) continue;
    let rec;
    try {
      rec = JSON.parse(line.slice(line.indexOf('{')));
    } catch {
      continue;
    }
    if (rec.phone !== phone || !rec.code) continue;
    if (!best || String(rec.time) >= String(best.time)) best = rec;
  }
  return best ? String(best.code) : null;
}

/** Waits up to `timeoutMs` for a code logged for `phone` after `since` (an ISO time). */
export async function waitForCode(phone, { since, timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const code = latestCode(phone, { since });
    if (code) return code;
    if (Date.now() > deadline) {
      throw new Error(`no sign-in code for ${phone} in the API log within ${timeoutMs / 1000} s`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [phone, flag, after] = process.argv.slice(2);
  if (!phone) {
    console.error('usage: node tools/e2e/lib/otp.mjs <+1… phone> [--after <ISO time>]');
    process.exit(2);
  }
  const code = await waitForCode(phone, { since: flag === '--after' ? after : undefined });
  console.log(code);
}
