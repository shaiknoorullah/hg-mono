/**
 * Live design-system `Menu` (WAI-ARIA "Menu Button"). `@hg/ui-web` has no menu button (its
 * Radix dependency is not reachable from the app), so the live props are implemented here:
 * the trigger carries `aria-haspopup="menu"` and `aria-expanded`; the popup is `role="menu"`
 * with roving focus (Up/Down/Home/End), type-ahead, Escape returning focus to the trigger;
 * a disabled item stays focusable with its reason readable; destructive items are danger
 * TEXT with a verb, never a fill.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';

import { cx } from '../internal/cx';
import { FOCUS, FOCUS_INSET, focusElement } from '../internal/focus';
import { Icon, type AnyIconName } from './Icon.adapter';

export type MenuItem =
  | {
      key?: string;
      label: string;
      icon?: AnyIconName;
      hint?: string;
      destructive?: boolean;
      disabled?: boolean;
      disabledReason?: string;
      onSelect?: (item: MenuItem) => void;
      type?: undefined;
    }
  | { type: 'separator' };

export interface MenuProps {
  /** REQUIRED, UNIQUE accessible name of the trigger. */
  label: string;
  items: MenuItem[];
  onSelect?: (key: string, item: MenuItem) => void;
  align?: 'start' | 'end';
  icon?: AnyIconName;
  /** Text trigger ("More actions") with a chevron, instead of an icon. */
  triggerText?: string;
  triggerVariant?: 'plain' | 'tonal' | 'filled';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

type ActionItem = Exclude<MenuItem, { type: 'separator' }>;

const TRIGGER = {
  plain: 'bg-transparent text-fg-primary',
  tonal: 'bg-surface-subtle text-fg-primary border border-line-interactive',
  filled: 'bg-surface-chrome text-fg-on-accent',
};

export function Menu({
  label,
  items,
  onSelect,
  align = 'end',
  icon = 'more',
  triggerText,
  triggerVariant = 'tonal',
  open: openProp,
  onOpenChange,
  disabled,
  testId = 'Menu',
  style,
  className,
}: MenuProps): React.JSX.Element {
  const id = useId();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };

  const actions = items.filter((i): i is ActionItem => i.type !== 'separator');

  useEffect(() => {
    if (!open) return;
    const first = listRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    focusElement(first);
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!listRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    setOpen(false);
    focusElement(triggerRef.current);
  };

  const choose = (item: ActionItem) => {
    if (item.disabled) return;
    const key = item.key ?? item.label;
    close();
    item.onSelect?.(item);
    onSelect?.(key, item);
  };

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const nodes = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = nodes.indexOf(document.activeElement as HTMLElement);
    const move = (i: number) => focusElement(nodes[(i + nodes.length) % nodes.length]);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(at + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(at - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      move(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      move(nodes.length - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      setOpen(false);
    } else if (event.key.length === 1 && /\S/.test(event.key)) {
      const ch = event.key.toLowerCase();
      const from = at + 1;
      for (let k = 0; k < nodes.length; k++) {
        const n = nodes[(from + k) % nodes.length];
        if (n?.textContent?.trim().toLowerCase().startsWith(ch)) {
          focusElement(n);
          break;
        }
      }
    }
  };

  return (
    <div className={cx('relative inline-flex', className)} style={style} data-testid={testId}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-label={triggerText ? (triggerText === label ? undefined : label) : label}
        aria-disabled={disabled || undefined}
        className={cx(
          'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md px-3 text-label-lg',
          TRIGGER[triggerVariant],
          FOCUS,
          disabled && 'cursor-not-allowed opacity-(--hg-state-disabled-opacity)',
        )}
        onClick={() => {
          if (!disabled) setOpen(!open);
        }}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {triggerText ? (
          <>
            <span>{triggerText}</span>
            <Icon name="chevron-down" size="sm" />
          </>
        ) : (
          <Icon name={icon} size="md" />
        )}
      </button>
      {open ? (
        <div
          ref={listRef}
          id={`${id}-menu`}
          role="menu"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={onListKey}
          className={cx(
            'absolute top-full z-40 mt-1 flex min-w-56 flex-col rounded-md border border-line-decorative bg-surface-raised py-1 shadow-e2',
            align === 'end' ? 'end-0' : 'start-0',
          )}
        >
          {items.map((item, i) => {
            if (item.type === 'separator') {
              return <div key={`sep-${i}`} role="separator" className="my-1 h-px bg-line-decorative" />;
            }
            const reasonId = item.disabledReason ? `${id}-r${i}` : undefined;
            return (
              <div
                key={item.key ?? item.label}
                role="menuitem"
                tabIndex={-1}
                aria-disabled={item.disabled || undefined}
                aria-describedby={reasonId}
                onClick={() => choose(item)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    choose(item);
                  }
                }}
                className={cx(
                  'flex min-h-11 cursor-pointer flex-col justify-center px-3 py-2 text-body-md',
                  FOCUS_INSET,
                  item.destructive ? 'text-feedback-danger-text' : 'text-fg-primary',
                  item.disabled ? 'cursor-not-allowed text-fg-disabled' : 'hover:bg-surface-subtle',
                )}
              >
                <span className="flex items-center gap-2">
                  {item.icon ? <Icon name={item.icon} size="sm" /> : null}
                  <span className="flex-1">{item.label}</span>
                  {item.hint ? (
                    <span aria-hidden="true" className="text-body-sm text-fg-tertiary">
                      {item.hint}
                    </span>
                  ) : null}
                </span>
                {item.disabledReason ? (
                  <span id={reasonId} className="text-body-sm text-fg-tertiary">
                    {item.disabledReason}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
