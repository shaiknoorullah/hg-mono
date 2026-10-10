/**
 * HalalBadge specimens, named after the rows of the live components/HalalBadge/preview.html.
 */

import { HalalBadge } from './HalalBadge.js';

/** The live design system's component name. */
export const component = 'HalalBadge';

const noop = () => {};

/** CERTIFIED at sm, md and lg: the green seal with its brass ring. */
export function Certified() {
  return (
    <div className="hg-specimen-row">
      <HalalBadge state="CERTIFIED" size="sm" />
      <HalalBadge state="CERTIFIED" />
      <HalalBadge state="CERTIFIED" size="lg" />
    </div>
  );
}

/** EXPIRING_SOON: the amber plate with the clock shield and the short date; no date, no date shown. */
export function ExpiringSoon() {
  return (
    <div className="hg-specimen-row">
      <HalalBadge state="EXPIRING_SOON" size="sm" expiresOn="2026-10-14" />
      <HalalBadge state="EXPIRING_SOON" expiresOn="2026-10-14" />
      <HalalBadge state="EXPIRING_SOON" size="lg" expiresOn="2026-10-14" />
      <HalalBadge state="EXPIRING_SOON" />
    </div>
  );
}

/** EXPIRED: slate, hollow shield, never red. */
export function Expired() {
  return (
    <div className="hg-specimen-row">
      <HalalBadge state="EXPIRED" />
    </div>
  );
}

/** UNVERIFIED: operational only (dashed); card and detail render nothing. */
export function Unverified() {
  return (
    <div className="hg-specimen-row">
      <HalalBadge state="UNVERIFIED" surface="operational" />
    </div>
  );
}

/** The detail surface with onPress: a button with a chevron. */
export function DetailPress() {
  return (
    <div className="hg-specimen-row">
      <HalalBadge state="CERTIFIED" size="lg" surface="detail" certifyingBodyName="HMA" expiresOn="2027-03-14" onPress={noop} />
      <HalalBadge state="EXPIRING_SOON" size="lg" surface="detail" certifyingBodyName="HMA" expiresOn="2026-10-14" onPress={noop} />
    </div>
  );
}

/** A missing state renders nothing (and reports HALAL_DISPLAY_STATE_MISSING). */
export function StateMissing() {
  return (
    <div className="hg-specimen-row">
      <HalalBadge state={null} restaurantId="rst_demo" />
      <span>(nothing rendered)</span>
    </div>
  );
}

/** The operational surface in an admin grid row: all four states side by side. */
export function Operational() {
  return (
    <div className="hg-specimen-row">
      <HalalBadge state="CERTIFIED" surface="operational" />
      <HalalBadge state="EXPIRING_SOON" surface="operational" expiresOn="2026-10-20" />
      <HalalBadge state="EXPIRED" surface="operational" />
      <HalalBadge state="UNVERIFIED" surface="operational" />
    </div>
  );
}
