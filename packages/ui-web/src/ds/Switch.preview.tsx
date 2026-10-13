/**
 * Switch specimens for the design preview. `full` mirrors the live
 * components/Switch/preview.html; `sizes-and-loading` shows sm and the held position.
 */

import { useState } from 'react';

import { Switch } from './Switch.js';

/** The live design system's component name. */
export const component = 'Switch';

/** The reference page: open with a description, a slow server toggle, a disabled sold-out item. */
export function Full() {
  const [open, setOpen] = useState(true);
  const [online, setOnline] = useState(false);
  const [saving, setSaving] = useState(false);
  const slow = (next: boolean) => {
    setSaving(true);
    setTimeout(() => {
      setOnline(next);
      setSaving(false);
    }, 1500);
  };
  return (
    <div style={{ display: 'grid', gap: 12, width: 480 }}>
      <Switch
        label="Accepting orders"
        description="Customers can order from your storefront"
        stateLabel={{ on: 'Open', off: 'Closed' }}
        checked={open}
        onCheckedChange={setOpen}
      />
      <Switch label="Online for deliveries" stateLabel={{ on: 'Online', off: 'Offline' }} checked={online} loading={saving} onCheckedChange={slow} />
      <Switch label="Item available" stateLabel={{ on: 'Available', off: 'Sold out' }} checked={false} disabled />
    </div>
  );
}

/** sm size, loading (held off), and an error. */
export function SizesAndLoading() {
  return (
    <div style={{ display: 'grid', gap: 12, width: 480 }}>
      <Switch label="Small, on" size="sm" stateLabel={{ on: 'On', off: 'Off' }} checked />
      <Switch label="Saving, still off" stateLabel={{ on: 'Open', off: 'Closed' }} checked={false} loading />
      <Switch label="Auto-accept" stateLabel={{ on: 'On', off: 'Off' }} checked={false} error="Couldn’t save. Try again." />
    </div>
  );
}
