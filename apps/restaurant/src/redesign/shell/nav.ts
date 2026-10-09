import type { IconName } from '../ds';

/**
 * The console rail, in the Live Orders canvas order (LO `LiveBoard` `navDefs`; open
 * question Q1 follows the newer Live Orders canvas: History is its own item). No Staff.
 * Menu, Payouts and Settings have no Solar glyph in the DS yet (#198): until they land, the
 * collapsed rail shows their name, never an unlabelled glyph.
 */
export interface NavDef {
  key: 'orders' | 'history' | 'menu' | 'hours' | 'payouts' | 'settings';
  label: string;
  to: string;
  icon?: IconName;
}

export const NAV: readonly NavDef[] = [
  { key: 'orders', label: 'Live orders', to: '/orders', icon: 'orders' },
  { key: 'history', label: 'History', to: '/orders/history' },
  { key: 'menu', label: 'Menu', to: '/menu', icon: 'menu' },
  { key: 'hours', label: 'Hours', to: '/hours', icon: 'clock' },
  { key: 'payouts', label: 'Payouts', to: '/payouts' },
  { key: 'settings', label: 'Settings', to: '/settings' },
];

/** The nav item a path belongs to; `/orders/history` is History, not Live orders. */
export function activeNavKey(pathname: string): NavDef['key'] | undefined {
  const matches = NAV.filter((n) => pathname === n.to || pathname.startsWith(`${n.to}/`));
  return matches.sort((a, b) => b.to.length - a.to.length)[0]?.key;
}
