import * as React from 'react';
import type { HalalDisplayState } from '@hg/api-client';

import {
  ACCESSIBLE_LABEL,
  SCOPE_LABEL,
  VISIBLE_LABEL,
  detailAccessibleLabel,
  isHalalDisplayState,
  standingDisclaimer,
} from '../certification/internal/labels';
import { reportClientError } from '../certification/internal/reportClientError';
import type { Certification } from '../certification/HalalCertificationPanel';
import { KeyValueList, Skeleton, Text } from '../lib';
import { formatLongDate, formatShortDate, parseWireDate } from '../lib/halal-dates';
import { HalalSeal, type HalalLook } from '../lib/ui/halal-badge';
import { HalalPanelFrame, HalalRenewalNote, HalalStatusLayout } from '../lib/ui/halal-panel';
import { useTheme } from '../tokens';
import { Button } from './Button';
import { Badge } from './Content';
import { type DsCommon, resolveTestId } from './shared';

/*
 * The halal family (design-system N4), rendered by the React Native Reusables tier
 * (`lib/ui/halal-*.tsx`). This file keeps React's own JSX runtime and decides everything a
 * halal surface may say: which state is drawn, on which surface, and with which words. Every word
 * comes from the fixed tables in `certification/internal/labels.ts` (shared with the legacy
 * badge), plus the expiring short date, which is shown only when `expiresOn` parses.
 *
 * Invariants (AGENTS.md#3-non-negotiable-invariants):
 *   8  a missing or unknown state draws nothing and is reported; there is no "assume certified";
 *   9  no halal render paints a danger colour, in either scheme or theme (slate, never red);
 *   10 the seal green is painted only by the CERTIFIED seal.
 */

export type { HalalDisplayState };

/** The look each contract state draws (the live `RENDER_KEY`). */
const LOOK: Readonly<Record<HalalDisplayState, HalalLook>> = {
  CERTIFIED: 'certified',
  EXPIRING_SOON: 'expiring',
  EXPIRED: 'expired',
  UNVERIFIED: 'unverified',
};

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

/** Visible words and spoken name for a drawn state, from the fixed tables. */
export function halalBadgeLabels(input: {
  state: HalalDisplayState;
  surface: 'card' | 'operational' | 'detail';
  certifyingBodyName?: string | null;
  expiresOn?: string | null;
  pressable: boolean;
}): { label: string; name: string } {
  const { state, surface, certifyingBodyName, pressable } = input;
  // Only a date that parses is ever shown or spoken; anything else is treated as absent.
  const expiresOn = parseWireDate(input.expiresOn) ? input.expiresOn : null;
  const tap = pressable ? ' Double tap for certificate details.' : '';
  if (state === 'EXPIRING_SOON') {
    const short = formatShortDate(expiresOn);
    const long = formatLongDate(expiresOn);
    const label = short ? `${VISIBLE_LABEL.EXPIRING_SOON} · expires ${short}` : VISIBLE_LABEL.EXPIRING_SOON;
    let name: string = ACCESSIBLE_LABEL.EXPIRING_SOON;
    if (surface === 'detail' && certifyingBodyName) name = `${ACCESSIBLE_LABEL.EXPIRING_SOON} by ${certifyingBodyName}.`;
    else if (long) name = `${ACCESSIBLE_LABEL.EXPIRING_SOON}.`;
    if (long) name += ` Expires ${long}.`;
    return { label, name: name + tap };
  }
  const name =
    surface === 'detail'
      ? detailAccessibleLabel({ state, certifyingBodyName, expiresOn, pressable })
      : ACCESSIBLE_LABEL[state];
  return { label: VISIBLE_LABEL[state], name };
}

