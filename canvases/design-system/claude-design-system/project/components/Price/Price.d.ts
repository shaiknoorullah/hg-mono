/** The ONLY component permitted to render money (02-components.md §20). */
export interface PriceProps {
  /** int64 minor units from the server. REQUIRED. A missing or non-integer value renders nothing and reports MONEY_NOT_INTEGER_CENTS. */
  cents: number;
  /** Default and only value at V1. */
  currency?: 'CAD';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** A previous price; announced "was …". */
  strikethrough?: boolean;
  /** 'always' for ledger / earnings deltas (+$18.50, −$3.00). */
  sign?: 'auto' | 'always' | 'never';
  /** Appends "CAD" — required on receipts and refund records. */
  showCode?: boolean;
  /** Label shown when cents === 0, e.g. "Free delivery". Without it, $0.00 — never blank. */
  free?: string;
  /** Prefix for the spoken name; strikethrough implies "was". */
  announceAs?: 'was' | 'now';
  /** Skeleton at the glyph width, so totals do not jump. */
  loading?: boolean;
  onDark?: boolean;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function Price(props: PriceProps): JSX.Element | null;
