/**
 * How a halal claim is drawn in the verification console.
 *
 * Two different things, kept apart:
 *
 * - The restaurant's halal BADGE comes only from `profile.halal.display_state` (the seal customers
 *   would see). A missing value renders NO badge at all: silence is never consent on a halal
 *   claim, and no default or optimistic one is drawn in its place
 *   (https://github.com/shaiknoorullah/hg-mono/blob/main/AGENTS.md#3-non-negotiable-invariants).
 * - A CERTIFICATE's own review status (pending review, approved, rejected, expired, revoked,
 *   superseded) is a text label, not the seal. It is never red: a lapsed or withdrawn certificate
 *   is cool slate, which says "we can't currently vouch", and approval is an outlined label, not a
 *   solid green fill (solid green belongs to the halal colour roles only).
 */
import type { Schema } from '@hg/api-client';

import { HalalBadge, Icon, reportClientError } from '../../ds';
import { daysUntil, formatLongDate } from '../../data/format';
import { cx } from '../../ds-stubs/internal/cx';

type CertificateStatus = Schema['HalalCertificateStatus'];

export const CERTIFICATE_STATUS_LABEL: Readonly<Record<CertificateStatus, string>> = {
  PENDING: 'Pending review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
  SUPERSEDED: 'Superseded',
};

/** Days left at which an approved certificate shows the amber "renewal due" tint. */
export const RENEWAL_WINDOW_DAYS = 30;

type Tone = 'neutral' | 'outline' | 'amber' | 'slate';

const TONE: Record<Tone, string> = {
  neutral: 'bg-surface-subtle text-fg-secondary border-line-decorative',
  outline: 'bg-transparent text-fg-primary border-line-interactive',
  amber: 'bg-halal-expiring-tint text-halal-expiring-text border-halal-expiring-border',
  slate: 'bg-halal-expired-tint text-halal-expired-text border-halal-expired-border',
};

function toneFor(status: CertificateStatus, expiresOn: string | null | undefined, now: Date): { tone: Tone; renewal: boolean } {
  if (status === 'APPROVED') {
    const left = daysUntil(expiresOn, now);
    return left !== null && left <= RENEWAL_WINDOW_DAYS ? { tone: 'amber', renewal: true } : { tone: 'outline', renewal: false };
  }
  if (status === 'EXPIRED' || status === 'REVOKED' || status === 'SUPERSEDED') return { tone: 'slate', renewal: false };
  return { tone: 'neutral', renewal: false };
}

/**
 * The certificate's review status as a label. A status this build does not know renders nothing
 * (and is reported), never a guess.
 */
export function CertificateStatusBadge({
  status,
  expiresOn,
  now = new Date(),
  testId = 'CertificateStatusBadge',
}: {
  status: CertificateStatus | null | undefined;
  expiresOn?: string | null;
  now?: Date;
  testId?: string;
}): React.JSX.Element | null {
  if (!status || !(status in CERTIFICATE_STATUS_LABEL)) {
    reportClientError('HALAL_CERTIFICATE_STATUS_UNKNOWN', { status: status ?? null });
    return null;
  }
  const { tone, renewal } = toneFor(status, expiresOn, now);
  const label = renewal ? `${CERTIFICATE_STATUS_LABEL[status]} · renewal due` : CERTIFICATE_STATUS_LABEL[status];
  return (
    <span
      data-testid={testId}
      data-status={status}
      data-tone={tone}
      className={cx('inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-label-md font-semibold', TONE[tone])}
    >
      {status === 'APPROVED' && !renewal ? <Icon name="check" size="sm" weight="bold" /> : null}
      {label}
    </span>
  );
}

/**
 * "Restaurant now": the seal the restaurant carries today, from `profile.halal` only. A profile
 * with no halal object, or no display state in it, draws nothing.
 */
export function RestaurantHalalBadge({
  halal,
  size = 'md',
  testId = 'RestaurantHalalBadge',
}: {
  halal: Schema['HalalBadge'] | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  testId?: string;
}): React.JSX.Element | null {
  const state = halal?.display_state;
  if (!state) return null;
  return (
    <HalalBadge
      state={state}
      surface="operational"
      size={size}
      certifyingBodyName={halal.certifying_body_name ?? null}
      expiresOn={halal.expires_on ?? null}
      testId={testId}
    />
  );
}

/** "14 Jan 2027" for a wire date, or "" when there is none. */
export function longDateOrEmpty(value: string | null | undefined): string {
  return value ? formatLongDate(value) : '';
}
