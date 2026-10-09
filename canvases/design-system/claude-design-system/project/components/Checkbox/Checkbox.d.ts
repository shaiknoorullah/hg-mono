/** Independent booleans (02-components.md §6). */
export interface CheckboxProps {
  label: React.ReactNode;
  description?: React.ReactNode;
  checked?: boolean;
  /** Sets the DOM property -> assistive tech announces "mixed". */
  indeterminate?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  /** Shown in text.tertiary and linked to the control, e.g. "Out of stock". */
  disabledReason?: string;
  /** Add-on rows: rendered through Price with sign always. */
  priceDeltaCents?: number;
  /** Linked (aria-describedby) and announced (role=alert). */
  error?: string;
  /** Control size 20 (default) or 24; the row is always >= 44px. */
  size?: 20 | 24;
  name?: string;
  value?: string;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function Checkbox(props: CheckboxProps): JSX.Element;
