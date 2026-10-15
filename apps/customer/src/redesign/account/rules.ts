/**
 * The account area's rules, as pure functions (boards `AC/*`; manifest section 2, A1 to A10).
 *
 * Everything here reads only what the contract returns (`CustomerProfile`, `Address`,
 * `PublicConfig`, `PaymentMethod`). A field the contract does not return is never shown, and
 * nothing here invents one.
 */
import type { Schema } from '@hg/api-client';

import { givenFirstName } from '../../api/profileName';
import { formatDate, timeAfter } from '../lib/time';
import { looksLikeEmail } from '../signin/YourDetailsScreen';
import { supportFrom, type Support } from '../api/config';

export type CustomerProfile = Schema['CustomerProfile'];
export type Address = Schema['Address'];
export type PublicConfig = Schema['PublicConfig'];
export type ProfileUpdate = Schema['CustomerProfileUpdateInput'];

/** The most addresses a customer can keep (board `AC/Addresses-limit`: "You've saved 20"). */
export const ADDRESS_LIMIT = 20;

/** "Aisha Malik", or the first name alone. The server's placeholder first name is never a name. */
export function displayName(profile: Pick<CustomerProfile, 'first_name' | 'last_name'>): string {
  const first = givenFirstName(profile.first_name);
  const last = (profile.last_name ?? '').trim();
  return [first, last].filter(Boolean).join(' ');
}

/** Two letters for the avatar: the initials of the name, or none when there is no name yet. */
export function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = parts[0]![0]!;
  const last = parts.length > 1 ? parts[parts.length - 1]![0]! : '';
  return (first + last).toUpperCase();
}

/** "+14165550134" shown as "+1 416 555 0134". Anything that is not a +1 number is shown as is. */
export function formatPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+1 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

/**
 * The unit line as stored when it already starts with a unit word (Unit, Apt, Suite, #), else
 * prefixed "Unit " (board `AC/AddressForm`: never "Unit Unit 4211").
 */
