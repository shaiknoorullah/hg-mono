/** The certification section on the restaurant detail page (02-components.md §13). */
export type HalalCertificateScope = 'WHOLE_ESTABLISHMENT' | 'KITCHEN_ONLY' | 'SPECIFIC_MENU_ITEMS' | 'SUPPLIER_CHAIN_ONLY';
/** The API's CertificationPanel payload, passed through unchanged. */
export interface CertificationPanel {
  display_state: import('../HalalBadge/HalalBadge').HalalDisplayState;
  certifying_body_name?: string | null;
  certificate_number?: string | null;
  scope?: HalalCertificateScope | null;
  issued_on?: string | null;
  /** Rendered absolutely: "Valid until 14 March 2027", never relative. */
  expires_on?: string | null;
  verified_at?: string | null;
  certificate_viewable?: boolean;
  /** Fixed copy from the server: "Certification verified by Halal Goes on {date}. Halal Goes does not itself certify food." */
  disclaimer: string;
}
interface PanelBase {
  restaurantId: string;
  /** Opens DocumentViewer via a per-request presigned GET (TTL 300 s, audited). */
  onViewCertificate?: () => void;
  /** Opens the grievance flow with category HALAL_CONCERN. */
  onReportConcern?: () => void;
  /** Level of the visible "Halal certification" heading (default 2). */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export type HalalCertificationPanelProps =
  | (PanelBase & { status: 'loading' })
  | (PanelBase & { status: 'error'; errorMessage?: string; onRetry?: () => void })
  | (PanelBase & { status?: 'ready'; certification: CertificationPanel });
/** Renders null when display_state is missing/unknown (reported) or UNVERIFIED. */
export declare function HalalCertificationPanel(props: HalalCertificationPanelProps): JSX.Element | null;
