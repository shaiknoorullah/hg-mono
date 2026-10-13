/**
 * HalalCertificationPanel specimens. The live preview.html is one grid (its `full` shot): the
 * expiring panel beside loading, error and expired. The restaurant and compact variants and the
 * not-viewable copy are additions, compared with `restaurant/settings/PartHalalCard` and
 * `customer/discover-order/Restaurant-cert-sheet-expiring`.
 */

import { HalalCertificationPanel } from './HalalCertificationPanel.js';

/** The live design system's component name. */
export const component = 'HalalCertificationPanel';

const noop = () => {};
const cert = {
  display_state: 'EXPIRING_SOON',
  certifying_body_name: 'Halal Monitoring Authority (HMA)',
  certificate_number: 'HMA-2026-04417',
  scope: 'WHOLE_ESTABLISHMENT',
  issued_on: '2025-11-12',
  expires_on: '2026-11-12',
  verified_at: '2026-09-04T15:20:00Z',
  certificate_viewable: true,
  disclaimer: 'Certification verified by HalalGoes on 4 September 2026. HalalGoes does not itself certify food.',
} as const;

const grid = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(260px, 1fr))', gap: 16, alignItems: 'start', width: 1100 } as const;
const col = { display: 'grid', gap: 12 } as const;

/** As the live preview: expiring (with view and concern), then loading, error and expired. */
export function Full() {
  return (
    <div style={grid}>
      <HalalCertificationPanel restaurantId="rst_01" certification={cert} onViewCertificate={noop} onReportConcern={noop} />
      <div style={col}>
        <HalalCertificationPanel restaurantId="rst_02" status="loading" headingLevel={3} />
        <HalalCertificationPanel restaurantId="rst_03" status="error" onRetry={noop} headingLevel={3} />
        <HalalCertificationPanel
          restaurantId="rst_04"
          headingLevel={3}
          certification={{
            display_state: 'EXPIRED',
            certifying_body_name: 'ISNA Canada Halal',
            certificate_number: 'ISNA-7731',
            expires_on: '2026-08-01',
            disclaimer: 'HalalGoes does not itself certify food.',
          }}
        />
      </div>
    </div>
  );
}

/** Additions: the restaurant's own card, compact, and certificate_viewable=false. */
export function Variants() {
  return (
    <div style={grid}>
      <HalalCertificationPanel restaurantId="rst_05" variant="restaurant" certification={cert} onViewCertificate={noop} />
      <div style={col}>
        <HalalCertificationPanel restaurantId="rst_06" variant="restaurant" density="compact" certification={cert} onViewCertificate={noop} headingLevel={3} />
        <HalalCertificationPanel
          restaurantId="rst_07"
          headingLevel={3}
          certification={{ ...cert, display_state: 'CERTIFIED', certificate_viewable: false }}
          onViewCertificate={noop}
        />
      </div>
    </div>
  );
}
