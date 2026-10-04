/**
 * `HalalCertificationPanel` — component 13, `02-components.md` Tier 2.
 *
 * The always-reachable certification section on the restaurant detail page (C-12 surface 2). It
 * is a landmark, it sits above the menu, and it is reachable by heading navigation from the top
 * of the page: a screen-reader user must not have to pass forty menu items to reach the one
 * claim the product exists to make (`04-accessibility.md` §3.5).
 *
 * Two states are load-bearing:
 *   - **Loading** reserves the seal's silhouette at full size and never puts a spinner where
 *     the seal will be. A briefly-empty certification area on a trust product reads as "no
 *     certification".
 *   - **Error** does not remove the panel. It says the details could not be loaded and offers
 *     Retry, and it draws **no seal**: no cached or defaulted certification state is ever
 *     trusted (C-12 R4).
 *
 * `EXPIRING_SOON` is the only place in the system where the renewal signal appears, and it
 * appears here as a *note*, on the reserved brass-ochre tint rather than the semantic warning
 * orange. The certificate is valid today; an alert would say otherwise, and that would be false.
 */
import type { Schema } from '@hg/api-client';
import { HalalBadge } from './HalalBadge';
import { HalalShield } from './HalalShield';
import { cx, FOCUS_RING } from './internal/token-style';
import { formatAbsoluteDate, formatAbsoluteDateTime, isoAttribute } from './internal/dates';

export type CertificationPanelData = Schema['CertificationPanel'];

interface PanelBaseProps {
  restaurantId: string;
  /** Opens `DocumentViewer` against a per-request presigned GET, TTL 300 s, audited (C-12 R5). */
  onViewCertificate?: () => void;
  /** Opens the C-39 grievance flow with category `HALAL_CONCERN` pre-set. */
  onReportConcern?: () => void;
  className?: string;
}

export type HalalCertificationPanelProps =
  | (PanelBaseProps & { status: 'loading' })
  | (PanelBaseProps & { status: 'error'; errorMessage?: string; onRetry?: () => void })
  | (PanelBaseProps & { status?: 'ready'; certification: CertificationPanelData });

const SCOPE_TEXT: Readonly<Record<Schema['HalalCertificateScope'], string>> = {
  WHOLE_ESTABLISHMENT: 'This certificate covers the whole establishment.',
  KITCHEN_ONLY: 'This certificate covers the kitchen only.',
  SPECIFIC_MENU_ITEMS: 'This certificate covers specific menu items only.',
  SUPPLIER_CHAIN_ONLY: 'This certificate covers the supplier chain only.',
};

const HEADING_ID = 'hg-halal-certification-heading';

