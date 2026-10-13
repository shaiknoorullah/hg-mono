/**
 * Specimens for `PickupCode`, named after the Live Orders canvas boards `Ready-rider-here` and
 * `Ready-rider-here-code-error` (the live design system has no preview page for it). Each sits
 * in the panel's rider box width.
 */

import type { ReactNode } from 'react';

import { PickupCode } from './PickupCode.js';

/** Grouped under one heading in the preview. */
export const component = 'PickupCode';

const Box = ({ children }: { children: ReactNode }) => <div style={{ width: 400 }}>{children}</div>;
const SUPPORT = { href: 'tel:+18005550199', label: 'Call support on +1 800 555 0199' };

/** `Ready-rider-here`: the code, read digit by digit. */
export function RiderHere() {
  return (
    <Box>
      <PickupCode
        code="4827"
        help="Read this code to Daniel P. as you hand over the bag. He types it into his app, and the order moves to out for delivery."
      />
    </Box>
  );
}

/** Loading the order view. */
export function Loading() {
  return (
    <Box>
      <PickupCode code={undefined} loading />
    </Box>
  );
}

/** `Ready-rider-here-code-error`: the code failed to load. */
export function CodeError() {
  return (
    <Box>
      <PickupCode code={null} error onRetry={() => undefined} support={SUPPORT} />
    </Box>
  );
}

/** The order view has no code: the same way out, never a seal scan. */
export function Missing() {
  return (
    <Box>
      <PickupCode code="" onRetry={() => undefined} support={SUPPORT} />
    </Box>
  );
}
