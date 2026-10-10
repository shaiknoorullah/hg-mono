/**
 * `@hg/ui-native/ds` — the approved design-system components, with the names and props of the
 * live Claude Design `index.d.ts` (artifact 1GwGVZz8Ju9wcz4HfCnzbv).
 *
 * Redesigned screens (`apps/<app>/src/redesign/`) import from here and from `/proposed`, never
 * from the package root. Today most entries are thin adapters over the legacy components: the
 * live props are mapped onto them (icon names become Solar `Icon` nodes, `testId` becomes
 * `testID`, `onValueChange` is wired to the legacy `onChange`). The DS-native work packages
 * (N1–N7) replace the internals one entry at a time on React Native Reusables; the names and
 * props here do not change, so app code does not either. N1 (core) has landed: Button, IconButton,
 * Badge, Card and Price now render through the React Native Reusables tier (`../lib`).
 *
 * Native differences from the web `.d.ts`, everywhere: `style` is a `StyleProp`, `onChange`
 * receives the value (there is no change event), money is the branded `Cents`, and labels are
 * strings. Not here yet: `Countdown`, `SegmentedControl` (N3/N5 — build against the
 * live props with a typed TODO naming the issue); `HalalShield` stays internal to the halal
 * family; `DataTable` and `HalalChecklist` are web only.
 *
 * The package root (`@hg/ui-native`) is unchanged and keeps serving the released apps.
 */

export { Icon, ICON_NAMES, ICON_MAP, iconPx } from './Icon';
export type { IconProps, IconName, IconExtensionName, IconWeight, IconSize } from './Icon';

export { Button, IconButton, nameWithBadge } from './Button';
export type { ButtonProps, IconButtonProps } from './Button';

export { Badge, Card, Price, Rating } from './Content';
export type { BadgeProps, CardProps, PriceProps, RatingProps } from './Content';

/** Owner-approved (decisions row, 28 Sep) though not yet in the live index.d.ts; props from the canvases. */
export { KeyValueList, StatCard } from './Content';
export type { KeyValueListProps, KeyValueListRow, StatCardProps } from './Content';

export { Input, Checkbox, RadioGroup, Radio, Switch, Select } from './Forms';
export type {
  InputProps,
  CheckboxProps,
  RadioGroupProps,
  RadioProps,
  RadioOption,
  SwitchProps,
  SelectProps,
  SelectOption,
} from './Forms';

/** N6: the live menu-button, a popover through `@rn-primitives/portal` (the app root mounts a `PortalHost`). */
export { Menu } from './Menu';
export type { MenuProps, MenuItem } from './Menu';

export { AppBar, BottomNav, Sheet, Modal, Dialog, Toast } from './Navigation';
export type {
  AppBarProps,
  BottomNavProps,
  BottomNavItem,
  SheetProps,
  ModalProps,
  ToastProps,
} from './Navigation';

export { HalalBadge, HalalCertificationPanel } from './Halal';
export type {
  HalalBadgeProps,
  HalalCertificationPanelProps,
  CertificationPanel,
  HalalDisplayState,
} from './Halal';
export { HALAL_VISIBLE_LABEL, HALAL_ACCESSIBLE_LABEL } from '../certification';

export { StatusTimeline, ORDER_STATES, ORDER_STATE_LABELS, resolveTimeline } from './StatusTimeline';
export type { StatusTimelineProps, OrderState, StepState } from './StatusTimeline';

export { setClientErrorReporter } from '../certification';
/** Alias kept for parity with the live API. */
export { setClientErrorReporter as setHalalClientErrorReporter } from '../certification';

/** Theme plumbing the redesigned app shells need. */
export { ThemeProvider, useTheme } from '../tokens';
export type { ThemeProviderProps } from '../tokens';
