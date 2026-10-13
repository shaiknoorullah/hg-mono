/**
 * Specimens for `SetupChecklist`, named after the Onboarding canvas boards that mount `OnbSide`
 * (`Profile-Empty`, `Review-InReview`, `Review-Expired`, `Fix-Rejected`, `Menu-HoursEditing`,
 * `Suspended-Setup`, `Onb-Loading`) and its collapsed form. The live design system has no
 * preview page for it. Each sits in the 288px rail (72px collapsed).
 */

import type { ReactNode } from 'react';

import { SetupChecklist, type SetupChecklistStep, type SetupStepStatus } from './SetupChecklist.js';

/** Grouped under one heading in the preview. */
export const component = 'SetupChecklist';

const Rail = ({ children, width = 288 }: { children: ReactNode; width?: number }) => (
  <div style={{ width, boxSizing: 'border-box', padding: '16px 16px 16px 20px', background: 'var(--hg-surface-base)' }}>{children}</div>
);

const LABELS = ['Business profile', 'Documents added', 'Sent for review', 'Documents approved', 'Payout account', 'Opening hours', 'Menu published'];
const steps = (statuses: SetupStepStatus[], extra: Partial<Record<number, Partial<SetupChecklistStep>>> = {}): SetupChecklistStep[] =>
  LABELS.map((label, i) => ({ id: `step-${i}`, label, status: statuses[i] ?? 'upcoming', ...(extra[i] ?? {}) }));
const toggle = () => undefined;

/** `Profile-Empty`: the first step. */
export function ProfileEmpty() {
  return (
    <Rail>
      <SetupChecklist steps={steps(['current'])} currentLabel="Business profile" percent={0} onCollapsedChange={toggle} />
    </Rail>
  );
}

/** `Review-InReview`: documents with a reviewer. */
export function ReviewInReview() {
  return (
    <Rail>
      <SetupChecklist
        steps={steps(['done', 'done', 'done', 'waiting'], { 0: { href: '#profile' }, 3: { statusLabel: 'With reviewer' } })}
        currentLabel="Waiting for review"
        percent={43}
        onCollapsedChange={toggle}
      />
    </Rail>
  );
}

/** `Review-Expired`: the halal certificate expired in review: slate, never amber. */
export function ReviewExpired() {
  return (
    <Rail>
      <SetupChecklist
        steps={steps(['done', 'done', 'done', 'attention'], { 0: { href: '#profile' }, 3: { statusLabel: 'Renew certificate', halal: true } })}
        currentLabel="Waiting for review"
        percent={43}
        onCollapsedChange={toggle}
      />
    </Rail>
  );
}

/** `Fix-Rejected`: a document needs replacing; progress went back. */
export function FixRejected() {
  return (
    <Rail>
      <SetupChecklist
        steps={steps(['done', 'attention'], { 0: { href: '#profile' }, 1: { statusLabel: 'New upload' } })}
        currentLabel="Fix documents"
        percent={29}
        progressNote="Progress went back because a document needs replacing. Approved documents stay approved."
        onCollapsedChange={toggle}
      />
    </Rail>
  );
}

/** `Menu-HoursEditing`: the last two steps together. */
export function MenuHoursEditing() {
  return (
    <Rail>
      <SetupChecklist
        steps={steps(['done', 'done', 'done', 'done', 'done', 'current', 'current'], { 0: { href: '#profile' }, 3: { href: '#review' } })}
        currentLabel="First menu and opening hours"
        percent={90}
        onCollapsedChange={toggle}
      />
    </Rail>
  );
}

/** `Suspended-Setup`: paused, the next steps not open. */
export function SuspendedSetup() {
  return (
    <Rail>
      <SetupChecklist
        steps={steps(['done', 'done', 'done', 'done', 'blocked', 'blocked', 'blocked'])}
        pausedLabel="Paused: account suspended"
        percent={57}
      />
    </Rail>
  );
}

/** Collapsed to the 72px column. */
export function Collapsed() {
  return (
    <div style={{ width: 72 }}>
      <SetupChecklist steps={steps(['done', 'done', 'done', 'done', 'current'])} percent={57} collapsed onCollapsedChange={toggle} />
    </div>
  );
}

/** `Onb-Loading`. */
export function OnbLoading() {
  return (
    <Rail>
      <SetupChecklist steps={[]} loading />
    </Rail>
  );
}
