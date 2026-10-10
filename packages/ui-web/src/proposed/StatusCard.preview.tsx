/**
 * Specimens for `StatusCard`, named after the Menu & Hours canvas part `PartNowCard` and the
 * Live Orders boards `Board-paused`, `Board-not-accepting`, `Board-auto-off` and
 * `Board-suspended` (the live design system has no preview page for it).
 */

import type { ReactNode } from 'react';

import { StatusCard } from './StatusCard.js';

/** Grouped under one heading in the preview. */
export const component = 'StatusCard';

const Card = ({ children }: { children: ReactNode }) => <div style={{ width: 1000 }}>{children}</div>;
const act = () => undefined;

/** Open: the pause menu and the switch. */
export function Open() {
  return (
    <Card>
      <StatusCard
        status="open"
        reason="You are open and taking orders."
        who="You can pause new orders for a short time, or switch them off."
        onPause={act}
        onPauseUntilClosing={act}
        closingAt="2026-10-11T03:00:00Z"
        onToggle={act}
      />
    </Card>
  );
}

/** `Board-paused`: paused with time left; Resume now. */
export function Paused() {
  return (
    <Card>
      <StatusCard status="paused" pausedUntil="2026-10-10T23:40:00Z" who="This changes by itself. Resume now to take orders straight away." onResume={act} />
    </Card>
  );
}

/** `Board-not-accepting`: switched off. */
export function SwitchedOff() {
  return (
    <Card>
      <StatusCard status="switched-off" reason="New orders are switched off. Turn on New orders to open." who="You can change this." onToggle={act} />
    </Card>
  );
}

/** `Board-auto-off`: switched off after two timeouts in a row. */
export function AutoOff() {
  return (
    <Card>
      <StatusCard status="auto-off" who="You can change this." onToggle={act} />
    </Card>
  );
}

/** Switching on: the switch holds its place until HalalGoes confirms. */
export function Switching() {
  return (
    <Card>
      <StatusCard status="switched-off" busy="toggle" reason="Turning on new orders… The switch moves when HalalGoes confirms." />
    </Card>
  );
}

/** A change failed. */
export function Failed() {
  return (
    <Card>
      <StatusCard status="open" errorText="Couldn’t pause new orders. You are still taking orders." onPause={act} />
    </Card>
  );
}

/** `Board-suspended`: locked; only support can change it. */
export function Suspended() {
  return (
    <Card>
      <StatusCard openState="CLOSED_SUSPENDED" who="Only HalalGoes support can change this." />
    </Card>
  );
}

/** The Live Orders status bar layout. */
export function Bar() {
  return (
    <Card>
      <StatusCard layout="bar" status="open" reason="Taking orders until 11:00 pm" onPause={act} onToggle={act} />
    </Card>
  );
}
