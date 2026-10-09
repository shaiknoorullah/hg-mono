/** A small non-interactive status marker. NOT the halal badge (02-components.md §9). */
export interface BadgeProps {
  children?: React.ReactNode;
  /** Alternative to children. */
  label?: React.ReactNode;
  /** No `success`, no `accent`: the only filled green in the system is the halal seal. */
  variant?: 'neutral' | 'info' | 'warning' | 'danger' | 'brand' | 'outline';
  /** The spec's `style` prop (renamed: `style` is React's CSS prop). tint is the default. */
  appearance?: 'tint' | 'solid' | 'dot';
  /** sm 18 · md 22 · lg 26. */
  size?: 'sm' | 'md' | 'lg';
  icon?: import('../Icon/Icon').IconName | import('../Icon/Icon').IconExtensionName;
  /** For numeric content: above `max` renders "{max}+". */
  max?: number;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function Badge(props: BadgeProps): JSX.Element;
