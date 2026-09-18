/**
 * The category problem, customer track only.
 *
 * The objection map's second unanswered objection: a visitor who has never been
 * misled does not know what we solve, and the hero cannot tell them without
 * becoming an essay. Every number here is CBC's, cited on the page.
 *
 * Two rules from docs/marketing/objection-map.md travel with this section and
 * are not negotiable: we cite, we never accuse, and we name no chains.
 */
export function WhyThisExists() {
  return (
    <section className="mt-16 md:mt-24">
      <div className="md:grid md:grid-cols-[1fr_440px] md:items-start md:gap-16">
        <h2 className="m-0 max-w-[14ch] font-display text-marketing-section-phone text-fg-primary md:text-marketing-section">
          Halal is a claim anyone can print.
        </h2>

        <div className="mt-5 md:mt-0">
          <p className="m-0 text-body-lg leading-relaxed text-mk-ink md:text-[19px]">
            Canada has more than a dozen halal certifying agencies. Each sets its own standards, and none of
            them is regulated — the Canadian Food Inspection Agency requires halal food to be certified but
            does not do the certifying, and does not oversee the certifiers.
          </p>
          <p className="mt-4 mb-0 text-body-lg leading-relaxed text-mk-ink md:text-[19px]">
            In 2024, a CBC Marketplace investigation visited ten fast-food locations advertising halal food.
            Staff at six said the whole restaurant was certified. None of the ten was. Between them they
            produced eight expired certificates — one set had run out eight years earlier.
          </p>
          <p className="mt-4 mb-0 text-body-lg leading-relaxed font-medium text-fg-primary md:text-[19px]">
            That is the gap. Not restaurants lying, mostly: paperwork nobody checks.
          </p>
          <p className="mt-5 mb-0 font-mono text-[10.5px] leading-relaxed tracking-[0.03em] text-mk-ink">
            Source: CBC Marketplace, “Fast-food chains serving up halal food with a side of misinformation,
            expired certificates”, 18 October 2024.
          </p>
        </div>
      </div>
    </section>
  );
}
