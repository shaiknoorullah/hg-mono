/**
 * Per-document-type review checklists. Only the food safety certificate has one drawn
 * (`RV/App-Reject`, `App-DocStates`): the contract carries `checks` as free `check_key` strings,
 * so these keys are this page's names for the drawn questions. The other document types have no
 * drawn checklist and are approved or rejected without one (see the pull request).
 */
import type { DocType } from './model';

export interface ChecklistItem {
  readonly key: string;
  readonly label: string;
}

export const DOC_CHECKLISTS: Partial<Record<DocType, readonly ChecklistItem[]>> = {
  FOOD_SAFETY: [
    { key: 'ISSUING_HEALTH_UNIT_PRESENT', label: 'Issuing health unit present' },
    { key: 'PREMISES_ADDRESS_MATCHES', label: 'Premises address matches' },
    { key: 'EXPIRY_AT_LEAST_14_DAYS', label: 'Expiry at least 14 days away' },
    { key: 'HOLDER_NAME_MATCHES', label: 'Holder name matches' },
  ],
};

export type CheckAnswers = Record<string, 'PASS' | 'FAIL' | 'NOT_ASSESSED' | null>;

export function checklistFor(type: DocType): readonly ChecklistItem[] {
  return DOC_CHECKLISTS[type] ?? [];
}

export function unanswered(items: readonly ChecklistItem[], answers: CheckAnswers): ChecklistItem[] {
  return items.filter((i) => !answers[i.key]);
}

export function failed(items: readonly ChecklistItem[], answers: CheckAnswers): ChecklistItem[] {
  return items.filter((i) => answers[i.key] === 'FAIL');
}
