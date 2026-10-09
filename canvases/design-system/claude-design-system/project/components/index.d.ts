/* Halal Goes Design System — types (documentation; not type-checked).
   window.HalalGoesDesignSystem_d11a47 exposes every export below. */
export declare function setClientErrorReporter(reporter: ((code: string, context: Record<string, unknown>) => void) | null): void;
/** Alias kept for parity with @hg/ui-web certification. */
export declare const setHalalClientErrorReporter: typeof setClientErrorReporter;

/* ───── Icon ───── */
/**
 * Solar icon (480 Design, CC BY 4.0) — the ONLY icon source. linear = inactive, bold = active.
 * Same semantic names and Solar ids as packages/ui-web/src/primitives/solar-icon-map.json.
 */
/** The 14 names shared with the repo map. */
export type IconName =
  | 'home' | 'search' | 'cart' | 'orders' | 'profile' | 'map' | 'bell'
  | 'back' | 'close' | 'plus' | 'check' | 'star' | 'clock' | 'menu';
/** Used by these components; NOT yet in the repo map — add them there before app code uses them. */
export type IconExtensionName =
  | 'chevron-down' | 'chevron-right' | 'minus' | 'lock' | 'info' | 'warning' | 'error' | 'more' | 'refresh';
export type IconWeight = 'linear' | 'bold';
export interface IconProps {
  name: IconName | IconExtensionName;
  /** linear (inactive, default) or bold (active: selected tab, chip, nav item). */
  weight?: IconWeight;
  /** sm 16 · md 20 · lg 24 · xl 32 · 2xl 48, a px number, or any CSS length. */
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | number | string;
  /** Only for a freestanding meaningful icon; omitted = aria-hidden (the control carries the name). */
  accessibilityLabel?: string;
  /** Any CSS colour — use a role token. Glyphs paint in currentColor. */
  color?: string;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
/** Unknown names render nothing and report ICON_NAME_UNKNOWN. */
export declare function Icon(props: IconProps): JSX.Element | null;
/** Not a component: every name Icon accepts. */
export declare const ICON_NAMES: Array<IconName | IconExtensionName>;
/** Not a component: name -> Solar ids; `extension: true` marks names not yet in the repo map. */
export declare const ICON_MAP: Record<IconName | IconExtensionName, { linear: string; bold: string; extension?: true }>;

/* ───── Button ───── */
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
  iconStart?: IconName | IconExtensionName;
  iconEnd?: IconName | IconExtensionName;
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

/* ───── IconButton ───── */
/** A control whose only content is an icon (02-components.md §2). */
export interface IconButtonProps {
  /** Solar icon name, or a node. */
  icon: IconName | IconExtensionName | React.ReactNode;
  /** REQUIRED — no default. A count badge is appended to it ("Cart, 3 items"). */
  accessibilityLabel: string;
  variant?: 'plain' | 'filled' | 'tonal';
  /** sm 36 (hit area 44) · md 44 · lg 56. */
  size?: 'sm' | 'md' | 'lg';
  shape?: 'square' | 'circle';
  /** Icon weight — `bold` when the control represents an active/selected state. */
  weight?: 'linear' | 'bold';
  /** A count (99+ above 99) or `true` for a dot. Folded into the accessible name. */
  badge?: number | boolean;
  /** Noun for the count in the name: badgeNoun="items" -> "Cart, 3 items". */
  badgeNoun?: string;
  loading?: boolean;
  disabled?: boolean;
  onPress?: (e: React.MouseEvent) => void;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function IconButton(props: IconButtonProps): JSX.Element;

/* ───── Badge ───── */
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
  icon?: IconName | IconExtensionName;
  /** For numeric content: above `max` renders "{max}+". */
  max?: number;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function Badge(props: BadgeProps): JSX.Element;

/* ───── Card ───── */
/** The generic surface (02-components.md §15). */
export interface CardProps {
  children?: React.ReactNode;
  /** Defaults to `interactive` when onPress/href is set, else `elevated`. */
  variant?: 'elevated' | 'outlined' | 'filled' | 'interactive';
  /** CSS length; defaults to var(--density-card-padding). */
  padding?: string;
  radius?: 'md' | 'lg' | 'xl';
  /** Makes the card ONE tab stop (role="button", Enter/Space). No nested interactive content allowed. */
  onPress?: (e: React.SyntheticEvent) => void;
  /** Makes the card a link. */
  href?: string;
  /** The single accessible name of a pressable card. */
  accessibilityLabel?: string;
  media?: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function Card(props: CardProps): JSX.Element;

/* ───── Countdown ───── */
/** Every deadline in the system, derived from the SERVER clock (02-components.md §38, D-14). */
export interface CountdownProps {
  /** RFC-3339 deadline from the server. REQUIRED. */
  expiresAt: string;
  /** Server clock at response time. REQUIRED. Skew > 5 s -> runs on serverNow + monotonic time. */
  serverNow: string;
  /** Full length of the window in seconds (rider offer 30, restaurant response 180…). Drives thresholds, ring and bar. */
  windowSeconds: number;
  /** Fires exactly once, including when the deadline had already passed at mount (the caller re-fetches). */
  onExpire?: () => void;
  variant?: 'ring' | 'bar' | 'text';
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  /** Fraction of the window below which the state is urgent (default 0.25). */
  urgentThreshold?: number;
  /** Fraction below which it is critical, with a 1 Hz pulse (default 0.1). */
  criticalThreshold?: number;
  /** On the rider's dark field surface. */
  onDark?: boolean;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function Countdown(props: CountdownProps): JSX.Element | null;

/* ───── DataTable ───── */
/** Admin lists (02-components.md §24). Cursor pagination only. */
export interface DataTableColumn<Row> {
  key: string;
  label: string;
  /** Logical alignment; money and counts are `end`. */
  align?: 'start' | 'end';
  /** Ids: mono family (IBM Plex Mono via --font-mono), tabular. */
  mono?: boolean;
  numeric?: boolean;
  muted?: boolean;
  sortable?: boolean;
  width?: string | number;
  render?: (row: Row) => React.ReactNode;
}
export interface DataTableProps<Row = Record<string, unknown>> {
  /** REQUIRED: names the table (<caption>). */
  caption: string;
  hideCaption?: boolean;
  columns: DataTableColumn<Row>[];
  rows: Row[];
  getRowId?: (row: Row) => string;
  /** Server-side sort. Headers get aria-sort; changes are announced. */
  sort?: { key: string; direction: 'ascending' | 'descending' };
  onSortChange?: (sort: { key: string; direction: 'ascending' | 'descending' }) => void;
  /** Selected row ids; with onSelectionChange renders a checkbox column. Count is announced. */
  selection?: string[];
  onSelectionChange?: (ids: string[]) => void;
  /** Enter (keyboard) or click activates a row. */
  onRowActivate?: (row: Row) => void;
  /** Items for a per-row Menu button named "Actions for {rowLabel}". */
  rowActions?: (row: Row) => MenuItem[];
  /** Unique human name of a row, e.g. r => `order ${r.id}`. */
  rowLabel?: (row: Row) => string;
  /** compact = density.rowHeight (44 in compact density). */
  density?: 'compact' | 'comfortable';
  stickyHeader?: boolean;
  status?: 'ready' | 'loading' | 'error';
  errorMessage?: string;
  onRetry?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** Distinguishes "no results for these filters" from "no records". */
  filtersActive?: boolean;
  onClearFilters?: () => void;
  /** Empty copy must say why it is empty and what to do next. */
  emptyState?: { title: string; description: string; action?: React.ReactNode };
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function DataTable<Row>(props: DataTableProps<Row>): JSX.Element;

/* ───── Price ───── */
/** The ONLY component permitted to render money (02-components.md §20). */
export interface PriceProps {
  /** int64 minor units from the server. REQUIRED. A missing or non-integer value renders nothing and reports MONEY_NOT_INTEGER_CENTS. */
  cents: number;
  /** Default and only value at V1. */
  currency?: 'CAD';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** A previous price; announced "was …". */
  strikethrough?: boolean;
  /** 'always' for ledger / earnings deltas (+$18.50, −$3.00). */
  sign?: 'auto' | 'always' | 'never';
  /** Appends "CAD" — required on receipts and refund records. */
  showCode?: boolean;
  /** Label shown when cents === 0, e.g. "Free delivery". Without it, $0.00 — never blank. */
  free?: string;
  /** Prefix for the spoken name; strikethrough implies "was". */
  announceAs?: 'was' | 'now';
  /** Skeleton at the glyph width, so totals do not jump. */
  loading?: boolean;
  onDark?: boolean;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function Price(props: PriceProps): JSX.Element | null;

/* ───── Rating ───── */
/** Restaurant and rider ratings (02-components.md §21). */
export interface RatingProps {
  /** 0–5, 1 dp. null/undefined renders "New" (name "No ratings yet") — never 0.0, never a crash. */
  value: number | null | undefined;
  count?: number | null;
  variant?: 'display' | 'stars' | 'input';
  size?: 'sm' | 'md' | 'lg';
  showCount?: boolean;
  /** input variant only. */
  onChange?: (value: number) => void;
  /** input variant: the radiogroup's name. Default "Your rating". */
  label?: string;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function Rating(props: RatingProps): JSX.Element;

/* ───── StatusTimeline ───── */
/** Order progress, driven by the order state and the audience (02-components.md §23). */
export type OrderState =
  | 'CREATED' | 'AUTHORIZED' | 'RESTAURANT_PENDING' | 'PREPARING' | 'READY_FOR_PICKUP' | 'PICKED_UP'
  | 'ARRIVED' | 'DELIVERED' | 'COMPLETED' | 'CANCELLED' | 'REJECTED' | 'FAILED' | 'DISPUTED' | 'RESOLVED';
export type StepState = 'complete' | 'current' | 'stalled' | 'failed' | 'upcoming' | 'unreached';
export interface StatusTimelineProps {
  /** Whose vocabulary to render. Never inferred. */
  audience: 'customer' | 'restaurant' | 'rider' | 'admin';
  /** The contract order state. An unknown value is reported and rendered as all-upcoming + a refresh line. */
  state?: OrderState | (string & {});
  /** OrderTracking.timeline — gives step times and where a failure happened. */
  transitions?: Array<{ to_state: OrderState; from_state?: OrderState | null; at?: string }>;
  orientation?: 'vertical' | 'horizontal' | 'compact';
  showTimes?: boolean;
  /** OrderTracking.eta_at — shown under the current step. */
  estimatedAt?: string | null;
  /** OrderSummary.deadline_at — once passed, the current step is `stalled` and says so. */
  deadlineAt?: string | null;
  /** Skeleton with the right number of steps. */
  loading?: boolean;
  /** 'reconnecting' keeps the last state and shows "Not updating — reconnecting". */
  connection?: 'live' | 'reconnecting';
  onUnknownState?: (state: string) => void;
  /** Injectable clock (tests). */
  now?: number;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function StatusTimeline(props: StatusTimelineProps): JSX.Element;
/** Not components: the ONE shared mapping module (mirror of ui-native order-track.ts). */
export declare const ORDER_STATES: OrderState[];
export declare const ORDER_STATE_LABELS: Record<OrderState, string>;
export declare function resolveTimeline(input: { audience: StatusTimelineProps['audience']; state: string; transitions?: StatusTimelineProps['transitions']; deadlineAt?: string | null; now?: number }):
  { steps: Array<{ key: string; label: string; state: StepState; at?: string }>; currentKey: string | null; failed: boolean; unknownState: string | null };

/* ───── Modal ───── */
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

/* ───── Menu ───── */
/**
 * Menu button (WAI-ARIA APG "Menu Button"; Radix DropdownMenu semantics). SPEC OF RECORD for the
 * dropdown menu until 02-components.md gains the entry (owner decision C-25).
 */
export type MenuItem =
  | {
      /** Returned to onSelect. Defaults to the label. */
      key?: string;
      /** Visible text; also the type-ahead target. */
      label: string;
      icon?: IconName | IconExtensionName;
      /** Keyboard shortcut hint, decorative. */
      hint?: string;
      /** Danger TEXT with a verb ("Remove item") — never a fill, never colour alone. */
      destructive?: boolean;
      /** Stays focusable (aria-disabled) so its reason can be read; cannot be activated. */
      disabled?: boolean;
      disabledReason?: string;
      onSelect?: (item: MenuItem) => void;
      type?: undefined;
    }
  | { type: 'separator' };
export interface MenuProps {
  /** REQUIRED, UNIQUE accessible name of the trigger, e.g. "Actions for order HG-10482". */
  label: string;
  items: MenuItem[];
  onSelect?: (key: string, item: MenuItem) => void;
  /** Popup alignment to the trigger's logical start or end edge. */
  align?: 'start' | 'end';
  /** Icon-only trigger glyph (default "more"). */
  icon?: IconName | IconExtensionName;
  /** Text trigger ("Sort") with a chevron, instead of an icon. */
  triggerText?: string;
  triggerVariant?: 'plain' | 'tonal' | 'filled';
  /** Controlled open state (optional). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function Menu(props: MenuProps): JSX.Element;

/* ───── Sheet ───── */
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

/* ───── Toast ───── */
/** Short, non-blocking message (02-components.md §32). */
export interface ToastProps {
  /** No `halal` variant — the shield is drawn only by HalalBadge / HalalCertificationPanel. */
  variant?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  title: string;
  description?: string;
  /** An action makes the toast persistent. */
  action?: { label: string; onAction: () => void };
  /** ms, default 5000. danger and action toasts are persistent. Pauses on hover and focus. */
  duration?: number;
  /** Called on dismiss and when the timer ends. A 44px dismiss button renders when set. */
  onDismiss?: () => void;
  icon?: IconName | IconExtensionName;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function Toast(props: ToastProps): JSX.Element;

/* ───── Checkbox ───── */
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

/* ───── Radio ───── */
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

/* ───── Switch ───── */
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

/* ───── Input ───── */
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
  iconStart?: IconName | IconExtensionName;
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

/* ───── Select ───── */
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

/* ───── SegmentedControl ───── */
/** 2–3 exclusive options that filter or switch a view mode in place. A radiogroup. */
export interface SegmentedControlOption {
  value: string;
  label: string;
  /** Icon swaps to the bold weight when selected. */
  icon?: IconName | IconExtensionName;
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

/* ───── HalalBadge ───── */
/**
 * The server's halal_display_state rendered as a SEAL (02-components.md §12). The four contract
 * states are the entire API: no colour, label, variant, icon, showLabel or onTint prop.
 */
export type HalalDisplayState = 'CERTIFIED' | 'EXPIRING_SOON' | 'EXPIRED' | 'UNVERIFIED';
interface HalalBadgeCommon {
  /** Straight from the payload. null / undefined / unknown render NOTHING and report HALAL_DISPLAY_STATE_MISSING. */
  state: HalalDisplayState | null | undefined;
  /** sm 20 · md 24 (default, cards) · lg 32 (detail header). */
  size?: 'sm' | 'md' | 'lg';
  /** Included in the client-error report. */
  restaurantId?: string;
  /** detail surface: extends the accessible name with who certified, and until when. */
  certifyingBodyName?: string | null;
  /**
   * Wire date (YYYY-MM-DD or ISO date-time), optional. EXPIRING_SOON, any surface: the visible label
   * becomes "Halal certified · expires 14 Oct" (short date, UTC) and the accessible name gains
   * "Expires 14 October 2026." (absolute). CERTIFIED on the detail surface: "Valid until {date}."
   * Missing or unparseable: no date is shown and nothing is invented.
   */
  expiresOn?: string | null;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
/** onPress is admissible ONLY on the detail surface (button role, chevron, >= 44px hit area). */
export type HalalBadgeProps =
  | (HalalBadgeCommon & { surface?: 'card' | 'operational'; onPress?: never })
  | (HalalBadgeCommon & { surface: 'detail'; onPress?: () => void });
export declare function HalalBadge(props: HalalBadgeProps): JSX.Element | null;
/** Not components: the fixed, reviewed label tables. EXPIRING_SOON's entry is the base
 *  "Halal certified"; HalalBadge appends " · expires {d Mon}" when expiresOn parses. */
export declare const HALAL_VISIBLE_LABEL: Record<HalalDisplayState, string>;
export declare const HALAL_ACCESSIBLE_LABEL: Record<HalalDisplayState, string>;

/* ───── HalalShield ───── */
/** The bespoke verification glyph (01-foundations.md §11). Not an icon; never from an icon set. */
export interface HalalShieldProps {
  /** solid (certified) · outline (expired) · dashed (unverified) · solid-clock (renewal note). */
  variant: 'solid' | 'outline' | 'dashed' | 'solid-clock';
  /** px or CSS length; default var(--icon-sm). */
  size?: number | string;
  /** Plate colour the tick/clock is knocked out against on filled variants — a halal token. */
  knockout?: string;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function HalalShield(props: HalalShieldProps): JSX.Element;

/* ───── HalalCertificationPanel ───── */
/** The certification section on the restaurant detail page (02-components.md §13). */
export type HalalCertificateScope = 'WHOLE_ESTABLISHMENT' | 'KITCHEN_ONLY' | 'SPECIFIC_MENU_ITEMS' | 'SUPPLIER_CHAIN_ONLY';
/** The API's CertificationPanel payload, passed through unchanged. */
export interface CertificationPanel {
  display_state: HalalDisplayState;
  certifying_body_name?: string | null;
  certificate_number?: string | null;
  scope?: HalalCertificateScope | null;
  issued_on?: string | null;
  /** Rendered absolutely: "Valid until 14 March 2027", never relative. */
  expires_on?: string | null;
  verified_at?: string | null;
  certificate_viewable?: boolean;
  /** Fixed copy from the server: "Certification verified by Halal Goes on {date}. Halal Goes does not itself certify food." */
  disclaimer: string;
}
interface PanelBase {
  restaurantId: string;
  /** Opens DocumentViewer via a per-request presigned GET (TTL 300 s, audited). */
  onViewCertificate?: () => void;
  /** Opens the grievance flow with category HALAL_CONCERN. */
  onReportConcern?: () => void;
  /** Level of the visible "Halal certification" heading (default 2). */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export type HalalCertificationPanelProps =
  | (PanelBase & { status: 'loading' })
  | (PanelBase & { status: 'error'; errorMessage?: string; onRetry?: () => void })
  | (PanelBase & { status?: 'ready'; certification: CertificationPanel });
/** Renders null when display_state is missing/unknown (reported) or UNVERIFIED. */
export declare function HalalCertificationPanel(props: HalalCertificationPanelProps): JSX.Element | null;

/* ───── HalalChecklist ───── */
/** The seven-check verification form, admin only (02-components.md §14, A-15). */
export type HalalCheckKey =
  | 'H1_LEGIBLE_COMPLETE' | 'H2_ISSUER_ACCEPTED' | 'H3_NAME_MATCH' | 'H4_ADDRESS_MATCH'
  | 'H5_DATES_VALID' | 'H6_SCOPE_SUFFICIENT' | 'H7_UNIQUE_NOT_REUSED';
export type HalalCheckResult = 'PASS' | 'FAIL' | 'NOT_ASSESSED';
export type HalalRejectionReasonCode =
  | 'ILLEGIBLE' | 'EXPIRED_OR_EXPIRING' | 'ISSUER_NOT_ACCEPTED' | 'NAME_MISMATCH' | 'ADDRESS_MISMATCH'
  | 'SCOPE_INSUFFICIENT' | 'DUPLICATE_CERTIFICATE' | 'SUSPECTED_FORGERY' | 'OTHER';
export interface HalalCheck {
  check_key: HalalCheckKey;
  result: HalalCheckResult;
  /** The server's own evaluation (H2/H3/H4 suggestion; H5/H7 authoritative). */
  computed_result?: HalalCheckResult | null;
  /** false for H5 and H7. */
  overridable: boolean;
  note?: string | null;
  checked_at?: string | null;
}
/** The API's HalalCertificate (fields used here). */
export interface HalalCertificate {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'REVOKED' | 'SUPERSEDED';
  checklist_version: number;
  certificate_number?: string | null;
  issuing_body?: { name: string } | null;
  certified_legal_name?: string | null;
  certified_address?: string | null;
  issued_on?: string | null;
  expires_on?: string | null;
  scope?: HalalCertificateScope | null;
  checks: HalalCheck[];
}
/** Minted only when all seven are PASS (and H5/H7 computed PASS). */
export interface HalalApprovalGate { readonly kind: 'ALL_SEVEN_PASS'; readonly certificateId: string; readonly checklistVersion: number; readonly checks: HalalCheck[] }
export interface HalalRejectionGate { readonly kind: 'AT_LEAST_ONE_FAIL'; readonly certificateId: string; readonly failedKeys: HalalCheckKey[] }
export interface HalalChecklistProps {
  /** REQUIRED for a review; without it an empty state shows. Results are never synthesised. */
  certificate?: HalalCertificate | null;
  /** Defaults to certificate.checks. */
  checks?: HalalCheck[];
  status?: 'ready' | 'loading' | 'error';
  errorMessage?: string;
  onRetry?: () => void;
  /** Never called for H5/H7. An override (≠ computed_result) needs a note ≥ 20 characters. */
  onRecord?: (input: { checkKey: Exclude<HalalCheckKey, 'H5_DATES_VALID' | 'H7_UNIQUE_NOT_REUSED'>; result: HalalCheckResult; note?: string }) => void;
  /** Rendered only when the gate is open. */
  onApprove?: (gate: HalalApprovalGate) => void;
  /** Needs ≥ 1 FAIL, a reason code and ≥ 20 characters of reason text. */
  onReject?: (gate: HalalRejectionGate, input: { reasonCode: HalalRejectionReasonCode; reasonText: string }) => void;
  /** The key being written; that row blocks, the rest stay live. */
  recordingKey?: HalalCheckKey | null;
  deciding?: boolean;
  /** Support agents; also implied by a decided certificate. */
  readOnly?: boolean;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function HalalChecklist(props: HalalChecklistProps): JSX.Element;
/** Not components: the A-15 vocabulary, copied from the repo. */
export declare const HALAL_CHECK_ORDER: HalalCheckKey[];
export declare const HALAL_CHECK_DESCRIPTION: Record<HalalCheckKey, string>;
export declare const HALAL_CHECK_LOCK_REASON: Record<'H5_DATES_VALID' | 'H7_UNIQUE_NOT_REUSED', string>;
export declare const SERVER_COMPUTED_CHECK_KEYS: Array<'H5_DATES_VALID' | 'H7_UNIQUE_NOT_REUSED'>;
export declare const HALAL_REJECTION_REASONS: HalalRejectionReasonCode[];
export declare const OVERRIDE_NOTE_MIN_LENGTH: 20;
export declare function openApprovalGate(certificateId: string, checklistVersion: number, checks: HalalCheck[]):
  { open: true; gate: HalalApprovalGate; outstanding: [] } | { open: false; gate: null; outstanding: HalalCheckKey[] };
export declare function openRejectionGate(certificateId: string, checks: HalalCheck[]):
  { open: true; gate: HalalRejectionGate } | { open: false; gate: null };

/* ───── AppBar ───── */
/** The top bar (02-components.md §27). */
export interface AppBarProps {
  variant?: 'default' | 'large' | 'search' | 'contextual' | 'transparent';
  /** Theme surface only — cream (customer) · raised · chrome (restaurant/admin) · field (rider). */
  tone?: 'cream' | 'raised' | 'chrome' | 'field';
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** "Back to {previous}" — required whenever the destination is known. */
  backLabel?: string;
  /** Renders a 44px back IconButton (contextual: "Clear selection"). */
  onBack?: () => void;
  /** IconButtons with real labels. */
  actions?: React.ReactNode;
  /** variant="search": the field shown in place of the title. */
  search?: React.ReactNode;
  /** Indeterminate 2px progress bar at the bottom edge. */
  loading?: boolean;
  /** Scrolled: elevation 1 + hairline. */
  elevated?: boolean;
  /** Web: the title is the page's <h1> (default true). */
  titleIsPageHeading?: boolean;
  sticky?: boolean;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function AppBar(props: AppBarProps): JSX.Element;

/* ───── BottomNav ───── */
/** Phone primary navigation (02-components.md §28). */
export interface BottomNavItem {
  key: string;
  /** Always visible. */
  label: string;
  icon: IconName | IconExtensionName;
  /** Count or dot; folded into the tab's name. */
  badge?: number | boolean;
  /** "Orders, 2 active" -> badgeNoun "active". */
  badgeNoun?: string;
}
export interface BottomNavProps {
  items: BottomNavItem[];
  /** Key of the active tab. */
  active: string;
  onChange?: (key: string) => void;
  /** Names the navigation and its tablist. */
  label?: string;
  tone?: 'raised' | 'field';
  /** Renders nothing — REQUIRED during the rider offer sheet and during checkout. */
  hidden?: boolean;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: React.CSSProperties;
}
export declare function BottomNav(props: BottomNavProps): JSX.Element | null;
