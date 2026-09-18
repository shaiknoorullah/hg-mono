/**
 * The hover micro-interaction used on primary calls to action: the label slides
 * up and out while an identical copy slides up into its place.
 *
 * Within the motion budget in docs/planning/marketing-site-plan.md — transform
 * and opacity only, 220ms, motion.easing.spring — and it needs no JavaScript at
 * all, so it costs nothing on a cold load and cannot desynchronise.
 *
 * The second copy is aria-hidden: a screen reader should hear the label once.
 */
export function SwapLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative inline-grid overflow-hidden [clip-path:inset(0)]">
      <span
        className="col-start-1 row-start-1 transition-transform duration-[220ms] ease-[var(--hg-ease-spring)] group-hover:-translate-y-full motion-reduce:transition-none motion-reduce:group-hover:translate-y-0"
      >
        {children}
      </span>
      <span
        aria-hidden="true"
        className="col-start-1 row-start-1 translate-y-full transition-transform duration-[220ms] ease-[var(--hg-ease-spring)] group-hover:translate-y-0 motion-reduce:hidden"
      >
        {children}
      </span>
    </span>
  );
}
