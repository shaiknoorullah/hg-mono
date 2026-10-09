/** One from a set (02-components.md §7). Radio is always used inside RadioGroup. */
export interface RadioOption {
  value: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  /** e.g. "Out of stock". */
  disabledReason?: string;
  /** Variant rows: rendered through Price with sign always. */
  priceDeltaCents?: number;
}
export interface RadioGroupProps {
  /** The visible legend; names the radiogroup. REQUIRED. */
  label: React.ReactNode;
  hideLabel?: boolean;
  name?: string;
  value: string | null;
  onChange?: (value: string, e: React.ChangeEvent<HTMLInputElement>) => void;
  onValueChange?: (value: string) => void;
  /** Either options or <Radio> children. */
  options?: RadioOption[];
  children?: React.ReactNode;
  orientation?: 'vertical' | 'horizontal';
  required?: boolean;
  disabled?: boolean;
  /** Announced on the GROUP (not the last option). */
  error?: string | null;
  size?: 20 | 24;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function RadioGroup(props: RadioGroupProps): JSX.Element;
export interface RadioProps extends RadioOption {
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function Radio(props: RadioProps): JSX.Element;
