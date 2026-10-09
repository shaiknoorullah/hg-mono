/** Blocking dialog (02-components.md §31). Formerly `Dialog`. */
export interface ModalProps {
  open: boolean;
  /** dialog = title + body + actions · confirm = a decision (alertdialog) · alert = one acknowledgement (alertdialog). */
  variant?: 'dialog' | 'confirm' | 'alert';
  /** REQUIRED — the accessible name (aria-labelledby). */
  title: string;
  /** aria-describedby. */
  description?: string;
  children?: React.ReactNode;
  /** `dialog` only: the footer actions. */
  actions?: React.ReactNode;
  /** Called by Cancel / OK, the close button, Escape and scrim — the latter three only when dismissible. */
  onClose?: () => void;
  /** confirm: the decisive action. */
  confirmLabel?: string;
  onConfirm?: () => void;
  confirmLoading?: boolean;
  /** confirm: the least destructive action — receives initial focus. Default "Cancel". */
  cancelLabel?: string;
  /** confirm: the decisive action uses the danger variant. */
  destructive?: boolean;
  /** alert: default "OK". */
  acknowledgeLabel?: string;
  /** Escape / scrim / close button close it. Default true. */
  dismissible?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** Position inside the nearest positioned ancestor instead of the viewport (docs/previews). */
  contained?: boolean;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function Modal(props: ModalProps): JSX.Element | null;
/** Deprecated alias (old name, defaults open=true). Not a component card. */
export declare function Dialog(props: Partial<ModalProps>): JSX.Element | null;
