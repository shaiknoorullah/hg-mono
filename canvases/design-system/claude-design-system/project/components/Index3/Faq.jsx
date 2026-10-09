/* Faq.jsx: per-audience questions (audiences.ts, trimmed to claims.ts). The hand-made <button>
   accordion is replaced by GapAccordion (component gap: Accordion). Removed: "starting in the
   Greater Toronto Area" (REJECTED: say Ontario), "Payment processing fees are itemised on every
   payout statement" (no statement endpoint), "HalalGoes does not itself certify food" kept in the
   disclaimer instead. */
function Faq({ audience }) {
  const [open, setOpen] = React.useState(0);
  React.useEffect(() => setOpen(0), [audience]);
  return (
    <Section tone="subtle">
      <div style={{ maxWidth: 860 }}>
        <SectionTitle>Questions</SectionTitle>
        <GapAccordion items={TRACKS[audience].faq} open={open} onToggle={setOpen} />
      </div>
    </Section>
  );
}
Object.assign(window, { Faq });
