import type { Schema } from '@hg/api-client';
import { Button, Card, Chip } from '../../components/primitives';
import { IconClock, IconAlert } from '../../lib/icons';

export function ReviewStatus({ status, onRework }: { status: Schema['RestaurantOnboardingStatus']; onRework: () => void }) {
  const rejected = status.current_step === 'FIX_DOCUMENTS' && status.rejection;

  if (rejected && status.rejection && 'documents' in status.rejection) {
    const flagged = status.rejection.documents.filter((d) => d.state === 'REJECTED' || d.state === 'EXPIRED');
    return (
      <Card className="hg-fade-up p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-10 w-10 flex-none place-items-center rounded-full bg-[var(--warning-50)] text-[var(--warning-700)]">
            <IconAlert size={18} />
          </div>
          <div>
            <h2 className="text-[16px] font-extrabold text-[var(--ink)]">Documents need attention</h2>
            <p className="text-[13px] text-[var(--ink2)]">Review cycle {status.review_cycle} · fix and resubmit below.</p>
          </div>
        </div>
        <div className="space-y-3">
          {flagged.map((doc) => (
            <div key={doc.id} className="rounded-[var(--r-sm)] border border-[var(--warning-border,#d9be7a)] bg-[var(--warning-50)] p-3">
              <p className="text-[13.5px] font-bold text-[var(--warning-700)]">{doc.doc_type}</p>
              <p className="text-[12.5px] text-[var(--ink2)]">{doc.review_note ?? doc.rejection_reason_code ?? 'Rejected by review.'}</p>
            </div>
          ))}
          {flagged.length === 0 && <p className="text-[13px] text-[var(--ink2)]">{status.blocking_reason}</p>}
        </div>
        <Button className="mt-5 w-full" onClick={onRework}>
          Go to documents
        </Button>
      </Card>
    );
  }

  return (
    <Card className="hg-fade-up p-8 text-center">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-[var(--accent-50)] text-[var(--accent-600)]">
        <IconClock size={22} />
      </div>
      <h2 className="text-[16px] font-extrabold text-[var(--ink)]">Documents in review</h2>
      <p className="mx-auto mt-2 max-w-sm text-[13.5px] text-[var(--ink2)]">
        Our team reviews compliance documents within 72 hours. We'll email you the moment there's a decision — no
        need to keep this page open.
      </p>
      <div className="mt-4 flex justify-center">
        <Chip tone="accent">Review cycle {status.review_cycle}</Chip>
      </div>
    </Card>
  );
}
