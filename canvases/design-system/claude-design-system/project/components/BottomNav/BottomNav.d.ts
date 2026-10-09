/** Phone primary navigation (02-components.md §28). */
export interface BottomNavItem {
  key: string;
  /** Always visible. */
  label: string;
  icon: import('../Icon/Icon').IconName | import('../Icon/Icon').IconExtensionName;
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