export function HalalCertificationPanel(
  props: HalalCertificationPanelProps,
): React.JSX.Element {
  const { restaurantId, onViewCertificate, onReportConcern, className } = props;
  const status = props.status ?? 'ready';

  const shell = (children: React.ReactNode, extra?: Record<string, unknown>) => (
    <section
      data-testid="HalalCertificationPanel"
      role="region"
      aria-labelledby={HEADING_ID}
      className={cx(
        'flex flex-col gap-4 rounded-lg border border-halal-certified-tint-border',
        'bg-halal-certified-tint p-4',
        className,
      )}
      {...extra}
    >
      <h2 id={HEADING_ID} className="text-heading-lg text-halal-certified-tint-text">
        Halal certification
      </h2>
      {children}
    </section>
  );

  if (status === 'loading') {
    return shell(
      <>
        {/* The seal's slot is reserved at full size — the card must not reflow when it arrives. */}
        <div
          aria-hidden="true"
          data-testid="HalalCertificationPanel-seal-slot"
          className="h-8 w-40 rounded-md bg-skeleton-base"
        />
        <div aria-hidden="true" className="h-5 w-2/3 rounded-sm bg-skeleton-base" />
        <div aria-hidden="true" className="h-5 w-1/2 rounded-sm bg-skeleton-base" />
        <p className="sr-only">Loading halal certification details.</p>
      </>,
      { 'aria-busy': true },
    );
  }

  if (status === 'error') {
    const { errorMessage, onRetry } = props as Extract<
      HalalCertificationPanelProps,
      { status: 'error' }
    >;
    return shell(
      <div role="alert" className="flex flex-col gap-3">
        <p className="text-body-md text-fg-primary">
          {errorMessage ?? 'Couldn’t load certification details.'}
        </p>
        <p className="text-body-sm text-fg-secondary">
          We won’t show a certification state we can’t confirm right now.
        </p>
        {onRetry ? (
          <button type="button" className={tertiaryButtonClass} onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </div>,
    );
  }

  const { certification } = props as Extract<
    HalalCertificationPanelProps,
    { status?: 'ready'; certification: CertificationPanelData }
  >;

  const expiresOn = formatAbsoluteDate(certification.expires_on);
  const issuedOn = formatAbsoluteDate(certification.issued_on);
  const verifiedAt = formatAbsoluteDateTime(certification.verified_at);

  return shell(
    <>
      {/* 1. The seal, at detail size, carrying the body name in its accessible label. */}
      <HalalBadge
        state={certification.display_state}
        size="lg"
        surface="detail"
        restaurantId={restaurantId}
        certifyingBodyName={certification.certifying_body_name}
        expiresOn={certification.expires_on}
      />

      {/* 2. The certifying body, verbatim. Never ranked, scored, annotated or linked to a
             rating (C-12 R6) — the customer applies their own standard, so they are told who,
             and nothing more. */}
      {certification.certifying_body_name ? (
        <p className="text-heading-sm text-fg-primary" data-testid="HalalCertificationPanel-body">
          Certified by {certification.certifying_body_name}
        </p>
      ) : null}

      {/* 3. Number, issue date, and expiry in absolute form. Never "expires in 7 months". */}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        {certification.certificate_number ? (
          <>
            <dt className="text-label-md text-fg-secondary">Certificate</dt>
            <dd className="font-mono text-mono-md text-fg-primary">
              {certification.certificate_number}
            </dd>
          </>
        ) : null}
        {issuedOn ? (
          <>
            <dt className="text-label-md text-fg-secondary">Issued</dt>
            <dd className="text-body-md text-fg-primary">
              <time dateTime={isoAttribute(certification.issued_on)}>{issuedOn}</time>
            </dd>
          </>
        ) : null}
        {expiresOn ? (
          <>
            <dt className="text-label-md text-fg-secondary">Valid until</dt>
            <dd className="text-body-md text-fg-primary" data-testid="HalalCertificationPanel-expiry">
              <time dateTime={isoAttribute(certification.expires_on)}>{expiresOn}</time>
            </dd>
          </>
        ) : null}
      </dl>

      {/* 4. The renewal note. Only for EXPIRING_SOON, and only here. */}
      {certification.display_state === 'EXPIRING_SOON' && expiresOn ? (
        <p
          data-testid="HalalCertificationPanel-renewal-note"
          className={cx(
            'flex items-center gap-2 rounded-md border border-halal-expiring-border',
            'bg-halal-expiring-tint p-3 text-body-sm text-halal-expiring-text',
          )}
        >
          <span className="text-halal-expiring-icon">
            <HalalShield variant="solid-clock" knockout="var(--hg-color-halal-expiring-tint)" />
          </span>
          <span>
            Certificate renews{' '}
            <time dateTime={isoAttribute(certification.expires_on)}>{expiresOn}</time>.
          </span>
        </p>
      ) : null}

      {/* 5. Scope, in plain English. */}
      {certification.scope ? (
        <p className="text-body-sm text-fg-secondary" data-testid="HalalCertificationPanel-scope">
          {SCOPE_TEXT[certification.scope]}
        </p>
      ) : null}

      {/* 6. View certificate. */}
      {onViewCertificate && certification.certificate_viewable !== false ? (
        <button
          type="button"
          data-testid="HalalCertificationPanel-view"
          className={tertiaryButtonClass}
          onClick={onViewCertificate}
        >
          View certificate
          {/* A viewer that silently logs identity is a dark pattern regardless of legitimacy. */}
          <span className="sr-only"> — opening this is recorded</span>
        </button>
      ) : null}

      {/* 7. The standing line. Always present, never collapsible (C-12 R7). */}
      <p className="text-caption text-fg-secondary" data-testid="HalalCertificationPanel-disclaimer">
        {certification.disclaimer ||
          (verifiedAt
            ? `Certification verified by HalalGoes on ${verifiedAt}. HalalGoes does not itself certify food.`
            : 'HalalGoes does not itself certify food.')}
      </p>

      {/* 8. Report a halal concern — server-assigned CRITICAL, 4 h acknowledge SLA. */}
      {onReportConcern ? (
        <button
          type="button"
          data-testid="HalalCertificationPanel-report"
          className={ghostButtonClass}
          onClick={onReportConcern}
        >
          Report a halal concern
        </button>
      ) : null}
    </>,
  );
}

/*
 * TODO(primitives): these two are `Button variant="tertiary"` and `variant="ghost"` from
 * `src/primitives`. They are written against the same action-role tokens that tier's skins use,
 * so the swap is a substitution, not a restyle.
 */
const tertiaryButtonClass = cx(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border',
  'border-action-tertiary-border px-4 text-label-lg text-action-tertiary-fg',
  FOCUS_RING,
);

const ghostButtonClass = cx(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4',
  'text-label-lg text-fg-link',
  FOCUS_RING,
);
