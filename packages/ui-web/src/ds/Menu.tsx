/**
 * Menu — the menu-button pattern (WAI-ARIA APG "Menu Button"), on Radix DropdownMenu (live
 * `index.d.ts` and `components/Menu/README.md`, the spec of record by owner decision C-25).
 *
 * - It owns its trigger: `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`, named by
 *   `label`. The name must be UNIQUE on the page ("Actions for order HG-10482"); a duplicate is
 *   reported as `MENU_LABEL_DUPLICATE`.
 * - Popup `role="menu"`; items `menuitem` with roving focus; Radix supplies arrows, Home/End,
 *   type-ahead, Escape and the return of focus to the trigger.
 * - Rows are at least 44px. A destructive item is danger TEXT with a verb, never a fill.
 * - Disabled items stay focusable (`aria-disabled`) and show their `disabledReason`; they cannot
 *   be activated.
 * - `type: 'radio'` items (an addition, for the restaurant's availability and pause-length
 *   menus) render as `menuitemradio` with `aria-checked`; consecutive radio items form a group.
 *   An action item with `checked` set (the restaurant stub's shape) is a radio item too.
 * - A disabled item shows its reason, and its accessible name is "{label}, {reason}".
 * - Restaurant stub aliases: `trigger` (visible trigger content), `triggerLabel` (the trigger's
 *   name when `label` names the menu), `variant` (= `triggerVariant`, plus `chrome`),
 *   `separatorBefore` on an item.
 */

import { useEffect, type CSSProperties, type ReactNode } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../lib/ui/dropdown-menu.js';
import { cn } from '../lib/utils.js';
import { reportDsClientError } from './client-error.js';
import { Icon, type DsIconName } from './index.js';

/** One action row (the live `MenuItem` action shape). */
export interface MenuActionItem {
  /** Returned to onSelect. Defaults to the label. */
  key?: string;
  /** Visible text; also the type-ahead target. */
  label: string;
  icon?: DsIconName;
  /** Keyboard shortcut hint, decorative. */
  hint?: string;
  /** Danger TEXT with a verb ("Remove item") — never a fill, never colour alone. */
  destructive?: boolean;
  /** Stays focusable (aria-disabled) so its reason can be read; cannot be activated. */
  disabled?: boolean;
  disabledReason?: string;
  onSelect?: (item: MenuItem) => void;
  type?: undefined;
  /** Addition (restaurant stub): when set, the row is a `menuitemradio` with this `aria-checked`. */
  checked?: boolean;
  /** Addition (restaurant stub): draw a separator before this row. */
  separatorBefore?: boolean;
}

/** A `menuitemradio` row (addition): one choice of a set, `checked` marks the current one. */
export interface MenuRadioItem {
  type: 'radio';
  key: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onSelect?: (item: MenuItem) => void;
  /** Addition (restaurant stub): draw a separator before this row. */
  separatorBefore?: boolean;
}

/** Trigger looks. `chrome` (an addition) sits on the forest app chrome. */
export type MenuTriggerVariant = 'plain' | 'tonal' | 'filled' | 'chrome';

/** A row of the menu: an action, a separator, or (an addition) a radio choice. */
export type MenuItem = MenuActionItem | { type: 'separator' } | MenuRadioItem;

