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
      icon?: import('../Icon/Icon').IconName | import('../Icon/Icon').IconExtensionName;
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
  icon?: import('../Icon/Icon').IconName | import('../Icon/Icon').IconExtensionName;
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
