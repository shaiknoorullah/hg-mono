# Menu

The overflow actions on admin rows, restaurant items and account headers. It follows the **menu-button** pattern and owns its own trigger, so the wiring cannot be forgotten.

```jsx
<Menu label={`Actions for order ${o.id}`} align="end" onSelect={run} items={[
  { key: 'open', label: 'Open order' },
  { key: 'refund', label: 'Issue refund', disabled: !o.refundable, disabledReason: 'Already refunded' },
  { type: 'separator' },
  { key: 'cancel', label: 'Cancel order', destructive: true },
]} />
```

This README and `Menu.d.ts` are the specification of record (owner decision C-25).

**Roles and names**
- Trigger: `<button aria-haspopup="menu" aria-expanded aria-controls>`, named by `label`. The name must be **unique** on the page ("Actions for order HG-10482", never five "Actions" buttons).
- Popup: `role="menu"`, `aria-labelledby` pointing at the trigger, `aria-orientation="vertical"`. Items are `role="menuitem"` with `tabIndex=-1` (roving focus: the menu is not a Tab stop). Separators are `role="separator"`.

**Keyboard**
| Where | Key | Result |
|---|---|---|
| trigger | Enter, Space, ArrowDown | open, focus the **first** enabled item |
| trigger | ArrowUp | open, focus the **last** enabled item |
| menu | ArrowDown / ArrowUp | next / previous item, wrapping |
| menu | Home / End | first / last item |
| menu | printable character | **type-ahead**: prefix match on labels, case-insensitive, 500 ms buffer; repeating one letter cycles through matches |
| menu | Enter, Space | activate, close, **return focus to the trigger** |
| menu | Escape | close, **return focus to the trigger** |
| menu | Tab, Shift+Tab | close; focus moves on naturally |

Disabled items stay focusable (`aria-disabled`) so their `disabledReason` can be read. They cannot be activated.

**Pointer.** Clicking the trigger toggles the menu. A click outside closes it without pulling focus back.

**Geometry and look.** Rows are at least **44px** (`target.min`). The popup is placed with **logical** start/end (`align`) and uses `z-dropdown`, `elev-3` and `radius.md`. The highlighted item gets the hover overlay. A destructive item is `danger.600` text, never a fill, and its label carries the verb.

**Rebuild note (#109).** This maps one-to-one onto shadcn/Radix `DropdownMenu` (web) and the React Native Reusables `DropdownMenu` (native). Keep these names, keys and behaviours.
