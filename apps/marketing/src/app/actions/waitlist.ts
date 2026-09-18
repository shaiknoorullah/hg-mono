'use server';

import { AUDIENCES, TRACKS, type Audience } from '@/lib/audiences';
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
