/**
 * IconButton specimens, named after the rows of the live components/IconButton/preview.html.
 */

import { IconButton } from './IconButton.js';

/** The live design system's component name. */
export const component = 'IconButton';

/** plain, filled, tonal with a dot, tonal circle with a count. */
export function Variants() {
  return (
    <div className="hg-specimen-row">
      <IconButton icon="search" accessibilityLabel="Search" />
      <IconButton icon="plus" accessibilityLabel="Add item" variant="filled" />
      <IconButton icon="bell" accessibilityLabel="Notifications" variant="tonal" badge />
      <IconButton icon="cart" accessibilityLabel="Cart" badgeNoun="items" badge={3} variant="tonal" shape="circle" />
    </div>
  );
}

/** sm 36, md 44, lg 56. */
export function Sizes() {
  return (
    <div className="hg-specimen-row">
      <IconButton icon="close" accessibilityLabel="Close" size="sm" />
      <IconButton icon="close" accessibilityLabel="Close" size="md" />
      <IconButton icon="close" accessibilityLabel="Close" size="lg" />
    </div>
  );
}

/** Bold weight, loading, disabled. */
export function States() {
  return (
    <div className="hg-specimen-row">
      <IconButton icon="star" accessibilityLabel="Save to favourites" weight="bold" />
      <IconButton icon="refresh" accessibilityLabel="Refresh" loading variant="tonal" />
      <IconButton icon="plus" accessibilityLabel="Add item" disabled variant="filled" />
    </div>
  );
}
