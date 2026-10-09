/* Benefits.jsx: "Why HalalGoes" (K-01: one word). Claims re-sourced to claims.ts MONEY:
   removed "If the seal is broken, tell us and we refund" (REJECTED), "Onboarding in a day /
   no exclusivity" (REJECTED/unsourced), and "The badge as a trust asset — download your badge"
   (owner decision K-27: no badge download). No raw rgba: plain surfaces and DS Cards. */
const { Icon, Card } = window.HalalGoesDesignSystem_d11a47;

function Benefits({ audience }) {
  const b = TRACKS[audience].benefits;
  if (!b) return null;
  return (
    <Section tone="subtle">
      <SectionTitle sub={b.sub}>{b.heading}</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 24 }}>
        {b.items.map(it => (
          <Card key={it.title} radius="lg" variant="outlined" style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
            {it.icon && <Icon name={it.icon} size="lg" color="var(--mk-accent)" />}
            <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-.01em', color: 'var(--mk-ink)' }}>{it.title}</h3>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: 'var(--text-secondary)' }}>{it.body}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}
Object.assign(window, { Benefits });
