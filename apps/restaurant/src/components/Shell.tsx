import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { IconQueue, IconMenuBook, IconStore, IconLogout } from '../lib/icons';
import { cx } from './primitives';

const NAV = [
  { to: '/orders', label: 'Orders', icon: IconQueue },
  { to: '/menu', label: 'Menu', icon: IconMenuBook },
  { to: '/hours', label: 'Hours', icon: IconStore },
];

/**
 * The detached glass-pill nav from docs/design/reference/customer-home.html, ported to
 * a left rail for a desk-bound operator surface (a restaurant tablet is not a thumb-reach
 * phone) but keeping the same material: translucent card, hairline border, pill radius.
 */
export function Shell() {
  const { logout, principal } = useAuth();

  return (
    <div className="flex min-h-screen bg-[var(--canvas)]">
      <aside className="sticky top-0 hidden h-screen w-[248px] flex-col justify-between border-r border-[var(--hair)] bg-[var(--accent-900)] px-4 py-6 text-white md:flex">
        <div>
          <div className="mb-8 flex items-center gap-2 px-2">
            <div className="grid h-9 w-9 place-items-center rounded-[var(--r-sm)] bg-[var(--halal-seal)] text-white shadow-[var(--shadow-1)]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C7.58172 2 4 6.00258 4 10.5C4 14.9622 6.55332 19.8124 10.5371 21.6744C11.4657 22.1085 12.5343 22.1085 13.4629 21.6744C17.4467 19.8124 20 14.9622 20 10.5C20 6.00258 16.4183 2 12 2Z" />
              </svg>
            </div>
            <div>
              <p className="text-[13.5px] font-extrabold leading-tight">Halal Goes</p>
              <p className="text-[11px] font-semibold text-[var(--accent-300)]">for restaurants</p>
            </div>
          </div>
          <nav className="flex flex-col gap-1">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cx(
                    'flex items-center gap-3 rounded-[var(--r-pill)] px-3.5 py-2.5 text-[13.5px] font-bold transition-colors',
                    isActive
                      ? 'bg-white text-[var(--accent-900)]'
                      : 'text-[var(--accent-100)] hover:bg-[color-mix(in_srgb,white_10%,transparent)]',
                  )
                }
              >
                <Icon size={18} />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="border-t border-[color-mix(in_srgb,white_14%,transparent)] pt-4">
          <p className="truncate px-2 text-[12px] font-semibold text-[var(--accent-300)]">
            {principal?.roles?.[0]?.role ?? 'Restaurant operator'}
          </p>
          <button
            onClick={() => void logout()}
            className="mt-2 flex w-full items-center gap-2.5 rounded-[var(--r-pill)] px-3.5 py-2.5 text-[13.5px] font-bold text-[var(--accent-100)] transition-colors hover:bg-[color-mix(in_srgb,white_10%,transparent)]"
          >
            <IconLogout size={17} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile bottom glass-pill nav — the actual reference pattern, for narrow viewports. */}
      <nav className="fixed inset-x-3 bottom-3 z-40 flex items-center justify-around rounded-[var(--r-pill)] border border-[color-mix(in_srgb,var(--ink)_8%,transparent)] bg-[color-mix(in_srgb,var(--card)_92%,transparent)] px-2 py-2 shadow-[0_12px_30px_-10px_rgba(30,10,14,.35)] backdrop-blur-md md:hidden">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cx(
                'flex flex-col items-center gap-0.5 rounded-[var(--r-pill)] px-4 py-1.5 text-[10.5px] font-bold transition-colors',
                isActive ? 'text-[var(--primary)]' : 'text-[var(--ink2)]',
              )
            }
          >
            <Icon size={19} />
            {label}
          </NavLink>
        ))}
      </nav>

      <main className="min-w-0 flex-1 pb-24 md:pb-0">
        <Outlet />
      </main>
    </div>
  );
}
