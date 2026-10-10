/**
 * `HalalCertificationPanel` — the proof: one per restaurant page, above the menu (live
 * `index.d.ts`, `HalalCertificationPanel/README.md`, 02-components.md §13). It renders the API's
 * `CertificationPanel` payload and nothing else.
 *
 * In order: the HalalBadge (lg, detail surface); "Certified by {body}", verbatim and never ranked;
 * the certificate number, Issued and "Valid until {absolute date}" in `<time>`; for EXPIRING_SOON
 * only, the renewal note on the amber tint (a note, not an alert); the scope in plain English;
 * "View certificate" (tertiary, and it says opening it is recorded); the standing line
 * (`disclaimer`), always; "Report a halal concern" (ghost).
 *
 * - **Invariant 8.** A missing or unknown `display_state` renders **nothing** and reports
 *   `HALAL_DISPLAY_STATE_MISSING`; `UNVERIFIED` renders nothing (an uncertified kitchen is
 *   invisible). There is no default state and no `{date}` placeholder.
 * - `certificate_viewable=false`: "View certificate" is absent and the panel says the image is
 *   not available to view (customer `Cert-not-viewable`).
 * - **Loading** reserves the seal's silhouette with a skeleton, never a spinner in the seal slot.
 *   **Error** keeps the panel, offers Retry and draws **no seal**.
 * - **Invariant 9.** EXPIRED uses the slate tint, never red.
 * - A11y: `role="region"` named by the visible "Halal certification" heading (`headingLevel`).
 *
 * Additions (plan/design-system.md row 22, restaurant WP10): `variant="restaurant"` for the
 * restaurant's own settings card (no concern link, no "recorded" note, "Expires" wording) and
 * `density="compact"` (seal, body, number, expiry, View certificate and the standing line) for
 * when a renewal note sits above it.
 */

import { useEffect, useId, type CSSProperties, type ReactNode } from 'react';
import type { Schema } from '@hg/api-client';

import { reportHalalClientError } from '../certification/index.js';
import { cn } from '../lib/utils.js';
import { Skeleton } from '../proposed/Skeleton.js';
import { Button } from './Button.js';
import { HalalBadge } from './HalalBadge.js';
import { formatHalalLongDate, isHalalDisplayState } from './halal-labels.js';
import { HalalShield } from './HalalShield.js';
import { KeyValueList, type KeyValueItem } from './KeyValueList.js';

/** The API's `CertificationPanel` payload, passed through unchanged. */
export type CertificationPanelData = Schema['CertificationPanel'];

interface PanelBase {
  restaurantId: string;
  /** Opens DocumentViewer via a per-request presigned GET (TTL 300 s, audited). */
  onViewCertificate?: () => void;
  /** Opens the grievance flow with category HALAL_CONCERN (customer variant only). */
  onReportConcern?: () => void;
  /** Level of the visible "Halal certification" heading (default 2). */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  /** customer (default) · restaurant: the restaurant's own settings card. */
  variant?: 'customer' | 'restaurant';
  /** compact: seal, body, number, expiry, View certificate and the standing line only. */
  density?: 'default' | 'compact';
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
  /** Layout only. */
  className?: string;
}

/** Props of the live `HalalCertificationPanel` (index.d.ts), plus `variant` and `density`. */
export type HalalCertificationPanelProps =
  | (PanelBase & { status: 'loading' })
  | (PanelBase & { status: 'error'; errorMessage?: string; onRetry?: () => void })
  | (PanelBase & { status?: 'ready'; certification: CertificationPanelData | null | undefined });

const SCOPE_TEXT: Readonly<Record<Schema['HalalCertificateScope'], string>> = {
  WHOLE_ESTABLISHMENT: 'This certificate covers the whole establishment.',
  KITCHEN_ONLY: 'This certificate covers the kitchen only.',
  SPECIFIC_MENU_ITEMS: 'This certificate covers specific menu items only.',
  SUPPLIER_CHAIN_ONLY: 'This certificate covers the supplier chain only.',
};

/** Customer `Cert-not-viewable`: said in place of the button, never a dead button. */
export const CERTIFICATE_NOT_VIEWABLE_COPY =
  'The certificate image isn’t available to view. The details above are what HalalGoes verified.';