/** Props of the live `Menu` (index.d.ts). */
export interface MenuProps {
  /** REQUIRED, UNIQUE accessible name of the trigger, e.g. "Actions for order HG-10482". */
  label: string;
  items: readonly MenuItem[];
  onSelect?: (key: string, item: MenuItem) => void;
  /** Popup alignment to the trigger's logical start or end edge. */
  align?: 'start' | 'end';
  /** Icon-only trigger glyph (default "more"). */
  icon?: DsIconName;
  /** Text trigger ("Sort") with a chevron, instead of an icon. */
  triggerText?: string;
  triggerVariant?: MenuTriggerVariant;
  /** Restaurant stub alias of `triggerVariant`. */
  variant?: MenuTriggerVariant;
  /** Restaurant stub: visible trigger content instead of `triggerText` or the icon. */
  trigger?: ReactNode;
  /** Restaurant stub: the trigger's accessible name; `label` then names the popup menu. */
  triggerLabel?: string;
  /** Controlled open state (optional). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  /**
   * Addition, as on Modal and Sheet: render the popup in place instead of in a portal at the end
   * of `body` (docs and previews, where several menus are open on one page).
   */
  contained?: boolean;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

/* Trigger names on the page right now, to catch "five identical Actions buttons". */
const mountedLabels = new Map<string, number>();

function useUniqueLabel(label: string): void {
  useEffect(() => {
    const count = (mountedLabels.get(label) ?? 0) + 1;
    mountedLabels.set(label, count);
    if (count > 1) reportDsClientError('MENU_LABEL_DUPLICATE', { label, count });
    return () => {
      const left = (mountedLabels.get(label) ?? 1) - 1;
      if (left <= 0) mountedLabels.delete(label);
      else mountedLabels.set(label, left);
    };
  }, [label]);
}

type Row =
  | { kind: 'separator'; index: number }
  | { kind: 'action'; index: number; item: MenuActionItem }
  | { kind: 'radio'; index: number; items: MenuRadioItem[] };

/** An action item with `checked` set is a radio item. */
function asRadio(item: MenuActionItem): MenuRadioItem {
  return {
    type: 'radio',
    key: item.key ?? item.label,
    label: item.label,
    checked: Boolean(item.checked),
    disabled: item.disabled,
    disabledReason: item.disabledReason,
    onSelect: item.onSelect,
  };
}

/** Consecutive radio items become one radio group. */
function toRows(items: readonly MenuItem[]): Row[] {
  const rows: Row[] = [];
  items.forEach((raw, index) => {
    if (raw.type !== 'separator' && raw.separatorBefore && rows.length > 0) rows.push({ kind: 'separator', index: -index - 1 });
    const item: MenuItem = raw.type === undefined && raw.checked !== undefined ? asRadio(raw) : raw;
    if (item.type === 'separator') rows.push({ kind: 'separator', index });
    else if (item.type === 'radio') {
      const prev = rows[rows.length - 1];
      if (prev?.kind === 'radio') prev.items.push(item);
      else rows.push({ kind: 'radio', index, items: [item] });
    } else rows.push({ kind: 'action', index, item });
  });
  return rows;
}

/** The visible reason under a disabled item's label; the item's name repeats it ("Label, reason"). */
function Reason({ text }: { text: string }) {
  return <span className="text-caption text-fg-secondary">{text}</span>;
}

/** A menu button: a trigger it owns, and a popup of actions. */
export function Menu({
  label,
  items,
  onSelect,
  align = 'start',
  icon = 'more',
  triggerText,
  triggerVariant,
  variant,
  trigger,
  triggerLabel,
  open,
  onOpenChange,
  disabled = false,
  contained = false,
  testId = 'Menu',
  style,
  className,
}: MenuProps) {
  const triggerName = triggerLabel ?? (trigger ? undefined : label);
  useUniqueLabel(triggerLabel ?? label);
  const choose = (key: string, item: MenuItem, own?: (item: MenuItem) => void) => {
    own?.(item);
    onSelect?.(key, item);
  };

  return (
    <div
      data-testid={testId}
      className={cn(
        'relative inline-block',
        // In place: the popup flows under the trigger instead of floating (Radix positions it
        // `fixed` against the viewport, which a page of open specimens cannot use).
        contained && '[&_[data-radix-popper-content-wrapper]]:!static [&_[data-radix-popper-content-wrapper]]:!transform-none',
        className,
      )}
      style={style}
    >
      <DropdownMenu
        open={disabled ? false : open}
        onOpenChange={(next) => {
          if (disabled && next) return;
          onOpenChange?.(next);
        }}
        modal={false}
      >
        <DropdownMenuTrigger
          aria-label={triggerName}
          aria-disabled={disabled || undefined}
          variant={triggerVariant ?? variant ?? 'plain'}
          text={Boolean(triggerText || trigger)}
          onPointerDown={(event) => {
            if (disabled) event.preventDefault();
          }}
          onKeyDown={(event) => {
            if (disabled && ['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) event.preventDefault();
          }}
        >
          {trigger ? (
            trigger
          ) : triggerText ? (
            <>
              <span>{triggerText}</span>
              <Icon name="chevron-down" size="sm" />
            </>
          ) : (
            <Icon name={icon} size="md" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={align}
          portal={!contained}
          {...(trigger || triggerLabel ? { 'aria-label': label, 'aria-labelledby': undefined } : {})}
        >
          {toRows(items).map((row) => {
            if (row.kind === 'separator') return <DropdownMenuSeparator key={`sep-${row.index}`} />;
            if (row.kind === 'radio') {
              const value = row.items.find((r) => r.checked)?.key ?? '';
              return (
                <DropdownMenuRadioGroup key={`radio-${row.index}`} value={value}>
                  {row.items.map((radio) => {
                    const showReason = radio.disabled && radio.disabledReason;
                    return (
                      <DropdownMenuRadioItem
                        key={radio.key}
                        value={radio.key}
                        unavailable={radio.disabled}
                        textValue={radio.label}
                        aria-label={showReason ? `${radio.label}, ${radio.disabledReason}` : undefined}
                        onSelect={() => choose(radio.key, radio, radio.onSelect)}
                      >
                        <span className="grid flex-1">
                          <span>{radio.label}</span>
                          {showReason ? <Reason text={radio.disabledReason!} /> : null}
                        </span>
                      </DropdownMenuRadioItem>
                    );
                  })}
                </DropdownMenuRadioGroup>
              );
            }
            const { item } = row;
            const key = item.key ?? item.label;
            const showReason = item.disabled && item.disabledReason;
            return (
              <DropdownMenuItem
                key={key}
                destructive={item.destructive}
                unavailable={item.disabled}
                textValue={item.label}
                aria-label={showReason ? `${item.label}, ${item.disabledReason}` : undefined}
                onSelect={() => choose(key, item, item.onSelect)}
              >
                {item.icon ? <Icon name={item.icon} size="md" /> : null}
                <span className="grid flex-1">
                  <span>{item.label}</span>
                  {showReason ? <Reason text={item.disabledReason!} /> : null}
                </span>
                {item.hint ? (
                  <span aria-hidden="true" className="text-caption text-fg-secondary">
                    {item.hint}
                  </span>
                ) : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
