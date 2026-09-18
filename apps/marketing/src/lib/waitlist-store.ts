import { type Audience } from '@/lib/audiences';

/**
 * Where a signup goes.
 *
 * Nothing is wired yet, and this file is explicit about that rather than
 * pretending. `WAITLIST_WEBHOOK_URL` lets any form backend be dropped in
 * without a code change; until one is, saving THROWS and the form shows its
 * error state. A form that reports success while discarding the signup is the
 * one outcome this must never produce.
 */

export class WaitlistNotConfigured extends Error {
  constructor() {
    super('WAITLIST_WEBHOOK_URL is not set — the signup was not stored.');
    this.name = 'WaitlistNotConfigured';
  }
}

export type Signup = {
  audience: Audience;
  /** E.164 for a phone, lower-cased for an email. */
  contact: string;
  kind: 'tel' | 'email';
  /** The exact consent sentence shown, kept verbatim: CASL wants the wording. */
  consentText: string;
  consentedAt: string;
};

export async function saveSignup(signup: Signup): Promise<void> {
  const url = process.env.WAITLIST_WEBHOOK_URL;
  if (!url) throw new WaitlistNotConfigured();

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(signup),
    // No retry: a duplicate signup is worse than a retryable error message,
    // because the visitor can press the button again and we cannot un-send.
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Waitlist webhook returned ${response.status}`);
  }
}
