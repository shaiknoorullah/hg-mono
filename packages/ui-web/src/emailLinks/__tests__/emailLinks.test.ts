import { afterEach, describe, expect, it } from 'vitest';
import type { HgClient } from '@hg/api-client';

import { emailLinkCalls, type LinkOutcome } from '../calls.js';
import { captureLinkToken, linkTokenFor } from '../linkToken.js';

/**
 * The email-link token is a credential (issue #329), and every page switches on the outcome
 * these calls return. The apps' link-page tests drive both through the screens; these pin the
 * two rules underneath: the token leaves the address, and each answer maps to one outcome.
 */

const TOKEN = 'tok_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';

afterEach(() => {
  window.history.replaceState(null, '', '/');
  document.querySelector('meta[name="referrer"]')?.remove();
});

describe('captureLinkToken', () => {
  it('takes the token out of the address of a link page and stops referrers', () => {
    window.history.replaceState(null, '', `/reset-password?token=${TOKEN}&from=email#top`);
    captureLinkToken(['/reset-password']);

    expect(window.location.href).not.toContain(TOKEN);
    expect(window.location.search).toBe('?from=email');
    expect(window.location.hash).toBe('#top');
    expect(document.querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe('no-referrer');
    expect(linkTokenFor('/reset-password')).toBe(TOKEN);
    expect(linkTokenFor('/verify-email')).toBeNull();
  });

  it('leaves any other page alone', () => {
    window.history.replaceState(null, '', `/orders?token=${TOKEN}`);
    captureLinkToken(['/reset-password']);

    expect(window.location.search).toBe(`?token=${TOKEN}`);
    expect(document.querySelector('meta[name="referrer"]')).toBeNull();
    expect(linkTokenFor('/orders')).toBeNull();
  });
});

/** A client whose every POST answers `reply` (or throws it: a dropped connection). */
function clientAnswering(reply: Response | Error): HgClient {
  const POST = async () => {
    if (reply instanceof Error) throw reply;
    const body: unknown = reply.status === 204 ? undefined : await reply.clone().json().catch(() => undefined);
    return reply.ok ? { data: body, response: reply } : { error: body, response: reply };
  };
  return { POST } as unknown as HgClient;
}

const apiError = (status: number, code: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { code, message: code } }), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

describe('emailLinkCalls', () => {
  const cases: Array<[string, (calls: ReturnType<typeof emailLinkCalls>) => Promise<LinkOutcome>, Response | Error, string]> = [
    ['success', (c) => c.resetPassword(TOKEN, 'a long enough password'), new Response(null, { status: 204 }), 'ok'],
    ['a dropped connection', (c) => c.resetPassword(TOKEN, 'pw'), new TypeError('Failed to fetch'), 'unreachable'],
    ['a 5xx', (c) => c.requestPasswordReset('a@b.ca'), new Response(null, { status: 503 }), 'unreachable'],
    ['a breached password', (c) => c.resetPassword(TOKEN, 'pw'), apiError(400, 'BREACHED_PASSWORD'), 'breached'],
    ['a refused password', (c) => c.resetPassword(TOKEN, 'pw'), apiError(422, 'VALIDATION_FAILED'), 'invalid-password'],
    ['a used or expired reset link', (c) => c.resetPassword(TOKEN, 'pw'), apiError(400, 'TOKEN_CONSUMED'), 'expired'],
    ['a used verification link', (c) => c.verifyEmail(TOKEN), apiError(410, 'VERIFICATION_TOKEN_USED'), 'used'],
    ['an expired verification link', (c) => c.verifyEmail(TOKEN), apiError(410, 'VERIFICATION_TOKEN_EXPIRED'), 'expired'],
    ['a refused email address', (c) => c.resendVerification('nope'), apiError(422, 'VALIDATION_FAILED'), 'invalid-email'],
    ['any other 4xx on an email-only call', (c) => c.requestPasswordReset('a@b.ca'), apiError(400, 'X'), 'unreachable'],
  ];

  it.each(cases)('maps %s to one outcome', async (_name, call, reply, expected) => {
    const outcome = await call(emailLinkCalls(clientAnswering(reply)));
    expect(outcome.ok ? 'ok' : outcome.kind).toBe(expected);
  });

  it('turns a 429 into a wait until the time Retry-After gives', async () => {
    const before = Date.now();
    const outcome = await emailLinkCalls(clientAnswering(apiError(429, 'RATE_LIMITED', { 'Retry-After': '120' })))
      .requestPasswordReset('a@b.ca');
    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.kind !== 'rate-limited') throw new Error(`expected rate-limited, got ${JSON.stringify(outcome)}`);
    expect(outcome.retryAt.getTime()).toBeGreaterThanOrEqual(before + 120_000);
    expect(outcome.retryAt.getTime()).toBeLessThan(before + 125_000);
  });
});
