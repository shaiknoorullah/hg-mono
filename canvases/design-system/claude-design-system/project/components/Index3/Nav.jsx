/* Nav.jsx: site header + shared section layout. The header sits in a dark-theme region so DS
   components read on forest chrome without raw rgba values. Wordmark = GapWordmark (K-01). */
const { SegmentedControl, Button } = window.HalalGoesDesignSystem_d11a47;

function Section({ tone = 'base', children, id, style }) {
  const bg = { base: 'var(--surface-base)', subtle: 'var(--surface-subtle)', raised: 'var(--surface-raised)', halal: 'var(--mk-seal-plate)' }[tone];
  return (
    <section id={id} style={{ background: bg, borderTop: tone === 'halal' ? '1px solid var(--color-halal-certified-tint-border)' : undefined, borderBottom: tone === 'halal' ? '1px solid var(--color-halal-certified-tint-border)' : undefined, ...style }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '88px 32px' }}>{children}</div>
    </section>
  );
}

function SectionTitle({ children, sub, color = 'var(--mk-ink)', style }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 20, marginBottom: 40, flexWrap: 'wrap', ...style }}>
      <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--type-marketing-section-size)', lineHeight: 'var(--type-marketing-section-line)', letterSpacing: 'var(--type-marketing-section-tracking)', fontWeight: 700, color }}>{children}</h2>
      {sub && <span style={{ fontSize: 15, color: 'var(--text-tertiary)' }}>{sub}</span>}
    </div>
  );
}

/* page: 'landing' | 'verification' | 'blog' | 'legal' — marks the current link */
function Nav({ audience, setAudience, page = 'landing', onNavigate = () => {} }) {
  const cta = TRACKS[audience || 'customer'].headerCta;
  return (
    <header data-theme="dark" style={{ position: 'sticky', top: 0, zIndex: 100, background: 'var(--surface-chrome)', color: 'var(--text-on-accent)' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '0 32px', height: 72, display: 'flex', alignItems: 'center', gap: 16 }}>
        <GapWordmark size={22} tone="onDark" />
        <div style={{ margin: '0 auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {page === 'landing'
            ? <SegmentedControl label="I want to" tone="chrome" size="sm" value={audience} onChange={setAudience} options={AUDIENCE_OPTIONS} />
            : <Button variant="ghost" size="sm" iconStart="back" onPress={() => onNavigate('landing')}>Home</Button>}
        </div>
        <Button variant={page === 'verification' ? 'secondary' : 'ghost'} size="sm" onPress={() => onNavigate('verification')}>How we verify</Button>
        <Button variant={page === 'blog' ? 'secondary' : 'ghost'} size="sm" onPress={() => onNavigate('blog')}>Writing</Button>
        <Button variant="primary" href="#waitlist">{cta}</Button>
      </div>
    </header>
  );
}
Object.assign(window, { Nav, Section, SectionTitle });
