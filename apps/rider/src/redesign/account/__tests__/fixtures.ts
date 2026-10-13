/**
 * WP9 test data: every literal is a real fixture with the fewest fields changed, for a state the
 * fixture set does not have yet (each is listed in the WP's fixture requests).
 */
import { payload, type Literal } from '../../test/mockApi';

/** `YYYY-MM-DD` for today plus `days`, on the phone's calendar. */
export function isoDay(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const ok = (data: unknown): Literal => ({ status: 200, body: { data } });

/** `rider_me` as the PA boards draw it: Yusuf Ahmed on a scooter, approved, no delivery. */
export function riderMe(over: Record<string, unknown> = {}): Literal {
  const base = payload<Record<string, any>>('rider_me');
  return ok({
    ...base,
    first_name: 'Yusuf',
    last_name: 'Ahmed',
    phone_e164: '+14165550134',
    availability_state: 'OFFLINE',
    active_assignment_id: null,
    vehicle: { ...base.vehicle, vehicle_type: 'SCOOTER', make: 'Honda', model: 'PCX 125', year: 2021, colour: 'Grey', licence_plate: 'CJRA 204' },
    ...over,
  });
}

/** `public_config` with real support hours, or support switched off. */
export function config(over: Record<string, unknown> = {}): Literal {
  return ok({ ...payload<Record<string, unknown>>('public_config'), support_hours: '9 am to 9 pm', ...over });
}
export const supportOff = (): Literal => config({ support_enabled: false, support_phone_e164: null, support_hours: null });

type Doc = Record<string, any>;
const pack = (): Doc[] => payload('rider_document_pack_complete');

/** The complete pack with the insurance expiring in 10 days (Account-Documents). */
export function docsExpiring(): Literal {
  const docs = pack().filter((d) => d.doc_type !== 'GOVERNMENT_ID' && d.doc_type !== 'WORK_ELIGIBILITY');
  for (const d of docs) if (d.doc_type === 'VEHICLE_INSURANCE') d.valid_until = isoDay(10);
  return ok(docs);
}

/** Insurance expired, its replacement with a person (Account-Documents-Expired, Suspended-InReview). */
export function docsExpiredInReview(): Literal {
  const docs = pack().filter((d) => d.doc_type !== 'GOVERNMENT_ID' && d.doc_type !== 'WORK_ELIGIBILITY');
  const insurance = docs.find((d) => d.doc_type === 'VEHICLE_INSURANCE')!;
  insurance.state = 'EXPIRED';
  insurance.valid_until = '2026-09-28';
  docs.push({ ...insurance, id: '6f1c4e0a-1b2c-4d3e-8f90-0a1b2c3d4e5f', state: 'IN_REVIEW', valid_until: '2027-09-29', version: 2, reviewed_at: null, created_at: '2026-09-29T14:00:00.000Z' });
  return ok(docs);
}

/** Insurance expired, nothing sent yet (Suspended-DocExpired). */
export function docsExpired(): Literal {
  const docs = pack();
  const insurance = docs.find((d) => d.doc_type === 'VEHICLE_INSURANCE')!;
  insurance.state = 'EXPIRED';
  insurance.valid_until = '2026-09-28';
  return ok(docs);
}

export const docsEmpty = (): Literal => ok([]);

/** `connect_status_complete` with nothing Stripe will ask for later, and a real last 4. */
export function connectOn(over: Record<string, unknown> = {}): Literal {
  const base = payload('connect_status_complete');
  return ok({ ...base, bank_last4: '4821', requirements: { ...base.requirements, eventually_due: [], disabled_reason: null, deadline: null }, ...over });
}

/** A ConnectStatus with the given requirements (derived from `connect_status_requirements_due`). */
export function connectWith(requirements: Record<string, unknown>, over: Record<string, unknown> = {}): Literal {
  const base = payload('connect_status_requirements_due');
  return ok({
    ...base,
    bank_last4: '4821',
    requirements: { currently_due: [], eventually_due: [], past_due: [], disabled_reason: null, deadline: null, ...requirements },
    ...over,
  });
}

/** An error envelope from the real `error_not_found` fixture, re-coded. */
export function apiError(status: number, code: string): Literal {
  const p = payload('error_not_found');
  p.error.code = code;
  p.error.message = code;
  return { status, body: p };
}

/** The dashboard of a paused rider (`rider_dashboard_active` with blocking reasons). */
export function dashboardBlocked(reasons: string[]): Literal {
  return ok({ ...payload<Record<string, unknown>>('rider_dashboard_active'), mode: 'OFFLINE', active_assignment: null, current_offer: null, blocking_reasons: reasons });
}