/** The certification section for a restaurant, or nothing when there is no state to show. */
export function HalalCertificationPanel(props: HalalCertificationPanelProps) {
  const {
    restaurantId,
    onViewCertificate,
    onReportConcern,
    headingLevel = 2,
    variant = 'customer',
    density = 'default',
    testId = 'HalalCertificationPanel',
    style,
    className,
  } = props;
  const status = props.status ?? 'ready';
  const certification = 'certification' in props ? props.certification : undefined;
  const state = certification?.display_state;
  const known = isHalalDisplayState(state);
  const headingId = `hg-halal-certification-${useId()}`;

  useEffect(() => {
    if (status === 'ready' && !known) {
      reportHalalClientError('HALAL_DISPLAY_STATE_MISSING', { restaurantId, received: state, surface: 'panel' });
    }
  }, [status, known, state, restaurantId]);

  if (status === 'ready' && (!known || state === 'UNVERIFIED' || !certification)) return null;

  const expired = status === 'ready' && state === 'EXPIRED';
  const level = Math.min(6, Math.max(1, headingLevel));
  const Heading = `h${level}` as 'h2';

  const shell = (children: ReactNode, busy = false) => (
    <section
      role="region"
      aria-labelledby={headingId}
      aria-busy={busy || undefined}
      data-testid={testId}
      data-status={status}
      data-variant={variant}
      style={style}
      className={cn(
        'flex flex-col gap-4 rounded-lg border p-5 font-ui text-fg-primary',
        expired
          ? 'border-halal-expired-border bg-halal-expired-tint'
          : 'border-halal-certified-tint-border bg-halal-certified-tint',
        className,
      )}
    >
      <Heading
        id={headingId}
        className={cn('m-0 text-heading-lg', expired ? 'text-halal-expired-text' : 'text-halal-certified-tint-text')}
      >
        Halal certification
      </Heading>
      {children}
    </section>
  );

  if (status === 'loading') {
    return shell(
      <>
        <span data-testid={`${testId}-seal-slot`} className="block">
          <Skeleton shape="rect" width={160} height={32} />
        </span>
        <Skeleton shape="text" width="66%" />
        <Skeleton shape="text" width="50%" />
        <p className="sr-only">Loading halal certification details.</p>
      </>,
      true,
    );
  }

  if (status === 'error') {
    const { errorMessage, onRetry } = props as Extract<HalalCertificationPanelProps, { status: 'error' }>;
    return shell(
      <div role="alert" className="flex flex-col items-start gap-3">
        <p className="m-0 text-body-md">{errorMessage ?? 'Couldn’t load certification details.'}</p>
        <p className="m-0 text-body-sm text-fg-secondary">We won’t show a certification state we can’t confirm right now.</p>
        {onRetry ? (
          <Button variant="tertiary" iconStart="refresh" onPress={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>,
    );
  }

  const c = certification as CertificationPanelData;
  const compact = density === 'compact';
  const restaurant = variant === 'restaurant';
  const issued = formatHalalLongDate(c.issued_on);
  const expires = formatHalalLongDate(c.expires_on);
  const verified = formatHalalLongDate(c.verified_at);
  const standing =
    c.disclaimer ||
    (verified
      ? `Certification verified by HalalGoes on ${verified}. HalalGoes does not itself certify food.`
      : 'HalalGoes does not itself certify food.');

  const facts: KeyValueItem[] = [];
  if (c.certificate_number) facts.push({ key: 'number', label: 'Certificate', value: c.certificate_number, mono: true });
  if (issued && !compact) facts.push({ key: 'issued', label: 'Issued', value: <time dateTime={c.issued_on ?? undefined}>{issued}</time> });
  if (expires) {
    facts.push({
      key: 'expires',
      label: restaurant ? 'Expires' : 'Valid until',
      value: (
        <time dateTime={c.expires_on ?? undefined} data-testid={`${testId}-expiry`}>
          {expires}
        </time>
      ),
    });
  }

  return shell(
    <>
      <div>
        <HalalBadge
          state={c.display_state}
          size="lg"
          surface="detail"
          restaurantId={restaurantId}
          certifyingBodyName={c.certifying_body_name}
          expiresOn={c.expires_on}
        />
      </div>
      {c.certifying_body_name ? (
        <p className="m-0 text-heading-sm" data-testid={`${testId}-body`}>
          Certified by {c.certifying_body_name}
        </p>
      ) : null}
      {facts.length ? <KeyValueList items={facts} labelWidth="max-content" testId={`${testId}-facts`} /> : null}
      {state === 'EXPIRING_SOON' && expires && !compact ? (
        <p
          data-testid={`${testId}-renewal-note`}
          className="m-0 flex items-center gap-2 rounded-md border border-halal-expiring-border bg-halal-expiring-tint p-3 text-body-sm text-halal-expiring-text"
        >
          <span className="inline-flex text-halal-expiring-icon">
            <HalalShield variant="solid-clock" knockout="var(--hg-color-halal-expiring-tint)" testId={`${testId}-renewal-shield`} />
          </span>
          <span>
            {restaurant ? 'Your certificate expires on ' : 'Certificate renews '}
            <time dateTime={c.expires_on ?? undefined}>{expires}</time>.
          </span>
        </p>
      ) : null}
      {c.scope && SCOPE_TEXT[c.scope] && !compact ? (
        <p className="m-0 text-body-sm text-fg-secondary" data-testid={`${testId}-scope`}>
          {SCOPE_TEXT[c.scope]}
        </p>
      ) : null}
      {c.certificate_viewable === false ? (
        <p className="m-0 text-body-sm text-fg-secondary" data-testid={`${testId}-not-viewable`}>
          {CERTIFICATE_NOT_VIEWABLE_COPY}
        </p>
      ) : onViewCertificate ? (
        <div>
          <Button variant="tertiary" onPress={onViewCertificate} testId={`${testId}-view`}>
            View certificate
            {/* A viewer that silently logs identity is a dark pattern; restaurants viewing their own are not logged. */}
            {restaurant ? null : <span className="sr-only"> — opening this is recorded</span>}
          </Button>
        </div>
      ) : null}
      <p className="m-0 text-caption text-fg-secondary" data-testid={`${testId}-disclaimer`}>
        {standing}
      </p>
      {onReportConcern && !restaurant && !compact ? (
        <div>
          <Button variant="ghost" onPress={onReportConcern} testId={`${testId}-report`}>
            Report a halal concern
          </Button>
        </div>
      ) : null}
    </>,
  );
}
