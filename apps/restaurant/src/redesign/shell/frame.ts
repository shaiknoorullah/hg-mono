/**
 * Which console pages draw the compact frame the Settings and Payouts boards show
 * (`PartTop`, `PartNewOrders`): the app bar carries the connection, sound and halal badges, there
 * is no separate service status bar, and the new-orders strip is one row with the Accepting orders
 * switch. Every other page keeps the status bar and the tall strip, as its boards draw them
 * (Live orders, Menu, Hours). Below 768 px the phone boards are a different frame.
 */
export function isCompactFrame(pathname: string, isPhone: boolean): boolean {
  if (isPhone) return false;
  return /^\/(settings|payouts)(\/|$)/.test(pathname);
}
