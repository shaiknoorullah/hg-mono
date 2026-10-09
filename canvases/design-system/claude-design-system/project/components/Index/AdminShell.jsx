/* Admin shell. Nav mirrors apps/admin/src/App.tsx routes. No Export, no Alerts bell
   (no contract operation behind either, K-47). Wordmark: HalalGoes (K-01).
   Nav items carry no icons: Solar has no store/bike/wallet/settings glyph, and a nav where
   only some items have icons reads as broken, so every item is text-only (icon gap). */
const { AppBar, Button } = window.HalalGoesDesignSystem_d11a47;

const ADMIN_NAV = [
  { value: 'queue', label: 'Restaurant queue', count: 4 },
  { value: 'riders', label: 'Rider queue', count: 2 },
  { value: 'menu', label: 'Menu reviews', count: 2 },
  { value: 'orders', label: 'Orders' },
  { value: 'refunds', label: 'Refunds & disputes' },
  { value: 'bodies', label: 'Issuing bodies' },
  { value: 'staff', label: 'Staff' },
  { value: 'system', label: 'System' },
];

function AdminShell({ nav, title, subtitle, go, actions, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '264px minmax(0,1fr)', minHeight: 780, background: 'var(--surface-base)' }}>
      <aside style={{ background: 'var(--surface-chrome)', color: 'var(--text-on-accent)', display: 'grid', gridTemplateRows: 'auto 1fr auto' }}>
        <div style={{ padding: '18px 18px 14px' }}>
          <GapWordmark size={19} tone="onDark" sub="Operations · Ontario" />
        </div>
        <GapSideNav items={ADMIN_NAV} value={nav} onChange={v => go(v)} />
        <div style={{ padding: 14, borderTop: '1px solid var(--color-accent-700)', fontSize: 'var(--type-caption-size)', display: 'grid', gap: 4 }}>
          <span style={{ fontWeight: 600 }}>Aminah R.</span>
          <span style={{ opacity: .8 }}>ADMIN · TOTP on</span>
        </div>
      </aside>
      <main style={{ display: 'grid', gridTemplateRows: 'auto 1fr', minWidth: 0 }}>
        <AppBar tone="raised" title={title} subtitle={subtitle}
          actions={<>{actions}<Button variant="ghost" size="sm">Sign out</Button></>} />
        <div style={{ overflowY: 'auto', padding: 'var(--space-6)' }} data-density="compact">{children}</div>
      </main>
    </div>
  );
}
Object.assign(window, { AdminShell, ADMIN_NAV });
