import { neon } from '@neondatabase/serverless';
import { type Audience } from '@/lib/audiences';

/**
 * Where a signup goes.
 *
 * Two sinks, checked in this order:
 *
 *   1. `DATABASE_URL` — a Neon Postgres branch. Preferred, because we own it.
 *   2. `WAITLIST_WEBHOOK_URL` — POST the JSON anywhere else.
 *
 * Neither set: saving THROWS and the form shows its error state. A form that
 * reports success while discarding the signup is the one outcome this must
 * never produce, so "no sink" is loud rather than silent.
 *
 * Postgres is first on purpose. A webhook is the right shape for reaching a
 * service somebody else runs; when the database is ours, the hop through an
 * HTTP endpoint only adds a public URL to secure, a second failure mode and a
 * place for a signup to be lost between two systems that both think they
 * delivered. One statement, inside our own network boundary, is fewer things
 * that can go wrong at the moment we can least afford it.
 *
 * `neon()` is the HTTP driver, not a pool, and that is the right choice here:
 * this runs in a Vercel server action — a short-lived serverless invocation
 * that cannot amortise a TCP pool across requests the way a long-running
 * process can.
 */

export class WaitlistNotConfigured extends Error {
  constructor() {
    super(
      'Neither DATABASE_URL nor WAITLIST_WEBHOOK_URL is set — the signup was not stored.',
    );
    this.name = 'WaitlistNotConfigured';
  }
}

export type Signup = {
  audience: Audience;
  /** E.164 for a phone, lower-cased for an email. */
  contact: string;
  kind: 'tel' | 'email';
  /** The exact consent sentence shown, kept verbatim: CASL wants the wording.
   *  "They consented" is not a defence. "They consented to this sentence, on
   *  this date, from this part of the page" is — which is why all three ship
   *  together and why a signup we cannot describe is refused rather than kept. */
  consentText: string;
  consentedAt: string;
  /** Which form on which page: `hero`, `final`. Bounded by the caller. */
  context: string;
  /** Session-scoped campaign parameters. Empty for a direct visit. */
  utm: Record<string, string>;
};

async function saveToPostgres(signup: Signup, connectionString: string): Promise<void> {
  const sql = neon(connectionString);

  // ON CONFLICT DO NOTHING against (audience, contact): pressing the button
  // twice is a silent success rather than a duplicate row. It deliberately
  // does not refresh `consented_at` — the record worth keeping is the FIRST
  // consent, and overwriting it would destroy the evidence it exists for.
  await sql`
    INSERT INTO waitlist_signups
      (audience, contact, kind, consent_text, consented_at, context, utm)
    VALUES
      (${signup.audience}, ${signup.contact}, ${signup.kind},
       ${signup.consentText}, ${signup.consentedAt}, ${signup.context},
       ${JSON.stringify(signup.utm)}::jsonb)
    ON CONFLICT (audience, contact) DO NOTHING
  `;
}

async function saveToWebhook(signup: Signup, url: string): Promise<void> {
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

export async function saveSignup(signup: Signup): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) return saveToPostgres(signup, connectionString);

  const url = process.env.WAITLIST_WEBHOOK_URL;
  if (url) return saveToWebhook(signup, url);

  throw new WaitlistNotConfigured();
}
