/**
 * Specimens for `AddressCombobox`, named after the restaurant `onboarding/Profile-*` boards
 * (the live design system has no preview page for it). Searches answer from a fixed list with
 * no delay, so the open list is in the screenshot.
 */

import type { ReactNode } from 'react';

import { AddressCombobox } from './AddressCombobox.js';

/** Grouped under one heading in the preview. */
export const component = 'AddressCombobox';

const RESULTS = [
  { place_id: 'a', title: '2872 Eglinton Ave E', subtitle: 'Toronto, ON M1J 2E1' },
  { place_id: 'b', title: '2872 Eglinton Ave W', subtitle: 'Toronto, ON M6M 1V1' },
  { place_id: 'c', title: '2872 Eglinton Ave E, Unit 4', subtitle: 'Toronto, ON M1J 2E1' },
];
const Box = ({ children }: { children: ReactNode }) => <div style={{ width: 520, minHeight: 280 }}>{children}</div>;
const noop = () => undefined;
const nothing = async () => null;

/** Before typing. */
export function Idle() {
  return (
    <Box>
      <AddressCombobox suggest={async () => RESULTS} resolve={nothing} onResolve={noop} onManualEntry={noop} />
    </Box>
  );
}

/** `Profile-Location`: searching, three matches. */
export function Location() {
  return (
    <Box>
      <AddressCombobox defaultQuery="2872 Eglint" debounceMs={0} suggest={async () => RESULTS} resolve={nothing} onResolve={noop} onManualEntry={noop} />
    </Box>
  );
}

/** `Profile-SearchError`: no match, the manual way out. */
export function SearchError() {
  return (
    <Box>
      <AddressCombobox defaultQuery="2872 Eglington Avenue" debounceMs={0} suggest={async () => []} resolve={nothing} onResolve={noop} onManualEntry={noop} />
    </Box>
  );
}

/** The geocoder is down (503): the manual form and the pin still work. */
export function Unavailable() {
  return (
    <Box>
      <AddressCombobox
        defaultQuery="2872 Eglinton"
        debounceMs={0}
        suggest={() => Promise.reject(new Error('GEOCODER_UNAVAILABLE'))}
        resolve={nothing}
        onResolve={noop}
        onManualEntry={noop}
      />
    </Box>
  );
}
