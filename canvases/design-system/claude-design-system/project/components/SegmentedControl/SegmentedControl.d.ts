/** 2–3 exclusive options that filter or switch a view mode in place. A radiogroup. */
export interface SegmentedControlOption {
  value: string;
  label: string;
  /** Icon swaps to the bold weight when selected. */
  icon?: import('../Icon/Icon').IconName | import('../Icon/Icon').IconExtensionName;
  disabled?: boolean;
}
export interface SegmentedControlProps {
  /** REQUIRED — names the radiogroup. */
  label: string;
  options: SegmentedControlOption[];
  value: string;
  onChange?: (value: string) => void;
  onValueChange?: (value: string) => void;
  /** light (cream/white) · chrome (forest bar). Role tokens only. */
  tone?: 'light' | 'chrome';
  /** sm 36 visual (44 hit area) · md 44 · lg 52. */
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function SegmentedControl(props: SegmentedControlProps): JSX.Element;
