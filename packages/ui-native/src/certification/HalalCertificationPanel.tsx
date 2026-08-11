/**
 * `HalalCertificationPanel` — the always-reachable certification section on the restaurant
 * detail page, above the menu (C-12 surface 2).
 *
 * The panel sits above the menu because the certification is read *before* the food, not
 * after; it is also the first landmark after the header, so a screen-reader user reaches it
 * by heading navigation without traversing forty menu items (04-accessibility.md §3.5).
 *
 * Two behaviours here are load-bearing and easy to get wrong:
 *
 *  - **Loading reserves the seal's silhouette at full size and never shows a spinner where
 *    the seal will be.** A briefly-empty certification area on a trust product reads as
 *    "no certification".
 *  - **On error the panel does not disappear and draws no seal.** No cached, defaulted or
 *    list-payload state is trusted; the rest of the page still renders.
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { Schema } from '@hg/api-client';

import { ErrorState } from '../feedback';
import { Button, Skeleton } from '../primitives';
import { HalalBadge } from './HalalBadge';
import { HalalRenewalGlyph } from './internal/HalalShield';
import { panelPalette, renewalNotePalette } from './internal/halalTokens';
import { SCOPE_LABEL, formatAbsoluteDate, standingDisclaimer } from './internal/labels';
import { reportClientError } from './internal/reportClientError';
import { radius, space, useTheme, useTypeStyle } from './internal/theme';

/** The server's own panel projection. Never redeclared here. */
export type Certification = Schema['CertificationPanel'];

