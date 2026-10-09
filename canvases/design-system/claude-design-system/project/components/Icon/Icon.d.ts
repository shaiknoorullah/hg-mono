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
