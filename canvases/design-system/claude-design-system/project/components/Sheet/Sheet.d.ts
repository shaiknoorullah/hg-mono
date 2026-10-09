/** Overlay panel (02-components.md §30). */
export interface SheetProps {
  open: boolean;
  /** bottom (default) · side (admin filters/detail, inline-end edge) · full (rider offer). */
  variant?: 'bottom' | 'side' | 'full';
  /** REQUIRED — aria-labelledby. */
  title: string;
  hideTitle?: boolean;
  children?: React.ReactNode;
  /** Sticky footer (never under the keyboard). */
  footer?: React.ReactNode;
  onClose?: () => void;
  /** true (default): Escape, scrim tap and a visible close button close it. false: the rider offer (D-14). */
  dismissible?: boolean;
  maxHeight?: string;
  /** Position inside the nearest positioned ancestor (docs/previews). */
  contained?: boolean;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function Sheet(props: SheetProps): JSX.Element | null;
