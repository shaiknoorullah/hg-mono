/** Immediate, self-applying binary (02-components.md §8). */
export interface SwitchProps {
  label: React.ReactNode;
  description?: React.ReactNode;
  /** REQUIRED visible state words, e.g. {on:'Online', off:'Offline'} — state is never thumb position alone. */
  stateLabel: { on: string; off: string };
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  onChange?: (checked: boolean, e: React.MouseEvent) => void;
  /** Thumb spinner; the switch STAYS in its old position until the server confirms. */
  loading?: boolean;
  disabled?: boolean;
  error?: string;
  /** Adds a hidden form input. */
  name?: string;
  size?: 'sm' | 'md';
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function Switch(props: SwitchProps): JSX.Element;
