/**
 * The single affordance for an action (02-components.md §1). Action is orange; there is no success button.
 */
export interface ButtonProps {
  children: React.ReactNode;
  /** primary = brand fill · secondary = forest fill · tertiary = outlined · ghost · danger. No `success`. */
  variant?: 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'danger';
  /** sm 36 (hit area expanded to 44) · md 44 · lg 52 · xl 60 (rider primary actions). */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** 72px target.criticalField — rider Accept/Decline, restaurant Accept-order only. */
  critical?: boolean;
  fullWidth?: boolean;
  /** Icon names (Solar). The loading spinner replaces iconStart. */
  iconStart?: import('../Icon/Icon').IconName | import('../Icon/Icon').IconExtensionName;
  iconEnd?: import('../Icon/Icon').IconName | import('../Icon/Icon').IconExtensionName;
  /**
   * Passing the prop at all (even `false`) reserves the leading slot, so switching to loading never
   * changes the width. Loading keeps full colour and the label, sets aria-busy and ignores presses.
   */
  loading?: boolean;
  /** aria-disabled (still focusable); clicks and Enter/Space are swallowed — a disabled submit cannot submit. */
  disabled?: boolean;
  /** Marks an irreversible action. Adds no colour meaning: the label must carry the verb ("Cancel order"). */
  destructive?: boolean;
  onPress?: (e: React.MouseEvent) => void;
  /** Link mode: renders <a href> and announces as a link. */
  href?: string;
  type?: 'button' | 'submit' | 'reset';
  /** Only when the visible label is not enough. */
  accessibilityLabel?: string;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function Button(props: ButtonProps): JSX.Element;