/** The server's halal display state rendered as a seal; a missing state renders nothing. */
export function HalalBadge(props: HalalBadgeProps) {
  const { state, size = 'md', surface = 'card', restaurantId, certifyingBodyName, expiresOn, style } = props;
  const theme = useTheme();
  const known = isHalalDisplayState(state);
  React.useEffect(() => {
    if (!known) reportClientError('HALAL_DISPLAY_STATE_MISSING', { restaurantId, surface, received: String(state) });
  }, [known, state, restaurantId, surface]);

  if (!known) return null;
  // An uncertified kitchen is invisible to customers; only operational surfaces say "Not verified".
  if (state === 'UNVERIFIED' && surface !== 'operational') return null;

  const onPress = surface === 'detail' && typeof props.onPress === 'function' ? props.onPress : undefined;
  const { label, name } = halalBadgeLabels({ state, surface, certifyingBodyName, expiresOn, pressable: !!onPress });
  return (
    <HalalSeal
      look={LOOK[state]}
      size={size}
      label={label}
      accessibilityLabel={name}
      onPress={onPress}
      minTarget={theme.target.min}
      style={style}
      testID={resolveTestId(props, 'HalalBadge')}
    />
  );
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

/** The fixed copy of the panel (live HalalCertificationPanel and the customer canvases). */
export const HALAL_PANEL_COPY = {
  heading: 'Halal certification',
  loading: 'Loading certification details…',
  error: 'Couldn’t load certification details.',
  errorNote: 'We won’t show a certification state we can’t confirm right now.',
  retry: 'Retry',
  viewCertificate: 'View certificate',
  viewCertificateHint: 'Opening the certificate is recorded.',
  /** `certificate_viewable` is false: the API gives no reason, so none is invented. */
  notViewable: 'The certificate image isn’t available to view. The details above are what HalalGoes verified.',
  reportConcern: 'Report a halal concern',
  scopeFallback: 'Scope recorded by the certifier',
} as const;

/**
 * Renders nothing when display_state is missing or unknown (reported), and nothing for
 * UNVERIFIED — the live rule. Silence is never consent on a halal claim, so there is no frame
 * around a state the panel cannot name.
 */
export function HalalCertificationPanel(props: HalalCertificationPanelProps) {
  const testID = resolveTestId(props, 'HalalCertificationPanel');
  const { restaurantId, onViewCertificate, onReportConcern, style } = props;
  const theme = useTheme();
  const ready = props.status !== 'loading' && props.status !== 'error';
  const state = ready ? (props as { certification?: CertificationPanel }).certification?.display_state : undefined;
  const missing = ready && !isHalalDisplayState(state);
  React.useEffect(() => {
    if (missing) reportClientError('CERTIFICATION_PANEL_STATE_MISSING', { restaurantId, state: String(state) });
  }, [missing, restaurantId, state]);

  const frame = (tone: 'certified' | 'expired' | 'neutral', busy: boolean, children: React.ReactNode) => (
    <HalalPanelFrame
      tone={tone}
      heading={HALAL_PANEL_COPY.heading}
      busy={busy}
      padding={theme.density.cardPadding}
      style={style}
      testID={testID}
    >
      {children}
    </HalalPanelFrame>
  );
  // C-12 R7: the standing line is a statement about the platform, so it is there in every state.
  const standing = (line: string) => (
    <Text testID={`${testID}-disclaimer`} variant="caption" tone="secondary">
      {line}
    </Text>
  );

  if (props.status === 'loading') {
    // Neutral, not the certified tint: nothing is verified yet, so the frame makes no claim.
    return frame(
      'neutral',
      true,
      <>
        {/* The seal's slot at full lg size: never a spinner where the seal will be. */}
        <Skeleton variant="rect" width={160} height={32} testID={`${testID}-skeleton-seal`} />
        <Skeleton variant="text" lines={2} />
        <Text variant="body.sm" tone="secondary">
          {HALAL_PANEL_COPY.loading}
        </Text>
        {standing(standingDisclaimer(null))}
      </>,
    );
  }
  if (props.status === 'error') {
    // The panel stays, neutral, and draws no seal: no cached or defaulted state is trusted.
    return frame(
      'neutral',
      false,
      <>
        <Text testID={`${testID}-error`} accessibilityRole="alert" variant="body.md">
          {props.errorMessage ?? HALAL_PANEL_COPY.error}
        </Text>
        <Text variant="body.sm" tone="secondary">
          {HALAL_PANEL_COPY.errorNote}
        </Text>
        {props.onRetry ? (
          <Button variant="tertiary" iconStart="refresh" onPress={props.onRetry} testID={`${testID}-retry`}>
            {HALAL_PANEL_COPY.retry}
          </Button>
        ) : null}
        {standing(standingDisclaimer(null))}
      </>,
    );
  }
  if (missing || state === 'UNVERIFIED') return null;

  const c = (props as { certification: CertificationPanel }).certification;
  const issued = formatLongDate(c.issued_on);
  const expires = formatLongDate(c.expires_on);
  const verified = formatLongDate(c.verified_at);
  return frame(
    state === 'EXPIRED' ? 'expired' : 'certified',
    false,
    <>
      <HalalBadge
        testID={`${testID}-badge`}
        state={state}
        size="lg"
        surface="detail"
        restaurantId={restaurantId}
        certifyingBodyName={c.certifying_body_name}
        expiresOn={c.expires_on}
      />
      {/* Verbatim, never ranked or rated (C-12 R6): the customer applies their own standard. */}
      {c.certifying_body_name ? (
        <Text testID={`${testID}-body`} variant="heading.sm">
          {`Certified by ${c.certifying_body_name}`}
        </Text>
      ) : null}
      <KeyValueList
        testID={`${testID}-details`}
        labelWidth={128}
        rows={[
          !!c.certificate_number && { label: 'Certificate number', value: c.certificate_number, mono: true },
          !!issued && { label: 'Issued', value: issued },
          // Absolute, always: "Valid until 14 March 2027", never "expires in 7 months".
          !!expires && { label: 'Valid until', value: expires },
          !!verified && { label: 'Verified by HalalGoes', value: verified },
        ]}
      />
      {state === 'EXPIRING_SOON' && expires ? (
        <HalalRenewalNote text={`Certificate renews ${expires}.`} testID={`${testID}-renewalNote`} />
      ) : null}
      {c.scope ? (
        <Text testID={`${testID}-scope`} variant="body.sm" tone="secondary">
          {SCOPE_LABEL[c.scope] ?? HALAL_PANEL_COPY.scopeFallback}
        </Text>
      ) : null}
      {c.certificate_viewable === false ? (
        <Text testID={`${testID}-notViewable`} variant="body.sm" tone="secondary">
          {HALAL_PANEL_COPY.notViewable}
        </Text>
      ) : onViewCertificate ? (
        <Button
          testID={`${testID}-view`}
          variant="tertiary"
          onPress={onViewCertificate}
          // A viewer that silently logs identity is a dark pattern, so the action says it is recorded.
          accessibilityHint={HALAL_PANEL_COPY.viewCertificateHint}
        >
          {HALAL_PANEL_COPY.viewCertificate}
        </Button>
      ) : null}
      {standing(c.disclaimer || standingDisclaimer(parseWireDate(c.verified_at) ? c.verified_at : null))}
      {onReportConcern ? (
        <Button testID={`${testID}-concern`} variant="ghost" onPress={onReportConcern}>
          {HALAL_PANEL_COPY.reportConcern}
        </Button>
      ) : null}
    </>,
  );
}

/* ───── RestaurantHalalStatus (proposed) ───── */

/** Props of the proposed `RestaurantHalalStatus` (customer restaurant page, canvas D5). */
export interface RestaurantHalalStatusProps extends DsCommon {
  /** `halal.display_state` from the restaurant payload. */
  state: HalalDisplayState | null | undefined;
  restaurantId?: string;
  /** Used in the "View certification" name ("… halal certificate for Zaytoun Grill"). */
  restaurantName?: string;
  certifyingBodyName?: string | null;
  expiresOn?: string | null;
  /** Opens the certification sheet. */
  onViewCertification?: () => void;
  /** Opens the "How we check" page. */
  onHowWeCheck?: () => void;
}

/** The fixed copy of `RestaurantHalalStatus`. */
export const RESTAURANT_HALAL_STATUS_COPY = {
  viewCertification: 'View certification',
  howWeCheck: 'How we check',
  howWeCheckName: 'How we check halal certificates',
} as const;

/**
 * The restaurant page's halal row: the seal, an expiry chip while the certificate is expiring,
 * and the links to the certification sheet and to "How we check".
 *
 * It renders ONLY when the halal fields exist (invariant 8): a missing or unknown state is
 * reported and draws nothing; a partial record (no certifying body, or no expiry date that
 * parses) draws nothing either, so the page shows its neutral "Certificate details unavailable"
 * line and no View certification link. `UNVERIFIED` draws nothing on this customer surface.
 */
export function RestaurantHalalStatus(props: RestaurantHalalStatusProps) {
  const { state, restaurantId, restaurantName, certifyingBodyName, expiresOn, onViewCertification, onHowWeCheck, style } = props;
  const testID = resolveTestId(props, 'RestaurantHalalStatus');
  const known = isHalalDisplayState(state);
  React.useEffect(() => {
    if (!known) reportClientError('HALAL_DISPLAY_STATE_MISSING', { restaurantId, surface: 'status', received: String(state) });
  }, [known, state, restaurantId]);

  if (!known || state === 'UNVERIFIED') return null;
  const expires = formatLongDate(expiresOn);
  if (!certifyingBodyName || !expires) return null;

  const viewName = restaurantName
    ? `${RESTAURANT_HALAL_STATUS_COPY.viewCertification}: halal certificate for ${restaurantName}`
    : undefined;
  const links =
    onViewCertification || onHowWeCheck ? (
      <>
        {onViewCertification ? (
          <Button variant="ghost" size="sm" onPress={onViewCertification} accessibilityLabel={viewName} testID={`${testID}-view`}>
            {RESTAURANT_HALAL_STATUS_COPY.viewCertification}
          </Button>
        ) : null}
        {onHowWeCheck ? (
          <Button
            variant="ghost"
            size="sm"
            onPress={onHowWeCheck}
            accessibilityLabel={RESTAURANT_HALAL_STATUS_COPY.howWeCheckName}
            testID={`${testID}-how`}
          >
            {RESTAURANT_HALAL_STATUS_COPY.howWeCheck}
          </Button>
        ) : null}
      </>
    ) : undefined;
  return (
    <HalalStatusLayout
      testID={testID}
      style={style}
      seal={
        <>
          <HalalBadge
            state={state}
            size="md"
            restaurantId={restaurantId}
            expiresOn={expiresOn}
            testID={`${testID}-badge`}
          />
          {state === 'EXPIRING_SOON' ? (
            <Badge variant="neutral" icon="clock" testID={`${testID}-expiry`}>
              {`Valid until ${expires}`}
            </Badge>
          ) : null}
        </>
      }
      links={links}
    />
  );
}
