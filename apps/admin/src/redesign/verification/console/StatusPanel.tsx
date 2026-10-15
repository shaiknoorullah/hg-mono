/**
 * What a certificate that already has a ruling says about itself (`RV/Verify-Statuses`,
 * `Verify-Approved*`, `Verify-Rejected`, `Verify-Revoked`), and what a support agent sees
 * (`Verify-Support`).
 *
 * Every certificate status the contract defines has a panel here: pending review, approved
 * (renewal due in amber), rejected, expired, revoked and superseded. None is red. An expired
 * certificate is cool slate and says "we can't currently vouch": that is the platform declining to
 * vouch, not a ruling that the food is forbidden.
 */
import type { Schema } from '@hg/api-client';

import { Card, Icon, InlineAlert, KeyValueList } from '../../ds';
import { formatLongDate, formatTime } from '../../data/format';
import { CertificateStatusBadge, RestaurantHalalBadge, RENEWAL_WINDOW_DAYS } from '../shared/halal';
import { daysUntil } from '../../data/format';
import { REJECTION_LABEL, type Certificate } from './model';
import type { ReactNode } from 'react';

type Application = Schema['RestaurantApplication'];

function decidedAt(cert: Certificate): string {
  return cert.verified_at ? ` at ${formatTime(cert.verified_at)} on ${formatLongDate(cert.verified_at)}` : '';
}

function ReadOnlyCard({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card variant="outlined" radius="lg" padding="16px">
      <div className="flex items-start gap-3">
        <Icon name="lock" size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-label-lg text-fg-primary">{title}</p>
          <div className="text-body-md text-fg-secondary">{children}</div>
          {action}
        </div>
      </div>
    </Card>
  );
}

/** The panel for a certificate that is no longer pending review. `action` is Revoke… for an approved one. */
export function DecidedStatus({ certificate, application, action }: { certificate: Certificate; application: Application | null; action?: ReactNode }) {
  const name = application?.display_name ?? 'The restaurant';
  const reason = certificate.rejection_reason_code ? REJECTION_LABEL[certificate.rejection_reason_code] : null;
  switch (certificate.status) {
    case 'APPROVED': {
      const left = daysUntil(certificate.expires_on);
      const renewal = left !== null && left <= RENEWAL_WINDOW_DAYS;
      return (
        <ReadOnlyCard title="Decided. This certificate is read-only." action={action}>
          <p>
            Approved{decidedAt(certificate)}. Valid until {formatLongDate(certificate.expires_on)}. To change anything, the restaurant uploads a new certificate.
          </p>
          {renewal ? <p className="mt-1">Still certified. The certificate expires within the renewal window.</p> : null}
        </ReadOnlyCard>
      );
    }
    case 'REJECTED':
      return (
        <ReadOnlyCard title="Rejected. This certificate is read-only.">
          <p>
            Rejected{decidedAt(certificate)}.{reason ? ` Reason: ${reason}.` : ''} Your message was sent to the restaurant word for word.
          </p>
          {certificate.rejection_reason_text ? <blockquote className="mt-1 border-s-2 ps-3 text-fg-primary">“{certificate.rejection_reason_text}”</blockquote> : null}
          <p className="mt-1">The restaurant can upload a new certificate. It arrives as a new record for review.</p>
        </ReadOnlyCard>
      );
    case 'EXPIRED':
      return (
        <InlineAlert tone="slate" title="Expired. We can’t currently vouch for this restaurant’s certification.">
          {certificate.expires_on ? `Expired on ${formatLongDate(certificate.expires_on)}. ` : ''}It is hidden from customers until a renewed certificate is approved.
        </InlineAlert>
      );
    case 'REVOKED':
      return (
        <ReadOnlyCard title="Revoked. This certificate is read-only.">
          <p>
            Verification was withdrawn for cause. {name}’s application can’t be approved until a new certificate is approved.
            {reason ? ` Reason: ${reason}.` : ''}
          </p>
          {certificate.rejection_reason_text ? <blockquote className="mt-1 border-s-2 ps-3 text-fg-primary">“{certificate.rejection_reason_text}”</blockquote> : null}
        </ReadOnlyCard>
      );
    case 'SUPERSEDED':
      return (
        <ReadOnlyCard title="Superseded. This record no longer certifies anything.">
          <p>A newer certificate replaced this one. This record no longer certifies anything; the badge belongs to the newer certificate.</p>
        </ReadOnlyCard>
      );
    default:
      return null;
  }
}

/** The support agent's whole view of a certificate: status, expiry, issuer, and whether it was rejected. */
export function SupportSummary({ certificate, application }: { certificate: Certificate; application: Application | null }) {
  const reason = certificate.rejection_reason_code ? REJECTION_LABEL[certificate.rejection_reason_code] : null;
  return (
    <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto p-6" data-testid="SupportSummary">
      <Card variant="outlined" radius="lg" padding="20px" style={{ maxWidth: 760, width: '100%' }}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-heading-md text-fg-primary">{application?.display_name ?? 'Halal certificate'}</h2>
            <span className="flex items-center gap-2 text-body-md text-fg-secondary">
              Restaurant now:
              <RestaurantHalalBadge halal={application?.profile.halal} />
            </span>
          </div>
          <KeyValueList
            labelWidth="10rem"
            items={[
              { label: 'Certificate status', value: <CertificateStatusBadge status={certificate.status} expiresOn={certificate.expires_on} /> },
              { label: 'Issuing body', value: certificate.issuing_body?.name },
              { label: 'Expires', value: certificate.expires_on ? formatLongDate(certificate.expires_on) : null },
              { label: 'Rejection reason', value: reason ?? 'None. It hasn’t been rejected.' },
            ]}
          />
          <p className="flex items-start gap-2 text-body-sm text-fg-secondary">
            <Icon name="lock" size="md" />
            Support agents see this summary only. The scan, the certified address, the checks and notes are for admins, who make the decision.
          </p>
        </div>
      </Card>
    </div>
  );
}
