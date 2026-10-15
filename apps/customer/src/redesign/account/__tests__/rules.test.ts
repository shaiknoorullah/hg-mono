/**
 * The account area's rules (manifest A1 to A9): what the server is sent, what the page may say,
 * and the two places the contract cannot express what a board draws.
 */
import type { CustomerProfile } from '../rules';
import {
  addressRow,
  addressesSubline,
  consentLine,
  deletionText,
  displayName,
  editInput,
  formatPhone,
  notificationsSubline,
  resendLimitOf,
  unitLine,
  validateEdit,
} from '../rules';
import { payloadOf } from '../../test/mockApi';

const profile = payloadOf<CustomerProfile>('customer_profile');
const addresses = payloadOf<Parameters<typeof addressRow>[0][]>('addresses_list');

describe('unit line', () => {
  it('keeps a stored unit word and prefixes a bare number, never "Unit Unit"', () => {
    expect(unitLine('Apt 4211')).toBe('Apt 4211');
    expect(unitLine('Unit 4211')).toBe('Unit 4211');
    expect(unitLine('Suite 9')).toBe('Suite 9');
    expect(unitLine('#12')).toBe('#12');
    expect(unitLine('4211')).toBe('Unit 4211');
    expect(unitLine('  ')).toBeNull();
    expect(unitLine(null)).toBeNull();
  });
});

describe('what Save sends', () => {
  it('sends only what changed', () => {
    expect(editInput({ first: 'Zainab', last: 'Osman', email: 'owner@karachikitchen.ca' }, profile)).toEqual({});
    expect(editInput({ first: 'Zee', last: 'Osman', email: 'owner@karachikitchen.ca' }, profile)).toEqual({ first_name: 'Zee' });
  });

  it('sends an email only when it differs, case-insensitively: any email in the body re-sends the link', () => {
    expect(editInput({ first: 'Zainab', last: 'Osman', email: 'OWNER@karachikitchen.ca' }, profile)).toEqual({});
    expect(editInput({ first: 'Zainab', last: 'Osman', email: 'new@example.ca' }, profile)).toEqual({ email: 'new@example.ca' });
  });

  it('never sends an emptied last name or email: the contract cannot clear them', () => {
    expect(editInput({ first: 'Zainab', last: '', email: '' }, profile)).toEqual({});
  });

  it('never sends the phone number or a consent flag', () => {
    const body = editInput({ first: 'A', last: 'B', email: 'a@b.ca' }, profile) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['email', 'first_name', 'last_name']);
  });

  it('needs a first name and a well-formed email, and nothing else', () => {
    expect(validateEdit({ first: ' ', last: '', email: '' })).toEqual({ first: 'Enter your first name.' });
    expect(validateEdit({ first: 'A', last: '', email: 'nope@' }).email).toBeTruthy();
    expect(validateEdit({ first: 'A', last: '', email: '' })).toEqual({});
  });
});

describe('names', () => {
  it("never shows the server's placeholder first name as the customer's", () => {
    expect(displayName({ first_name: 'there', last_name: null })).toBe('');
    expect(displayName({ first_name: 'there', last_name: 'Osman' })).toBe('Osman');
    expect(displayName({ first_name: 'Aisha', last_name: 'Malik' })).toBe('Aisha Malik');
  });

  it('formats a +1 number and leaves anything else as it came', () => {
    expect(formatPhone('+14165550134')).toBe('+1 416 555 0134');
    expect(formatPhone('+442071838750')).toBe('+442071838750');
  });
});

describe('the resend limit (a 429 names no window)', () => {
  it('shows any wait up to an hour as a static time it lifts at', () => {
    expect(resendLimitOf(45, 1_000_000)).toEqual({ kind: 'minute', until: 1_045_000 });
    expect(resendLimitOf(3600, 0)).toEqual({ kind: 'minute', until: 3_600_000 });
  });
  it('words only a wait longer than an hour as the daily limit', () => {
    expect(resendLimitOf(3601, 0)).toEqual({ kind: 'day' });
  });
});

describe('notification consent', () => {
  const base = { ...profile, marketing_consent_at: '2026-09-03T15:00:00Z' } as CustomerProfile;
  it('says what is true about when email starts', () => {
    expect(consentLine({ ...base, email_verified: true })).toMatch(/^You agreed on 3 September 2026\. Turn this off at any time\.$/);
    expect(consentLine({ ...base, email_verified: false })).toMatch(/we send nothing there/);
    expect(consentLine({ ...base, marketing_consent_at: null })).toMatch(/You won't get news or offers by email/);
  });

  it('summarises push and email on Account, and says nothing until both are known', () => {
    expect(notificationsSubline('allowed', { ...base })).toBe('Push on · News by email on');
    expect(notificationsSubline('denied', { ...base, marketing_consent_at: null })).toBe('Push off · News by email off');
    expect(notificationsSubline(null, base)).toBeNull();
  });
});

describe('addresses', () => {
  it('names the default on Account, and nothing when there is none', () => {
    expect(addressesSubline(addresses, null)).toMatch(/·|\w/);
    expect(addressesSubline(addresses.map((a) => ({ ...a, is_default: false })), null)).toBeNull();
    expect(addressesSubline([], profile.default_address_id)).toBeNull();
  });

  it('shows no buzzer, notes or coordinates on a list row', () => {
    const row = addressRow({ ...addresses[0]!, buzzer: '1234', delivery_notes: 'Ring twice' });
    expect(JSON.stringify(row)).not.toMatch(/1234|Ring twice/);
  });
});

describe('deleting an account is by request, at launch', () => {
  it('names only the channels that exist', () => {
    expect(deletionText({ kind: 'open', phoneE164: '+1', hours: null }, 'help@halalgoes.ca')).toMatch(/call us during phone hours or email us at help@halalgoes\.ca/);
    expect(deletionText({ kind: 'unavailable' }, 'help@halalgoes.ca')).toMatch(/^To delete your account, email us at help@halalgoes\.ca\./);
    expect(deletionText({ kind: 'closed', hours: '9 am to 9 pm' }, null)).toMatch(/call us during phone hours\./);
    expect(deletionText({ kind: 'unavailable' }, null)).toBeNull();
  });
});
