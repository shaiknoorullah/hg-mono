'use server';

import { AUDIENCES, TRACKS, type Audience } from '@/lib/audiences';
import { WAITLIST_CHANNEL } from '@/lib/claims';
import { checkContact } from '@/lib/contact';
import { saveSignup, WaitlistNotConfigured } from '@/lib/waitlist-store';

/**
 * `values` carries the submitted input back to the client on every outcome that
 * is not a success. React 19 resets a form once its action resolves, so without
 * this the visitor has to retype their number at exactly the moment we have
 * just told them something went wrong.
 */
export type SubmittedValues = { contact: string; consent: boolean };

export type WaitlistResult =
  | { status: 'idle' }
  | { status: 'ok' }
  | { status: 'invalid'; field: 'contact' | 'consent'; message: string; values: SubmittedValues }
  | { status: 'error'; message: string; values?: SubmittedValues };

function isAudience(value: unknown): value is Audience {
  return typeof value === 'string' && (AUDIENCES as readonly string[]).includes(value);
}

/**
 * Attribution arrives as a JSON string from a hidden field, so it is whatever
 * the browser chose to send. Parsed defensively and bounded: nothing here is
 * trusted, and a malformed blob costs the signup nothing.
 */
function readSubmittedUtm(raw: FormDataEntryValue | null): Record<string, string> {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2000) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>).slice(0, 12)) {
      if (typeof v === 'string') out[k.slice(0, 40)] = v.slice(0, 200);
    }
    return out;
  } catch {
    return {};
  }
}

export async function joinWaitlist(_previous: WaitlistResult, form: FormData): Promise<WaitlistResult> {
  const audience = form.get('audience');
  if (!isAudience(audience)) {
    // Only reachable by hand-crafting the request; the field is hidden and set
    // from the page. Refuse rather than guess which list to add someone to.
    return { status: 'error', message: 'Something went wrong. Please reload the page and try again.' };
  }

  const track = TRACKS[audience];
  const raw = String(form.get('contact') ?? '');
  const consented = form.get('consent') === 'on';
  const values = { contact: raw, consent: consented };

  // Every track collects email while O-03 (SMS sender registration) is open —
  // claims.ts, WAITLIST_CHANNEL. This asserts the two have not drifted apart:
  // a `tel` field with no approved sender behind it collects a channel we
  // cannot lawfully use, which is worse than not asking.
  if (track.form.type !== WAITLIST_CHANNEL) {
    console.error(`[waitlist] track ${audience} collects ${track.form.type}, but WAITLIST_CHANNEL is ${WAITLIST_CHANNEL}.`);
    return { status: 'error', message: 'Something went wrong. Please reload the page and try again.', values };
  }

  const contact = checkContact(track.form.type, raw);
  if (!contact.ok) return { status: 'invalid', field: 'contact', message: contact.message, values };

  // CASL: express consent, and it has to be an affirmative act. An unchecked
  // box is a no, not a maybe — which is why the box ships unticked.
  if (!consented) {
    return {
      status: 'invalid',
      field: 'consent',
      message: 'Please tick the box so we’re allowed to contact you.',
      values,
    };
  }

  try {
    await saveSignup({
      audience,
      contact: contact.normalised,
      kind: track.form.type,
      consentText: track.form.consent,
      consentedAt: new Date().toISOString(),
      context: String(form.get('context') ?? 'unknown').slice(0, 40),
      utm: readSubmittedUtm(form.get('utm')),
    });
  } catch (cause) {
    if (cause instanceof WaitlistNotConfigured) {
      console.error('[waitlist] refusing to report success: no store is configured. Set WAITLIST_WEBHOOK_URL.');
    } else {
      console.error('[waitlist] save failed', cause);
    }
    return { status: 'error', message: 'We couldn’t save that just now. Please try again in a moment.', values };
  }

  return { status: 'ok' };
}
