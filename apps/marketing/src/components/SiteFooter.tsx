/**
 * Deliberately thin. Every link a footer normally carries — privacy, terms,
 * contact — has to exist before it is linked to, and none of them do yet.
 * A footer full of dead links is the clearest possible signal that a site was
 * generated rather than built.
 */
export function SiteFooter() {
  return (
    <footer className="mt-16 flex flex-col gap-2 border-t border-line-decorative pt-8 pb-10 md:mt-24 md:flex-row md:items-center md:justify-between">
      <p className="m-0 font-display text-heading-sm font-extrabold tracking-[-0.03em] text-fg-primary">Halal Goes</p>
      <p className="m-0 text-body-sm text-fg-secondary">
        Ontario, Canada. Launching soon — prices in CAD.
      </p>
    </footer>
  );
}
