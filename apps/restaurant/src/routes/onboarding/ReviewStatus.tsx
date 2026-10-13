import type { Schema } from '@hg/api-client';
import { Button, Card, Icon } from '@hg/ui-web';
import { StatusChip } from '../../components/StatusChip';
import { IconAlert } from '../../lib/icons';

/** "HALAL_CERTIFICATION_INVALID" -> "Halal certification invalid" (the admin's own text is shown beside it). */
const humanise = (code: string) => {
  const words = code.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export function ReviewStatus({ status, onRework }: { status: Schema['RestaurantOnboardingStatus']; onRework: () => void }) {
  const rejection = status.current_step === 'FIX_DOCUMENTS' ? status.rejection : null;

  if (rejection) {
    // A REJECT declines the application and lists nothing to fix; a request for
    // changes does. The server does not yet refuse a resubmission after REJECT (#802).
    const declined = rejection.decision === 'REJECT';
    const flagged = rejection.documents.filter((d) => d.state === 'REJECTED' || d.state === 'EXPIRED');
    const reason = rejection.note ?? status.blocking_reason;
    return (
      <Card className="hg-fade-up">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid size-10 flex-none place-items-center rounded-full bg-feedback-warning-tint text-feedback-warning-text">
            <IconAlert size={18} />
          </div>
          <div>
            <h2 className="text-heading-sm font-extrabold text-fg-primary">
              {declined ? 'Application not approved' : 'Documents need attention'}
            </h2>
            <p className="text-body-sm text-fg-secondary">
              {declined
                ? `Review cycle ${status.review_cycle} · the application was declined, not sent back for changes.`
                : `Review cycle ${status.review_cycle} · fix and resubmit below.`}
            </p>
          </div>
        </div>
        {(rejection.reason_code || reason) && (
          <div className="mb-3 rounded-sm border border-feedback-warning-border bg-feedback-warning-tint p-3" data-testid="decision-reason">
            {rejection.reason_code && (
              <p className="text-label-md font-bold text-feedback-warning-text">{humanise(rejection.reason_code)}</p>
            )}
            {reason && <p className="text-body-sm text-fg-secondary">{reason}</p>}
          </div>
        )}
        {flagged.length > 0 && (
          <div className="space-y-3">
            {flagged.map((doc) => (
              <div key={doc.id} className="rounded-sm border border-feedback-warning-border bg-feedback-warning-tint p-3">
                <p className="text-label-md font-bold text-feedback-warning-text">{doc.doc_type}</p>
                <p className="text-caption text-fg-secondary">{doc.review_note ?? doc.rejection_reason_code ?? 'Rejected by review.'}</p>
              </div>
            ))}
          </div>
        )}
        {declined ? (
          <p className="mt-4 text-body-sm text-fg-secondary">
            No documents are listed to fix. To ask about next steps, reply to the decision email or contact HalalGoes support.
          </p>
        ) : (
          <Button fullWidth className="mt-5" onPress={onRework}>
            Go to documents
          </Button>
        )}
      </Card>
    );
  }

  return (
    <Card className="hg-fade-up text-center">
      <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-[var(--hg-state-selected-tint)] text-action-primary-bg">
        <Icon name="clock" weight="bold" size={22} />
      </div>
      <h2 className="text-heading-sm font-extrabold text-fg-primary">Documents in review</h2>
      <p className="mx-auto mt-2 max-w-sm text-body-sm text-fg-secondary">
        Our team reviews compliance documents within 72 hours. We'll email you the moment there's a decision — no
        need to keep this page open.
      </p>
      <div className="mt-4 flex justify-center">
        <StatusChip tone="accent">Review cycle {status.review_cycle}</StatusChip>
      </div>
    </Card>
  );
}
