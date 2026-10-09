/** Choice from a closed, server-defined set (02-components.md §5). */
export interface SelectOption { value: string; label: string; description?: string; disabled?: boolean }
export interface SelectProps {
  /** REQUIRED, visible. */
  label: string;
  /** native (default, the platform picker) · listbox (combobox pattern for long lists; `sheet` on native). */
  variant?: 'native' | 'listbox';
  options: SelectOption[];
  value?: string | null;
  /** native: the change event; listbox: the value. */
  onChange?: (eOrValue: any) => void;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  /** listbox: adds a filter field. */
  searchable?: boolean;
  helperText?: string;
  errorText?: string | null;
  required?: boolean;
  disabled?: boolean;
  /** Skeleton rows inside the list — never an empty list. */
  loading?: boolean;
  /** Shown when there are no options. */
  emptyText?: string;
  size?: 'md' | 'lg';
  id?: string;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function Select(props: SelectProps): JSX.Element;
