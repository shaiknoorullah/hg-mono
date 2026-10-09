/** The generic surface (02-components.md §15). */
export interface CardProps {
  children?: React.ReactNode;
  /** Defaults to `interactive` when onPress/href is set, else `elevated`. */
  variant?: 'elevated' | 'outlined' | 'filled' | 'interactive';
  /** CSS length; defaults to var(--density-card-padding). */
  padding?: string;
  radius?: 'md' | 'lg' | 'xl';
  /** Makes the card ONE tab stop (role="button", Enter/Space). No nested interactive content allowed. */
  onPress?: (e: React.SyntheticEvent) => void;
  /** Makes the card a link. */
  href?: string;
  /** The single accessible name of a pressable card. */
  accessibilityLabel?: string;
  media?: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function Card(props: CardProps): JSX.Element;
