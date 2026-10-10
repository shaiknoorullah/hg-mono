/**
 * Specimens for `MapPinPicker`, named after the restaurant `onboarding/Profile-Pin*` boards
 * (the live design system has no preview page for it). The map states run on a stand-in map
 * engine (`__fixtures__/fake-mapbox`).
 */

import type { ReactNode } from 'react';

import { MapPinPicker } from './MapPinPicker.js';
import { loadFakeMapbox } from './__fixtures__/fake-mapbox.js';

/** Grouped under one heading in the preview. */
export const component = 'MapPinPicker';

const PLACED = { latitude: 43.7309, longitude: -79.2641 };
const MOVED = { latitude: 43.731, longitude: -79.2643 };
const Box = ({ children }: { children: ReactNode }) => <div style={{ width: 520 }}>{children}</div>;
const noop = () => undefined;
const never = () => new Promise<never>(() => undefined);

/** `Profile-PinPlaced`. */
export function PinPlaced() {
  return (
    <Box>
      <MapPinPicker accessToken="pk.preview" loadMapbox={loadFakeMapbox} value={PLACED} origin={PLACED} onChange={noop} />
    </Box>
  );
}

/** `Profile-PinMoved`. */
export function PinMoved() {
  return (
    <Box>
      <MapPinPicker accessToken="pk.preview" loadMapbox={loadFakeMapbox} value={MOVED} origin={PLACED} onChange={noop} />
    </Box>
  );
}

/** `Profile-Location`: no pin until an address is picked. */
export function NoPin() {
  return (
    <Box>
      <MapPinPicker accessToken="pk.preview" loadMapbox={loadFakeMapbox} value={null} onChange={noop} />
    </Box>
  );
}

/** No token: the same pin and keys without a map. */
export function NoMap() {
  return (
    <Box>
      <MapPinPicker accessToken="" loadMapbox={never} value={PLACED} origin={PLACED} onChange={noop} />
    </Box>
  );
}
