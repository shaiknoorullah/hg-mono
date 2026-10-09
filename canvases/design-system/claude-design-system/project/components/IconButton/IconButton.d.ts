/** A control whose only content is an icon (02-components.md §2). */
export interface IconButtonProps {
  /** Solar icon name, or a node. */
  icon: import('../Icon/Icon').IconName | import('../Icon/Icon').IconExtensionName | React.ReactNode;
  /** REQUIRED — no default. A count badge is appended to it ("Cart, 3 items"). */
  accessibilityLabel: string;
  variant?: 'plain' | 'filled' | 'tonal';
  /** sm 36 (hit area 44) · md 44 · lg 56. */
  size?: 'sm' | 'md' | 'lg';
  shape?: 'square' | 'circle';
  /** Icon weight — `bold` when the control represents an active/selected state. */
  weight?: 'linear' | 'bold';
  /** A count (99+ above 99) or `true` for a dot. Folded into the accessible name. */
  badge?: number | boolean;
  /** Noun for the count in the name: badgeNoun="items" -> "Cart, 3 items". */
  badgeNoun?: string;
  loading?: boolean;
  disabled?: boolean;
  onPress?: (e: React.MouseEvent) => void;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function IconButton(props: IconButtonProps): JSX.Element;
