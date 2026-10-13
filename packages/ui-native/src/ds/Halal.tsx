import type { HalalDisplayState } from '@hg/api-client';

import { HalalBadge as LegacyHalalBadge } from '../certification/HalalBadge';
import { isHalalDisplayState } from '../certification/internal/labels';
import { reportClientError } from '../certification/internal/reportClientError';
import {
  type Certification,
  HalalCertificationPanel as LegacyHalalCertificationPanel,
} from '../certification/HalalCertificationPanel';
import { type DsCommon, resolveTestId } from './shared';

export type { HalalDisplayState };

/* ───── HalalBadge ───── */

interface HalalBadgeCommon extends DsCommon {
  /** Straight from the payload. null / undefined / unknown render NOTHING and report HALAL_DISPLAY_STATE_MISSING. */
  state: HalalDisplayState | null | undefined;
  /** sm 20 · md 24 (default, cards) · lg 32 (detail header). */
  size?: 'sm' | 'md' | 'lg';
  /** Included in the client-error report. */
  restaurantId?: string;
  /** detail surface: extends the accessible name with who certified. */
  certifyingBodyName?: string | null;
  /** Wire date; EXPIRING_SOON shows "Halal certified · expires 14 Oct". Never invented. */
  expiresOn?: string | null;
}

/**
 * The four contract states are the entire API: no colour, label, variant or icon prop.
 * onPress is admissible ONLY on the detail surface.
 */
export type HalalBadgeProps =
  | (HalalBadgeCommon & { surface?: 'card' | 'operational'; onPress?: never })
  | (HalalBadgeCommon & { surface: 'detail'; onPress?: () => void });

/** The server's halal display state rendered as a seal; a missing state renders nothing. */
export function HalalBadge(props: HalalBadgeProps) {
  const { testId: _t, testID: _T, ...rest } = props;
  return <LegacyHalalBadge {...rest} testID={resolveTestId(props, 'HalalBadge')} />;
}

/* ───── HalalCertificationPanel ───── */

/** The API's CertificationPanel payload, passed through unchanged. */
export type CertificationPanel = Certification;

interface PanelBase extends DsCommon {
  restaurantId: string;
  /** Opens the certificate through a per-request short-lived link. */
  onViewCertificate?: () => void;
  /** Opens the grievance flow with category HALAL_CONCERN. */
  onReportConcern?: () => void;
  /** Accepted for API parity (web heading level). */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
}

/** Props of the live `HalalCertificationPanel`: loading, error or ready. */
export type HalalCertificationPanelProps =
  | (PanelBase & { status: 'loading' })
  | (PanelBase & { status: 'error'; errorMessage?: string; errorCode?: string; onRetry?: () => void })
  | (PanelBase & { status?: 'ready'; certification: CertificationPanel });

/**
 * Renders nothing when display_state is missing or unknown (reported), and nothing for
 * UNVERIFIED — the live rule. The legacy panel still draws its tinted frame around a missing
 * state; this surface never does, because silence is never consent on a halal claim.
 */
export function HalalCertificationPanel(props: HalalCertificationPanelProps) {
  const testID = resolveTestId(props, 'HalalCertificationPanel');
  const { restaurantId, onViewCertificate, onReportConcern, style } = props;
  const common = { restaurantId, onViewCertificate, onReportConcern, style, testID };
  if (props.status === 'loading') return <LegacyHalalCertificationPanel {...common} loading />;
  if (props.status === 'error') {
    return (
      <LegacyHalalCertificationPanel {...common} errorCode={props.errorCode ?? 'UNKNOWN'} onRetry={props.onRetry} />
    );
  }
  const state = props.certification?.display_state;
  if (!isHalalDisplayState(state)) {
    reportClientError('CERTIFICATION_PANEL_STATE_MISSING', { restaurantId, state: String(state) });
    return null;
  }
  if (state === 'UNVERIFIED') return null;
  return <LegacyHalalCertificationPanel {...common} certification={props.certification} />;
}
