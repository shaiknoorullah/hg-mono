/**
 * Menu specimens for the design preview. `Full` mirrors the live components/Menu/preview.html:
 * an icon trigger and an open "Sort" text menu. `Item states` opens the item menu to show the
 * disabled reason and the destructive row; `Radio` is the menuitemradio addition.
 */

import { Menu, type MenuItem } from './Menu.js';

/** The design system's component name, pairing these specimens with its preview page. */
export const component = 'Menu';

const ITEMS: MenuItem[] = [
  { key: 'edit', label: 'Edit item' },
  { key: 'dup', label: 'Duplicate' },
  { key: 'hide', label: 'Hide from menu', hint: '⌘H' },
  { key: 'price', label: 'Change price', disabled: true, disabledReason: 'Locked while an order is open' },
  { type: 'separator' },
  { key: 'remove', label: 'Remove item', destructive: true },
];

/** The reference page: icon trigger, and the Sort menu open. */
export function Full() {
  return (
    <div className="hg-specimen-col" style={{ minHeight: 260 }}>
      <div className="hg-specimen-row">
        <Menu label="Actions for Chicken shawarma plate" items={ITEMS} />
        <Menu
          label="Sort orders"
          triggerText="Sort"
          open
          onOpenChange={() => undefined}
          items={[
            { key: 'new', label: 'Newest first' },
            { key: 'old', label: 'Oldest first' },
            { key: 'total', label: 'Total, high to low' },
          ]}
        />
        <span style={{ color: 'var(--hg-text-secondary)' }}>Last chosen: —</span>
      </div>
    </div>
  );
}

/** The item menu open: hint, disabled reason, separator and the destructive row. */
export function ItemStates() {
  return (
    <div style={{ minHeight: 320 }}>
      <Menu label="Actions for Lentil soup" items={ITEMS} open onOpenChange={() => undefined} />
    </div>
  );
}

/** Pause length as menuitemradio rows (addition). */
export function Radio() {
  return (
    <div style={{ minHeight: 220 }}>
      <Menu
        label="Pause new orders for"
        triggerText="Pause"
        triggerVariant="tonal"
        open
        onOpenChange={() => undefined}
        items={[
          { type: 'radio', key: '15', label: '15 minutes', checked: false },
          { type: 'radio', key: '30', label: '30 minutes', checked: true },
          { type: 'radio', key: 'rest', label: 'Rest of today', checked: false },
        ]}
      />
    </div>
  );
}
