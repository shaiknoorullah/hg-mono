/**
 * The server's halal_display_state rendered as a SEAL (02-components.md §12). The four contract
 * states are the entire API: no colour, label, variant, icon, showLabel or onTint prop.
 */
export type HalalDisplayState = 'CERTIFIED' | 'EXPIRING_SOON' | 'EXPIRED' | 'UNVERIFIED';
interface HalalBadgeCommon {
  /** Straight from the payload. null / undefined / unknown render NOTHING and report HALAL_DISPLAY_STATE_MISSING. */
  state: HalalDisplayState | null | undefined;
  /** sm 20 · md 24 (default, cards) · lg 32 (detail header). */
  size?: 'sm' | 'md' | 'lg';
  /** Included in the client-error report. */
  restaurantId?: string;
  /** detail surface: extends the accessible name with who certified, and until when. */
  certifyingBodyName?: string | null;
  /**
   * Wire date (YYYY-MM-DD or ISO date-time), optional. EXPIRING_SOON, any surface: the visible label
   * becomes "Halal certified · expires 14 Oct" (short date, UTC) and the accessible name gains
   * "Expires 14 October 2026." (absolute). CERTIFIED on the detail surface: "Valid until {date}."
   * Missing or unparseable: no date is shown and nothing is invented.
   */
  expiresOn?: string | null;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
/** onPress is admissible ONLY on the detail surface (button role, chevron, >= 44px hit area). */
export type HalalBadgeProps =
  | (HalalBadgeCommon & { surface?: 'card' | 'operational'; onPress?: never })
  | (HalalBadgeCommon & { surface: 'detail'; onPress?: () => void });
export declare function HalalBadge(props: HalalBadgeProps): JSX.Element | null;
/** Not components: the fixed, reviewed label tables. EXPIRING_SOON's entry is the base
 *  "Halal certified"; HalalBadge appends " · expires {d Mon}" when expiresOn parses. */
export declare const HALAL_VISIBLE_LABEL: Record<HalalDisplayState, string>;
export declare const HALAL_ACCESSIBLE_LABEL: Record<HalalDisplayState, string>;
