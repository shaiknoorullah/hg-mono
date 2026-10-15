/**
 * Per-document-type review checklists (the rider-onboarding boards' document cards).
 *
 * The contract carries `checks` as free `check_key` strings, so these keys are this page's names
 * for the drawn questions. They are provisional until the contract names them (issue #840,
 * https://github.com/shaiknoorullah/hg-mono/issues/840). The age row on identity documents is not
 * a question: it is computed by the server and shown read-only.
 */
import type { DocType, VehicleType } from './model';

export type CheckResult = 'PASS' | 'FAIL' | 'NOT_ASSESSED';

export interface ChecklistItem {
  readonly key: string;
  readonly label: string;
  /** The spec marks it conditional: "Doesn’t apply" (NOT_ASSESSED) is offered as an answer. */
  readonly conditional?: boolean;
}

const LEGIBLE: ChecklistItem = { key: 'LEGIBLE_ALL_PAGES', label: 'Legible, every page present' };
const GENUINE: ChecklistItem = { key: 'DOCUMENT_UNALTERED', label: 'No sign of editing or forgery (dates, names, numbers, photo)' };
const NOT_EXPIRED: ChecklistItem = { key: 'VALID_FOR_14_MORE_DAYS', label: 'Not expired, with 14 days or more left' };
const PROVINCE: ChecklistItem = { key: 'ISSUED_IN_SERVED_PROVINCE', label: 'Issued by a province we serve' };

function licenceClass(vehicle: VehicleType | null | undefined): string {
  if (vehicle === 'MOTORCYCLE') return 'Class on the licence is valid for a motorcycle (M or M2)';
  if (vehicle === 'CAR') return 'Class on the licence is valid for a car (G or G2)';
  return 'Class on the licence is valid for this vehicle';
}

export function checklistFor(type: DocType, context: { vehicle?: VehicleType | null; plate?: string | null }): readonly ChecklistItem[] {
  const plate = context.plate ? ` (${context.plate})` : '';
  switch (type) {
    case 'GOVERNMENT_ID':
      return [
        LEGIBLE,
        GENUINE,
        { key: 'NAME_MATCHES_PROFILE', label: 'Name matches the profile' },
        { key: 'DOB_LEGIBLE_AND_MATCHES', label: 'Date of birth is legible and matches the profile' },
        NOT_EXPIRED,
        PROVINCE,
      ];
    case 'DRIVERS_LICENCE':
      return [LEGIBLE, GENUINE, { key: 'NAME_MATCHES_PROFILE', label: 'Name matches the profile' }, { key: 'LICENCE_CLASS_VALID', label: licenceClass(context.vehicle) }, NOT_EXPIRED, PROVINCE];
    case 'VEHICLE_REGISTRATION':
      return [
        LEGIBLE,
        GENUINE,
        { key: 'PLATE_MATCHES_PROFILE', label: `Plate on the scan matches the profile${plate}` },
        { key: 'REGISTRANT_IS_RIDER_OR_CONSENT', label: 'Registrant on the scan is the rider, or the owner’s signed consent is in the upload' },
        { key: 'OWNER_CONSENT_PRESENT', label: 'Owner’s signed consent is in the upload (only when the registrant on the scan isn’t the rider)', conditional: true },
      ];
    case 'VEHICLE_INSURANCE':
      return [
        LEGIBLE,
        GENUINE,
        { key: 'POLICY_COVERS_PLATE', label: `Policy on the scan covers plate${context.plate ? ` ${context.plate}` : ''}` },
        { key: 'COMMERCIAL_USE_NOT_EXCLUDED', label: 'Commercial or delivery use is not excluded' },
        NOT_EXPIRED,
      ];
    case 'WORK_ELIGIBILITY':
      return [
        LEGIBLE,
        GENUINE,
        { key: 'STATUS_ALLOWS_WORK', label: 'The scan shows Canadian citizenship, permanent residence, or a work permit that allows this work' },
        { key: 'NOT_EXPIRED_WORK_PERMIT', label: 'Not expired (work permits only)', conditional: true },
      ];
    case 'PROFILE_PHOTO':
      return [
        { key: 'CLEAR_FACE', label: 'A clear photo of one face, nothing covering it' },
        GENUINE,
        { key: 'ONLY_THE_RIDER', label: 'No group shot: only the rider is in the photo' },
        { key: 'MATCHES_ID_PHOTO', label: 'Matches the photo on the ID' },
      ];
  }
}

/** Identity documents show the server-computed age as a read-only row after these keys. */
export const SHOWS_AGE: ReadonlySet<DocType> = new Set<DocType>(['GOVERNMENT_ID', 'DRIVERS_LICENCE']);

export type CheckAnswers = Record<string, CheckResult | null>;
export type CheckNotes = Record<string, string>;

export function unanswered(items: readonly ChecklistItem[], answers: CheckAnswers): ChecklistItem[] {
  return items.filter((i) => !answers[i.key]);
}

export function failed(items: readonly ChecklistItem[], answers: CheckAnswers): ChecklistItem[] {
  return items.filter((i) => answers[i.key] === 'FAIL');
}

/** What was recorded, in checklist order, ready for `checks[]` (answered questions only). */
export function recordedChecks(items: readonly ChecklistItem[], answers: CheckAnswers, notes: CheckNotes): Array<{ check_key: string; result: CheckResult; note?: string }> {
  return items.flatMap((i) => {
    const result = answers[i.key];
    if (!result) return [];
    const note = notes[i.key]?.trim();
    return [{ check_key: i.key, result, ...(note ? { note } : {}) }];
  });
}
