/* Hero.jsx: one hero per audience (K-48). Email waitlist for all (K-49), unticked consent (K-50).
   The seal is the DS HalalBadge size="lg" on an example listing — no hand-assembled seal (K-53).
   The '[XX] ...' count line next to the badge is kept exactly as it was: K-52 rejected by the owner. */
const { Badge, HalalBadge, Card } = window.HalalGoesDesignSystem_d11a47;

function HeroArt({ audience }) {
  return (
    <div style={{ position: 'relative', padding: 24 }}>
      <Photo src={null} alt="Food photography" height={420} radius="xl" style={{ width: '100%' }} />
      {audience !== 'rider' && (
        <Card radius="lg" variant="elevated" style={{ position: 'absolute', bottom: 44, left: 0, display: 'grid', gap: 6, minWidth: 300, boxShadow: 'var(--elev-4)' }}>
          <span style={{ fontSize: 'var(--type-label-sm-size)', letterSpacing: '.04em', fontWeight: 600, color: 'var(--text-tertiary)' }}>EXAMPLE LISTING</span>
          <HalalBadge state="CERTIFIED" size="lg" />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Checked seven ways · certifying body named on the listing</span>
        </Card>
      )}
    </div>
  );
}

function Hero({ audience, formState }) {
  const t = TRACKS[audience];
  return (
    <section id="waitlist" style={{ background: 'var(--surface-base)' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '72px 32px 88px', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 56, alignItems: 'center' }}>
        <div style={{ display: 'grid', gap: 24 }}>
          <span style={{ justifySelf: 'start' }}><Badge variant="brand" size="md" icon={t.eyebrowIcon}>{t.eyebrow}</Badge></span>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--type-marketing-hero-size)', lineHeight: 'var(--type-marketing-hero-line)', letterSpacing: 'var(--type-marketing-hero-tracking)', fontWeight: 'var(--type-marketing-hero-weight)', color: 'var(--mk-ink)' }}>
            {t.headline.map((l, i) => <React.Fragment key={i}>{l}{i < t.headline.length - 1 && <br />}</React.Fragment>)}
          </h1>
          <p style={{ margin: 0, fontSize: 20, lineHeight: 1.5, color: 'var(--text-secondary)', maxWidth: 460 }}>{t.lede}</p>
          <WaitlistForm audience={audience} forceState={formState} />
          {t.countLine && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingTop: 4 }}>
              <HalalBadge state="CERTIFIED" size="sm" />
              <span style={{ fontSize: 14, color: 'var(--text-tertiary)' }}>{t.countLine}</span>
            </div>
          )}
          {t.finePrint && <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--text-tertiary)', maxWidth: 460 }}>{t.finePrint}</p>}
        </div>
        <HeroArt audience={audience} />
      </div>
    </section>
  );
}
Object.assign(window, { Hero });
