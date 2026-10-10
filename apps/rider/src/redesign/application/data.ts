/**
 * The application's data: the onboarding status, the two step submits, and the pure rules the
 * screens share (where the next step is, which documents a vehicle needs, the typed date of
 * birth, the time zone preset from the phone). No UI here.
 *
 * Routing follows the server: `next_step` (with `steps_completed`) decides what the hub offers,
 * never a client-side state tree (SO Ref-OnboardingStates). `progress_percent` is always the
 * server's number.
 */
import { unwrap, type Schema } from '@hg/api-client';

import { rider } from '../data/client';
import { screenFor } from '../nav/registry';
import type { RouteName } from '../nav/routes';

export type OnboardingStatus = Schema['RiderOnboardingStatus'];
export type NextStep = OnboardingStatus['next_step'];
export type VehicleType = Schema['VehicleType'];
export type RiderProfileInput = Schema['RiderProfileInput'];
export type RiderVehicleInput = Schema['RiderVehicleInput'];
export type RiderDocType = Schema['RiderDocType'];

export async function fetchOnboardingStatus(): Promise<OnboardingStatus> {
  const body = await unwrap(rider.GET('/v1/riders/me/onboarding/status'));
  return (body as { data: OnboardingStatus }).data;
}

export async function submitProfile(input: RiderProfileInput): Promise<void> {
  await unwrap(rider.POST('/v1/riders/me/onboarding/profile', { body: input }));
}

export async function submitVehicle(input: RiderVehicleInput): Promise<void> {
  await unwrap(rider.POST('/v1/riders/me/onboarding/vehicle', { body: input }));
}

/** 1-based step on the five-row plan for a `next_step`. */
export function stepNumber(next: NextStep): number {
  switch (next) {
    case 'PROFILE':
      return 1;
    case 'VEHICLE':
      return 2;
    case 'DOCUMENTS':
      return 3;
    case 'AWAITING_REVIEW':
    case 'FIX_DOCUMENTS':
      return 4;
    default:
      return 5;
  }
}

/** Row i (0-based) of the plan is done, per `steps_completed`. */
export function rowDone(status: OnboardingStatus, i: number): boolean {
  const s = status.steps_completed;
  return [s.profile, s.vehicle, s.documents_submitted, s.documents_approved, s.payout_onboarded][i] ?? false;
}

const MOTORISED = new Set<VehicleType>(['CAR', 'SCOOTER', 'MOTORCYCLE']);

export function isMotorised(t: VehicleType | null | undefined): boolean {
  return t != null && MOTORISED.has(t);
}

/** The documents a vehicle needs (contract RiderDocType: 4 motorised, 2 bicycle or on foot). */
export function requiredDocs(t: VehicleType): readonly RiderDocType[] {
  return isMotorised(t)
    ? ['DRIVERS_LICENCE', 'VEHICLE_REGISTRATION', 'VEHICLE_INSURANCE', 'PROFILE_PHOTO']
    : ['GOVERNMENT_ID', 'PROFILE_PHOTO'];
}

/** Documents the rider has added and that still count (not replaced by a newer version). */
export function addedDocs(status: OnboardingStatus | undefined): Schema['KycDocument'][] {
  return (status?.documents ?? []).filter((d) => d.state !== 'SUPERSEDED');
}

/** How many of the vehicle's required documents are added. */
export function addedCount(status: OnboardingStatus, t: VehicleType): number {
  const have = new Set(addedDocs(status).map((d) => String(d.doc_type)));
  return requiredDocs(t).filter((d) => have.has(d)).length;
}

/** The time zones riders choose from (SO Profile tzOptions: Eastern and Central). */
export const TIMEZONES = [
  { value: 'America/Toronto', label: 'Eastern time (Toronto)' },
  { value: 'America/Winnipeg', label: 'Central time (Winnipeg)' },
] as const;

/** Ontario zones the phone may report under an older name. */
const ALIASES: Record<string, string> = {
  'America/Toronto': 'America/Toronto',
  'America/Nipigon': 'America/Toronto',
  'America/Thunder_Bay': 'America/Toronto',
  'America/Winnipeg': 'America/Winnipeg',
  'America/Rainy_River': 'America/Winnipeg',
};

/** The phone's zone, if it is one of ours; otherwise null and the rider picks (Profile-Timezone-Error). */
export function presetTimezone(phoneZone: string | null = phoneTimezone()): string | null {
  return phoneZone ? ALIASES[phoneZone] ?? null : null;
}

export function phoneTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/** Typed Day / Month / Year → `YYYY-MM-DD`, or null when it is not a real date. */
export function dateOfBirth(day: string, month: string, year: string, now: Date = new Date()): string | null {
  if (!/^\d{1,2}$/.test(day) || !/^\d{1,2}$/.test(month) || !/^\d{4}$/.test(year)) return null;
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (y < 1900 || y > now.getFullYear()) return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** The contract's `minimum: 1990` on RiderVehicleInput.year. */
export const MIN_VEHICLE_YEAR = 1990;

/** Field errors from a 422 VALIDATION_FAILED (`details: [{field, code, message}]`). */
export function fieldErrors(details: unknown): Set<string> {
  if (!Array.isArray(details)) return new Set();
  return new Set(details.map((d) => (d && typeof d === 'object' ? String((d as { field?: unknown }).field) : '')));
}

/** `details.min_age` from 422 UNDERAGE; 18 when the server leaves it out (API gap 34). */
export function minAgeFrom(details: unknown): number {
  const v = details && typeof details === 'object' ? (details as { min_age?: unknown }).min_age : undefined;
  return typeof v === 'number' && v > 0 ? v : DEFAULT_MIN_AGE;
}

export const DEFAULT_MIN_AGE = 18;

/**
 * How many times the server has answered UNDERAGE this app session. The second answer locks the
 * form (Profile-UnderageAgain). Kept outside the screen so leaving and reopening the step does
 * not reset it.
 */
let underageAnswers = 0;
let lastMinAge = DEFAULT_MIN_AGE;

export function recordUnderage(minAge: number): number {
  underageAnswers += 1;
  lastMinAge = minAge;
  return underageAnswers;
}

export function underageState(): { count: number; minAge: number } {
  return { count: underageAnswers, minAge: lastMinAge };
}

/** Test seam. */
export function resetApplicationState(): void {
  underageAnswers = 0;
  lastMinAge = DEFAULT_MIN_AGE;
}

/**
 * A route another WP owns that may not be declared or registered on this build yet (WP9's
 * `legalDocument` and `payouts`): its name when a screen is registered for it, else null.
 */
export function optionalRoute(name: string): RouteName | null {
  return screenFor(name as RouteName) ? (name as RouteName) : null;
}
