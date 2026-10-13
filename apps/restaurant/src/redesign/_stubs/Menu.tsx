/**
 * TEMPORARY STUB for the DS `Menu` (live index.d.ts; ds-request(web): Menu with
 * menuitemradio). Delete when `@hg/ui-web/ds` exports it.
 *
 * A button that opens a `role="menu"` list below it. Arrow keys move, Home/End jump, Enter
 * or Space chooses, Escape closes and returns focus to the trigger. `checked` items are
 * `menuitemradio` with `aria-checked` (the availability and pause-length menus need it).
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface MenuItemDef {
  key: string;
  label: string;
  onSelect?: () => void;
  disabled?: boolean;
  /** Shown under a disabled item, and appended to its accessible name. */
  disabledReason?: string;
  /** Radio semantics when defined. */
  checked?: boolean;
  separatorBefore?: boolean;
}

export interface MenuProps {
  /** Accessible name of the menu, e.g. "Pause new orders". */
  label: string;
  /** Visible trigger content. */
  trigger: ReactNode;
  /** Accessible name of the trigger when it differs from its text. */
  triggerLabel?: string;
  items: readonly MenuItemDef[];
  align?: 'start' | 'end';
  variant?: 'tonal' | 'plain' | 'chrome';
  disabled?: boolean;
  className?: string;
  testId?: string;
}

const TRIGGER = {
  tonal: 'bg-surface-subtle text-fg-primary border border-line-interactive',
  plain: 'bg-transparent text-fg-primary',
  chrome: 'bg-transparent text-fg-on-accent border border-transparent',
} as const;

export function Menu({ label, trigger, triggerLabel, items, align = 'start', variant = 'tonal', disabled, className, testId }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);

  useEffect(() => {
    if (!open) return;
    const first = items.findIndex((it) => it.checked && !it.disabled);
    setActive(first >= 0 ? first : (enabled[0] ?? 0));
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelectorAll<HTMLElement>('[data-menu-item]')[active]?.focus();
  }, [open, active]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const move = (dir: 1 | -1) => {
    const pos = enabled.indexOf(active);
    const next = enabled[(pos + dir + enabled.length) % enabled.length];
    if (next !== undefined) setActive(next);
  };

  return (
    <div ref={rootRef} className={`relative inline-block ${className ?? ''}`} data-testid={testId}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={triggerLabel}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={`hg-focus inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-[15px] font-semibold disabled:opacity-50 ${TRIGGER[variant]}`}
      >
        {trigger}
      </button>
      {open ? (
        <ul
          ref={listRef}
          id={id}
          role="menu"
          aria-label={label}
          className={`absolute top-full z-50 mt-1 min-w-56 rounded-md border border-line-decorative bg-surface-raised p-1 text-fg-primary shadow-lg ${align === 'end' ? 'right-0' : 'left-0'}`}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              move(1);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              move(-1);
            } else if (e.key === 'Home') {
              e.preventDefault();
              if (enabled[0] !== undefined) setActive(enabled[0]);
            } else if (e.key === 'End') {
              e.preventDefault();
              const last = enabled[enabled.length - 1];
              if (last !== undefined) setActive(last);
            } else if (e.key === 'Escape' || e.key === 'Tab') {
              e.preventDefault();
              close();
            }
          }}
        >
          {items.map((item, i) => (
            <li key={item.key} role="none">
              {item.separatorBefore ? <div role="separator" className="my-1 h-px bg-line-decorative" /> : null}
              <button
                type="button"
                data-menu-item
                role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked={item.checked === undefined ? undefined : item.checked}
                aria-disabled={item.disabled || undefined}
                aria-label={item.disabled && item.disabledReason ? `${item.label}, ${item.disabledReason}` : undefined}
                tabIndex={i === active ? 0 : -1}
                onClick={() => {
                  if (item.disabled) return;
                  close();
                  item.onSelect?.();
                }}
                className={`hg-focus flex min-h-11 w-full flex-col items-start justify-center rounded px-3 py-1 text-left text-[15px] ${
                  item.disabled ? 'cursor-not-allowed text-fg-secondary' : 'hover:bg-surface-subtle'
                } ${item.checked ? 'font-bold' : ''}`}
              >
                <span>
                  {item.checked ? '✓ ' : ''}
                  {item.label}
                  {item.checked ? <span className="sr-only">, current</span> : null}
                </span>
                {item.disabled && item.disabledReason ? <span className="text-[13px] text-fg-secondary">{item.disabledReason}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
