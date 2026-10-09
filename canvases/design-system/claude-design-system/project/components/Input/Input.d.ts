/** Single-line text entry (02-components.md §3; focus per docs/decisions/focus-indicator.md). */
export interface InputProps {
  /** REQUIRED, always visible — placeholder is never the label. */
  label: string;
  variant?: 'text' | 'email' | 'tel' | 'numeric' | 'password' | 'search' | 'otp';
  /** md 44 · lg 52 (rider default). */
  size?: 'md' | 'lg';
  value?: string;
  defaultValue?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** The cleaned value (digits only for numeric/otp). */
  onValueChange?: (value: string) => void;
  placeholder?: string;
  /** Linked via aria-describedby. */
  helperText?: string;
  /** Danger border + icon + text; role="alert"; linked; sets aria-invalid. */
  errorText?: string | null;
  /** Passed to the input as required + aria-required. */
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  /** Trailing spinner; still editable unless readOnly. */
  loading?: boolean;
  /** Trailing check in success.600 — no green fill. */
  success?: boolean;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  iconStart?: import('../Icon/Icon').IconName | import('../Icon/Icon').IconExtensionName;
  maxLength?: number;
  /** Visible counter; announces remaining characters at 80% and at the limit. */
  characterCount?: boolean;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  /** Defaults to a useId() value — never derived from the label. */
  id?: string;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function Input(props: InputProps): JSX.Element;