export function unitLine(unit: string | null | undefined): string | null {
  const u = (unit ?? '').trim();
  if (!u) return null;
  return /^(unit|apt|apartment|suite|ste|#)\b/i.test(u) || u.startsWith('#') ? u : `Unit ${u}`;
}

export interface AddressRowText {
  title: string;
  /** Street and unit: "300 Borough Dr, Apt 4211". */
  street: string;
  /** "Scarborough, ON M1P 4P5". */
  area: string;
}

/** The row for one saved address. The buzzer and delivery notes are not shown on the list. */
export function addressRow(a: Address): AddressRowText {
  const label = (a.label ?? '').trim();
  return {
    title: label || a.line1,
    street: [a.line1, unitLine(a.unit)].filter(Boolean).join(', '),
    area: `${a.city}, ${a.province} ${a.postal_code}`,
  };
}

/** Default address first, then the rest in the order the server returned them. */
export function defaultFirst(addresses: readonly Address[]): Address[] {
  return [...addresses].sort((a, b) => Number(b.is_default) - Number(a.is_default));
}

/**
 * Account's Addresses subline: "Home · 14 Ellesmere Rd" for the default address. With no default
 * (none saved, or it was deleted) the row says nothing rather than naming a different one.
 */
export function addressesSubline(addresses: readonly Address[], defaultId: string | null | undefined): string | null {
  const d = addresses.find((a) => a.is_default) ?? addresses.find((a) => a.id === defaultId);
  if (!d) return null;
  const label = (d.label ?? '').trim();
  return label ? `${label} · ${d.line1}` : d.line1;
}

/** What Save sends (board `AC/Account-edit`). Phone is never sent. */
export interface EditDraft {
  first: string;
  last: string;
  email: string;
}

export interface EditErrors {
  first?: string;
  email?: string;
}

export const EMAIL_FORMAT_ERROR = "Enter an email like name@example.com.";
export const EMAIL_REJECTED = "We couldn't use this email. Check it's typed correctly.";

export function validateEdit(draft: EditDraft): EditErrors {
  const errors: EditErrors = {};
  if (!draft.first.trim()) errors.first = 'Enter your first name.';
  if (draft.email.trim() && !looksLikeEmail(draft.email)) errors.email = EMAIL_FORMAT_ERROR;
  return errors;
}

/** The draft the sheet opens with. */
export function draftOf(profile: CustomerProfile): EditDraft {
  return { first: givenFirstName(profile.first_name), last: profile.last_name ?? '', email: profile.email ?? '' };
}

export function isDirty(draft: EditDraft, profile: CustomerProfile): boolean {
  const base = draftOf(profile);
  return draft.first.trim() !== base.first || draft.last.trim() !== base.last || draft.email.trim().toLowerCase() !== base.email.toLowerCase();
}

/**
 * The PATCH body: only what changed, and never an empty value. The contract has no way to clear a
 * last name (`minLength: 1`) or an email (not nullable), so a field cleared in the sheet is left
 * as it is on the server (the sheet says so before saving). Any `email` in the body counts as a
 * change: it clears the confirmed state and sends a new link, so it goes only when it differs
 * from the stored one, compared case-insensitively like the server's column.
 */
export function editInput(draft: EditDraft, profile: CustomerProfile): ProfileUpdate {
  const base = draftOf(profile);
  const first = draft.first.trim();
  const last = draft.last.trim();
  const email = draft.email.trim();
  return {
    ...(first && first !== base.first ? { first_name: first } : {}),
    ...(last && last !== base.last ? { last_name: last } : {}),
    ...(email && email.toLowerCase() !== base.email.toLowerCase() ? { email } : {}),
  };
}

/** The 429 on "Send the link again" (`Retry-After` in seconds). */
export type ResendLimit =
  | { kind: 'minute'; until: number }
  | { kind: 'day' };

/** Past this many seconds (an hour) a refusal can only be a daily limit. */
const TIMED_LIMIT_CEILING_S = 3600;

/**
 * Which limit a 429 was. The contract says 1 a minute and 5 a day, but the response names neither,
 * and the server's real windows are an hour and a day (per address and per client). So any wait up
 * to an hour is shown as a static time it lifts at (true whichever window it was), and only a wait
 * longer than an hour is worded as the daily limit.
 */
export function resendLimitOf(retryAfterS: number, receivedAt: number): ResendLimit {
  return retryAfterS > TIMED_LIMIT_CEILING_S
    ? { kind: 'day' }
    : { kind: 'minute', until: timeAfter(receivedAt, retryAfterS).getTime() };
}

/** The consent line under News by email (board `AC/NotificationSettings`). */
export function consentLine(profile: CustomerProfile): string {
  const at = profile.marketing_consent_at;
  if (!at) {
    return "You won't get news or offers by email. We still email you about your account, like confirming your address.";
  }
  const when = formatDate(at);
  if (profile.email && !profile.email_verified) {
    return `You agreed on ${when}. We'll start once you open the link we emailed to ${profile.email}; until then we send nothing there.`;
  }
  return `You agreed on ${when}. Turn this off at any time.`;
}

export type PushState = 'allowed' | 'notAsked' | 'denied';

/** Account's Notification settings subline: "Push on · News by email off". */
export function notificationsSubline(push: PushState | null, profile: CustomerProfile | null): string | null {
  if (!push || !profile) return null;
  const p = push === 'allowed' ? 'Push on' : 'Push off';
  const e = profile.marketing_consent_at ? 'News by email on' : 'News by email off';
  return `${p} · ${e}`;
}

/** The delete-account paragraph: by phone or email only at launch; names only what exists. */
export function deletionText(support: Support | null, email: string | null | undefined): string | null {
  const byPhone = support?.kind === 'open' || support?.kind === 'closed';
  const byEmail = Boolean(email);
  if (!byPhone && !byEmail) return null;
  const how = byPhone && byEmail ? `call us during phone hours or email us at ${email}` : byPhone ? 'call us during phone hours' : `email us at ${email}`;
  return `To delete your account, ${how}. We'll check it's really you, then delete it.`;
}

export { supportFrom };
export type { Support };
