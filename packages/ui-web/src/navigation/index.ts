/**
 * Navigation and structure, web surfaces (restaurant + admin).
 *
 * The RN wayfinding components (`BottomNav`) are not here and never will be — these are
 * the pointer/keyboard surfaces, which have a persistent rail and a breadcrumb trail
 * instead of a tab bar.
 */

export { AppShell } from './AppShell.js';
export type { AppShellProps, SkipTarget } from './AppShell.js';

export { Breadcrumbs } from './Breadcrumbs.js';
export type { BreadcrumbItem, BreadcrumbsProps } from './Breadcrumbs.js';

export { SideNav } from './SideNav.js';
export type { SideNavGroup, SideNavItem, SideNavProps } from './SideNav.js';

export { TabPanel, Tabs } from './Tabs.js';
export type { TabDefinition, TabPanelProps, TabsProps, TabsVariant } from './Tabs.js';

export { TopBar } from './TopBar.js';
export type { TopBarBack, TopBarProps, TopBarVariant } from './TopBar.js';
