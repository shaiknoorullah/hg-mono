/**
 * `SegmentedControl` — two or three exclusive options that filter or switch a view mode in
 * place ("Delivery | Pickup"). Rebuilt on the shadcn/Radix `ToggleGroup` (`type="single"`).
 * Props are the live `index.d.ts`.
 *
 * - It is a radiogroup, not tabs: `role="radiogroup"` named by `label`, with `role="radio"`
 *   segments and one tab stop (roving tabindex). Arrow keys move AND select (selection follows
 *   focus, RTL-aware through Radix), Home and End jump.
 * - The selected segment cannot be deselected (a radiogroup always has one value).
 * - Tones `light` and `chrome`, role tokens only; sizes sm (36 visual, 44 hit area), md 44,
 *   lg 52. The selected segment swaps its icon to the bold weight.
 * - If the choice reveals different panels, use Tabs instead.
 */

import type { CSSProperties } from 'react';

import { ToggleGroup, ToggleGroupItem } from '../lib/ui/toggle-group.js';
import { Icon, type DsIconName } from './index.js';

/** One segment. */
export interface SegmentedControlOption {
  value: string;
  label: string;
  /** Icon swaps to the bold weight when selected. */
  icon?: DsIconName;
  disabled?: boolean;
}

/** Props of the live `SegmentedControl` (index.d.ts). */
export interface SegmentedControlProps {
  /** Required: names the radiogroup. */
  label: string;
  options: SegmentedControlOption[];
  value: string;
  onChange?: (value: string) => void;
  onValueChange?: (value: string) => void;
  /** light (cream/white) · chrome (forest bar). */
  tone?: 'light' | 'chrome';
  /** sm 36 visual (44 hit area) · md 44 · lg 52. */
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  testId?: string;
  style?: CSSProperties;
}

/** Two or three exclusive options as one radiogroup. */
export function SegmentedControl({
  label,
  options,
  value,
  onChange,
  onValueChange,
  tone = 'light',
  size = 'md',
  fullWidth = false,
  testId,
  style,
}: SegmentedControlProps) {
  const choose = (next: string) => {
    // Radix single groups allow deselecting the pressed item ("" ); a radiogroup never does.
    if (!next || next === value) return;
    if (options.find((o) => o.value === next)?.disabled) return;
    onChange?.(next);
    onValueChange?.(next);
  };
  return (
    <ToggleGroup
      type="single"
      role="radiogroup"
      aria-label={label}
      value={value}
      onValueChange={choose}
      tone={tone}
      fullWidth={fullWidth}
      rovingFocus
      loop
      data-testid={testId ?? 'SegmentedControl'}
      style={style}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <ToggleGroupItem
            key={o.value}
            value={o.value}
            disabled={o.disabled}
            tone={tone}
            size={size}
            fullWidth={fullWidth}
            // Selection follows focus, as in a native radio group.
            onFocus={() => choose(o.value)}
          >
            {o.icon ? <Icon name={o.icon} size="sm" weight={selected ? 'bold' : 'linear'} /> : null}
            {o.label}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
