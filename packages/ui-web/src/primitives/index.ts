/**
 * Tier 1 primitives (02-components.md) plus the feedback primitives the
 * foundation owns. Everything here is web-only; the Expo apps consume the
 * NativeWind preset instead.
 */

export { Button } from './Button.js';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button.js';

export { Icon, ICON_NAMES, SOLAR_ICON_IDS } from './Icon.js';
export type { IconProps, IconName, IconWeight } from './Icon.js';

export { Wordmark } from './Wordmark.js';
export type { WordmarkProps } from './Wordmark.js';

export { IconButton } from './IconButton.js';
export type { IconButtonProps, IconButtonVariant, IconButtonSize } from './IconButton.js';

export { Input } from './Input.js';
export type { InputProps, InputVariant } from './Input.js';

export { Textarea } from './Textarea.js';
export type { TextareaProps } from './Textarea.js';

export { Select } from './Select.js';
export type { SelectProps, SelectOption } from './Select.js';

export { Checkbox } from './Checkbox.js';
export type { CheckboxProps } from './Checkbox.js';

export { RadioGroup } from './Radio.js';
export type { RadioGroupProps, RadioOption } from './Radio.js';

export { Switch } from './Switch.js';
export type { SwitchProps } from './Switch.js';

export { Chip } from './Chip.js';
export type { ChipProps, ChipVariant, ChipTone } from './Chip.js';

export { Avatar } from './Avatar.js';
export type { AvatarProps, AvatarSize } from './Avatar.js';

export { Skeleton } from './Skeleton.js';
export type { SkeletonProps } from './Skeleton.js';

export { Spinner } from './Spinner.js';
export type { SpinnerProps } from './Spinner.js';

export { Divider } from './Divider.js';
export type { DividerProps } from './Divider.js';

// Toasts are raised imperatively: wrap once in <ToastProvider>, then useToast().
// There is no free-standing <Toast> element — a toast that can be rendered
// inline can be rendered twice, and stacking/pausing stop working.
export { ToastProvider, useToast } from './Toast.js';
export type { ToastOptions, ToastVariant } from './Toast.js';

export { Tooltip, TooltipProvider } from './Tooltip.js';
export type { TooltipProps } from './Tooltip.js';

export { Popover } from './Popover.js';
export type { PopoverProps } from './Popover.js';

// `cx` is deliberately NOT re-exported: the certification and feedback tiers
// each ship their own copy, and three identical helpers colliding in the root
// barrel is an integration problem, not a feature. Import it from
// './utils/cx.js' inside this tier.
export {
  HG_FOCUS,
  HG_FOCUS_INSET,
  HG_FOCUS_FIELD,
  focusOn,
  focusRingColor,
} from './utils/focus.js';
export type { FocusContainer } from './utils/focus.js';