export interface HalalCertificationPanelProps {
  restaurantId: string;
  /** Absent while `loading`, or when the certification endpoint failed. */
  certification?: Certification | null;
  /** `GET /restaurants/:id/certification` is a separate call from detail (C-12 R8). */
  loading?: boolean;
  /** The contract's stable `error.code`. Copy is keyed off it, never off `error.message`. */
  errorCode?: string | null;
  onRetry?: () => void;
  /** Opens `DocumentViewer` through a per-request presigned GET, TTL 300 s, audited. */
  onViewCertificate?: () => void;
  /** Opens the C-39 grievance flow with category `HALAL_CONCERN` pre-set. */
  onReportConcern?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const HEADING = 'Halal certification';

export function HalalCertificationPanel({
  restaurantId,
  certification,
  loading = false,
  errorCode,
  onRetry,
  onViewCertificate,
  onReportConcern,
  style,
  testID = 'HalalCertificationPanel',
}: HalalCertificationPanelProps): React.ReactElement {
  const theme = useTheme();
  const headingType = useTypeStyle('heading.sm');
  const captionType = useTypeStyle('caption');
  const palette = panelPalette(theme.scheme);
  const headingId = `${testID}-heading`;

  const hasError = !loading && (!!errorCode || !certification);
  const stateMissing = !loading && !errorCode && !!certification && !certification.display_state;

  React.useEffect(() => {
    if (stateMissing) {
      reportClientError('CERTIFICATION_PANEL_STATE_MISSING', { restaurantId });
    }
  }, [stateMissing, restaurantId]);

  return (
    <View
      testID={testID}
      style={[
        styles.root,
        {
          backgroundColor: palette.tint,
          borderColor: palette.tintBorder,
          borderRadius: radius.lg,
          padding: theme.density.cardPadding,
          rowGap: space['3'],
        },
        style,
      ]}
      // A landmark: it appears in the landmark list and in the heading list, and the heading
      // it points at is visually present rather than screen-reader-only.
      role="region"
      accessibilityLabel={HEADING}
      aria-labelledby={headingId}
      accessibilityLabelledBy={headingId}
    >
      <Text
        nativeID={headingId}
        accessibilityRole="header"
        style={[headingType, { color: palette.tintText }]}
      >
        {HEADING}
      </Text>

      {loading ? (
        <PanelSkeleton testID={testID} />
      ) : hasError ? (
        <ErrorState
          testID={`${testID}-error`}
          variant="inline"
          errorCode={errorCode ?? undefined}
          title="Couldn't load certification details"
          onRetry={onRetry}
        />
      ) : (
        <PanelBody
          certification={certification as Certification}
          restaurantId={restaurantId}
          onViewCertificate={onViewCertificate}
          onReportConcern={onReportConcern}
          testID={testID}
        />
      )}

      {/*
        C-12 R7. Always present, never collapsible — including in the loading and error
        states, because "Halal Goes does not itself certify food" is a statement about the
        platform, not about this restaurant's payload.
      */}
      <Text testID={`${testID}-disclaimer`} style={[captionType, { color: theme.color.text.tertiary }]}>
        {standingDisclaimer(certification?.verified_at ?? null)}
      </Text>
    </View>
  );
}

/* -------------------------------------------------------------------- body */

function PanelBody({
  certification,
  restaurantId,
  onViewCertificate,
  onReportConcern,
  testID,
}: {
  certification: Certification;
  restaurantId: string;
  onViewCertificate?: () => void;
  onReportConcern?: () => void;
  testID: string;
}): React.ReactElement {
  const theme = useTheme();
  const headingType = useTypeStyle('heading.sm');
  const bodyType = useTypeStyle('body.sm');
  const state = certification.display_state;

  return (
    <View style={{ rowGap: space['3'] }}>
      <HalalBadge
        testID={`${testID}-badge`}
        state={state}
        size="lg"
        surface="detail"
        restaurantId={restaurantId}
        certifyingBodyName={certification.certifying_body_name}
        expiresOn={certification.expires_on}
      />

      {/*
        Certifying body: free text, exactly as the admin verified it. Never ranked, scored,
        annotated or linked to a rating (C-12 R6) — the customer applies their own standard,
        so they are told who certified it, and nothing more.
      */}
      {certification.certifying_body_name ? (
        <Text
          testID={`${testID}-body-name`}
          style={[headingType, { color: theme.color.text.primary }]}
        >
          {certification.certifying_body_name}
        </Text>
      ) : null}

      <View style={{ rowGap: space['1'] }}>
        {certification.certificate_number ? (
          <DetailLine label="Certificate number" value={certification.certificate_number} mono />
        ) : null}
        {certification.issued_on ? (
          <DetailLine label="Issued" value={formatAbsoluteDate(certification.issued_on)} />
        ) : null}
        {certification.expires_on ? (
          // Absolute, always: "Valid until 14 March 2027", never "expires in 7 months".
          <DetailLine label="Valid until" value={formatAbsoluteDate(certification.expires_on)} />
        ) : null}
      </View>

      {/*
        Rendered only for EXPIRING_SOON. It is a renewal signal for transparency, not a
        warning: the certificate is valid today, which is exactly why it uses the reserved
        brass-ochre tint and not the semantic warning orange.
      */}
      {state === 'EXPIRING_SOON' && certification.expires_on ? (
        <RenewalNote expiresOn={certification.expires_on} testID={testID} />
      ) : null}

      {certification.scope ? (
        <Text style={[bodyType, { color: theme.color.text.secondary }]}>
          {SCOPE_LABEL[certification.scope] ?? 'Scope recorded by the certifier'}
        </Text>
      ) : null}

      {onViewCertificate && certification.certificate_viewable !== false ? (
        <Button
          testID={`${testID}-view`}
          variant="tertiary"
          onPress={onViewCertificate}
          // A viewer that silently logs identity is a dark pattern regardless of how
          // legitimate the audit is, so the action itself says that it is recorded.
          accessibilityHint="Opening the certificate is recorded."
        >
          View certificate
        </Button>
      ) : null}

      {onReportConcern ? (
        <Button testID={`${testID}-concern`} variant="ghost" onPress={onReportConcern}>
          Report a halal concern
        </Button>
      ) : null}
    </View>
  );
}

function DetailLine({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.ReactElement {
  const theme = useTheme();
  const labelType = useTypeStyle('body.sm');
  const valueType = useTypeStyle(mono ? 'mono.md' : 'body.sm');
  return (
    <View style={styles.detailLine} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[labelType, { color: theme.color.text.secondary }]}>{label}</Text>
      <Text style={[valueType, { color: theme.color.text.primary }]}>{value}</Text>
    </View>
  );
}

function RenewalNote({
  expiresOn,
  testID,
}: {
  expiresOn: string;
  testID: string;
}): React.ReactElement {
  const theme = useTheme();
  const bodyType = useTypeStyle('body.sm');
  const note = renewalNotePalette(theme.scheme);
  const copy = `Certificate renews ${formatAbsoluteDate(expiresOn)}`;
  return (
    <View
      testID={`${testID}-renewalNote`}
      accessible
      accessibilityLabel={copy}
      style={[
        styles.renewalNote,
        {
          backgroundColor: note.tint,
          borderColor: note.border,
          borderRadius: radius.sm,
          padding: space['3'],
          columnGap: space['2'],
        },
      ]}
    >
      <HalalRenewalGlyph color={note.icon} size={20} />
      <Text style={[bodyType, { color: note.text, flexShrink: 1 }]}>{copy}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ loading */

/**
 * The seal's slot is reserved at `lg` size. A panel that reflows when the badge arrives
 * makes the badge feel like an afterthought — and for the two hundred milliseconds before
 * it lands, a trust product has shown a certification area with nothing in it.
 */
function PanelSkeleton({ testID }: { testID: string }): React.ReactElement {
  return (
    <View testID={`${testID}-skeleton`} aria-busy style={{ rowGap: space['3'] }}>
      {/* Seal silhouette at full lg geometry — never a spinner in this slot. */}
      <Skeleton variant="rect" width={168} height={32} testID={`${testID}-skeleton-seal`} />
      <Skeleton variant="text" lines={3} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    borderWidth: 1,
  },
  detailLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    columnGap: 12,
  },
  renewalNote: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
});
