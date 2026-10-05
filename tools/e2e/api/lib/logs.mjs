// Read staging API logs over ssh and pull a phone sign-in code out of them.
// Codes are returned to the caller and never printed by this module.
import { execFile } from 'node:child_process';

const MARKER = 'otp sms enqueued';

function sshTarget() {
  const host = process.env.E2E_SSH_HOST || '';
  const repo = process.env.E2E_SSH_REPO || '';
  if (!host || !repo) {
    const err = new Error('set E2E_SSH_HOST and E2E_SSH_REPO to read API logs');
    err.code = 'SSH_ENV_MISSING';
    throw err;
  }
  if (!/^[\w.-]+$/.test(host) || !/^\/[\w./-]+$/.test(repo) || repo.includes('..')) {
    const err = new Error('ssh host or repo path is not usable');
    err.code = 'SSH_ENV_REFUSED';
    throw err;
  }
  return { host, repo };
}

function ssh(host, remote) {
  return new Promise((resolve, reject) => {
    execFile(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', host, remote],
      { maxBuffer: 32 * 1024 * 1024, timeout: 60_000 },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = stderr;
          reject(err);
          return;
        }
        resolve(`${stdout}\n${stderr}`);
      },
    );
  });
}

/** API container logs. `since` is a compose duration such as `2m`. */
export function apiLogs(since = '2m') {
  if (!/^\d+[smh]$/.test(since)) {
    const err = new Error('log window is not a compose duration');
    err.code = 'SSH_ENV_REFUSED';
    throw err;
  }
  const { host, repo } = sshTarget();
  const remote = `cd ${repo} && docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.server.yml logs --since ${since} api`;
  return ssh(host, remote);
}

function jsonOn(line) {
  const i = line.indexOf('{');
  if (i < 0) return null;
  try {
    return JSON.parse(line.slice(i));
  } catch {
    return null;
  }
}

function attr(line, key) {
  const m = line.match(new RegExp(`(?:^|[\\s,{])"?${key}"?[=:]"?([^\\s,"}]+)`));
  return m ? m[1].replace(/^"|"$/g, '') : null;
}

/**
 * Newest sign-in code for `phone`, plus a redacted summary safe to print.
 * Accepts JSON logs and text logs. A line that names the phone but omits the
 * code is counted so the report can say the log masked it.
 */
export function findOtp(text, phone) {
  let lines = 0;
  let withCode = 0;
  let phoneSeen = 0;
  let masked = 0;
  let best = null;
  for (const line of String(text).split('\n')) {
    if (!line.includes(MARKER)) continue;
    lines += 1;
    const rec = jsonOn(line);
    const recPhone = rec?.phone ?? attr(line, 'phone');
    const recCode = rec?.code ?? attr(line, 'code');
    const recTime = rec?.time ?? attr(line, 'time') ?? '';
    if (recCode && /^\d{4,8}$/.test(String(recCode))) withCode += 1;
    if (recPhone && String(recPhone).includes('***')) masked += 1;
    if (recPhone === phone) {
      phoneSeen += 1;
      if (recCode && (!best || String(recTime) >= String(best.time))) {
        best = { code: String(recCode), time: String(recTime) };
      }
    }
  }
  return {
    code: best?.code ?? null,
    summary: {
      marker_lines: lines,
      lines_with_code: withCode,
      lines_for_this_phone: phoneSeen,
      lines_with_masked_phone: masked,
    },
  };
}

/**
 * A restaurant email-verification token mentioning `email`, if the log has one.
 * Returns the token to the caller and a summary that does not contain it.
 */
export function findEmailToken(text, email) {
  let mentions = 0;
  let token = null;
  const tokenRe = /(?:token|verify_token|verification_token)["'=:\s]+([A-Za-z0-9_-]{32,128})/i;
  const urlRe = /[?&]token=([A-Za-z0-9_-]{32,128})/;
  for (const line of String(text).split('\n')) {
    if (!line.includes(email) && !/restaurant_email_verify|verification email/i.test(line)) continue;
    if (!line.includes(email) && !/verif/i.test(line)) continue;
    mentions += 1;
    const rec = jsonOn(line);
    const fromJson = rec?.token || rec?.verify_token || rec?.verification_token;
    const m = line.match(tokenRe) || line.match(urlRe);
    const found = (typeof fromJson === 'string' && fromJson.length >= 32 ? fromJson : null) || m?.[1] || null;
    if (found && line.includes(email)) token = found;
  }
  return {
    token,
    summary: { lines_mentioning_email_or_verify: mentions, token_present: Boolean(token) },
  };
}
