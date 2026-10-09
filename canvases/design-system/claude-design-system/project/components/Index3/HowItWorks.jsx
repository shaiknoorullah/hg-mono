/* HowItWorks.jsx: steps per audience from audiences.ts, trimmed to what claims.ts backs.
   Removed: "usually within two working days" (the review SLA is internal, never a promise) and
   "you keep every dollar" (processing fees apply). Step cards are DS Cards. */
const { Icon, Card, Badge } = window.HalalGoesDesignSystem_d11a47;

function HowItWorks({ audience }) {
  const s = TRACKS[audience].steps;
  return (
    <Section tone="base">
      <SectionTitle>{s.heading}</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 24 }}>
        {s.items.map((it, i) => (
          <Card key={it.title} radius="lg" variant="outlined" style={{ display: 'grid', gap: 14, padding: '28px 26px', alignContent: 'start' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Badge variant="neutral" size="md">{'0' + (i + 1)}</Badge>
              {it.icon && <Icon name={it.icon} size="lg" color="var(--mk-accent)" />}
            </div>
            <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-.01em', color: 'var(--mk-ink)' }}>{it.title}</h3>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: 'var(--text-secondary)' }}>{it.body}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}
Object.assign(window, { HowItWorks });
