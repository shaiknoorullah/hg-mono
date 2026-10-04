import { useLocation, useNavigate, Outlet } from 'react-router-dom';
import { AppShell, Icon, SideNav, Wordmark, cx, type IconName, type SideNavItem } from '@hg/ui-web';
import { useAuth } from '../lib/auth';
import { IconMenuBook, IconWallet, IconUsers, IconSettings, IconLogout } from '../lib/icons';

/**
 * The persistent restaurant-operator chrome, on the shared `AppShell` + `SideNav` frame
 * (`@hg/ui-web` navigation tier) instead of a bespoke aside. `SideNav` is glass — a
 * translucent surface with a real backdrop blur — and its active row is a soft orange tint
 * with a solid 4px orange accent bar, never green (RULE H-1: solid green is reserved to
 * `color.halal.*` alone; this is wayfinding chrome, not a certification).
 *
 * Semantic `Icon` names cover Orders (checklist) and Hours (clock); Menu, Payouts, Staff and
 * Settings have no match in the shared primitive's small cross-platform set, so those keep
 * the app's own hand-drawn glyphs (`../lib/icons`) — exactly the "keep anything the system has
 * no equivalent for" case.
 */
const NAV: { key: string; to: string; label: string; icon: IconName | 'menu-book' | 'wallet' | 'users' | 'settings' }[] = [
  { key: 'orders', to: '/orders', label: 'Orders', icon: 'orders' },
  { key: 'menu', to: '/menu', label: 'Menu', icon: 'menu-book' },
  { key: 'hours', to: '/hours', label: 'Hours', icon: 'clock' },
  { key: 'payouts', to: '/payouts', label: 'Payouts', icon: 'wallet' },
  { key: 'staff', to: '/staff', label: 'Staff', icon: 'users' },
  { key: 'settings', to: '/settings', label: 'Settings', icon: 'settings' },
];

// The mobile bottom pill keeps only the highest-frequency destinations — six items in a
// thumb-reach bar reads as clutter, and Settings/Staff are desk tasks, not floor tasks.
// `@hg/ui-web` has no web bottom-nav equivalent (`BottomNav` is native-only, by design — see
// navigation/index.ts), so this stays a small local composition, retoned onto the shared
// tokens instead of the app's old bespoke palette.
const MOBILE_NAV = NAV.slice(0, 4);

function navGlyph(icon: (typeof NAV)[number]['icon'], active: boolean) {
  const weight = active ? 'bold' : 'linear';
  switch (icon) {
    case 'menu-book':
      return <IconMenuBook size={18} />;
    case 'wallet':
      return <IconWallet size={18} />;
    case 'users':
      return <IconUsers size={18} />;
    case 'settings':
      return <IconSettings size={18} />;
    default:
      return <Icon name={icon} weight={weight} size={18} />;
  }
}

export function Shell() {
  const { logout, principal } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const activeKey = NAV.find((item) => location.pathname.startsWith(item.to))?.key;

  const items: SideNavItem[] = NAV.map((item) => ({
    key: item.key,
    label: item.label,
    href: item.to,
    onSelect: (key) => {
      const target = NAV.find((n) => n.key === key);
      if (target) navigate(target.to);
    },
    icon: navGlyph(item.icon, item.key === activeKey),
  }));

  return (
    <div className="min-h-dvh">
      <AppShell
        sideNav={
          <div className="hidden md:block">
            <SideNav
              groups={[{ key: 'main', items }]}
              activeKey={activeKey}
              header={
                <div className="flex flex-col items-start gap-0.5 px-1 py-1">
                  <Wordmark height={34} />
                  <p className="text-label-sm text-fg-tertiary">for restaurants</p>
                </div>
              }
              footer={
                <div>
                  <p className="truncate px-1 text-label-sm text-fg-tertiary">
                    {principal?.roles?.[0]?.role ?? 'Restaurant operator'}
                  </p>
                  <button
                    type="button"
                    onClick={() => void logout()}
                    className="mt-2 flex min-h-11 w-full items-center gap-2.5 rounded-md px-2 text-label-lg font-semibold text-fg-secondary hg-focus-inset hover:bg-surface-subtle"
                  >
                    <IconLogout size={17} />
                    Sign out
                  </button>
                </div>
              }
            />
          </div>
        }
      >
        <div className="pb-24 md:pb-0">
          <Outlet />
        </div>
      </AppShell>

      {/* Narrow viewports: no persistent rail, a detached glass-pill bottom bar instead.
          `@hg/ui-web` ships no web bottom-nav (`BottomNav` is native-only by design), so this
          stays a small local composition, retoned onto the shared tokens. */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-3 bottom-3 z-(--hg-z-sticky) flex items-center justify-around rounded-full border border-line-decorative bg-surface-base/92 px-2 py-2 shadow-e3 backdrop-blur-md md:hidden"
      >
        {MOBILE_NAV.map((item) => {
          const active = item.key === activeKey;
          return (
            <button
              key={item.key}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(item.to)}
              className={cx(
                'flex flex-col items-center gap-0.5 rounded-full px-4 py-1.5 text-label-sm font-bold hg-focus-inset',
                active ? 'text-action-primary-bg' : 'text-fg-secondary',
              )}
            >
              {navGlyph(item.icon, active)}
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
