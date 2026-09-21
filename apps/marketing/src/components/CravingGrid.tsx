import Image from 'next/image';

/**
 * The appetite engine — the largest single block of vertical space on the page.
 * Turns "halal delivery" from an abstraction into six things you can taste.
 *
 * Hard rule: no restaurant names, no logos, no prices, no ratings, no "4.8★".
 * Every one of those is fabricated proof before launch. Tiles are DISHES, and
 * dishes are both real and ownable.
 *
 * Note what is deliberately NOT here: neighbourhood labels. The decided launch
 * unit is the province of Ontario (O-05) — no city or neighbourhood is decided,
 * so naming one would be a claim about where we open that nobody has made.
 *
 * The row spans are hand-set so the tiles are deliberately uneven: an even 3×2
 * grid of identical rectangles is the stock "gallery" block. Row gap MUST stay
 * 0 — with 8px implicit rows, a `span 46` would otherwise pick up 45 row gaps as
 * well as 46 rows and a 368px tile would render 1268px tall. Vertical rhythm
 * comes from each tile's own bottom margin, which the span maths ignores.
 */

const TILES = [
  { img: '/img/grill.jpg', span: 46, caption: 'Charcoal chicken, still spitting.', alt: 'Chicken skewers over charcoal, char marks catching the light' },
  { img: '/img/rice.jpg', span: 36, caption: 'Rice by the tray, not the portion.', alt: 'A large tray of spiced rice with meat, served family-style' },
  { img: '/img/shawarma.jpg', span: 54, caption: 'Shawarma carved off the spit.', alt: 'Shawarma being carved from a vertical spit' },
  { img: '/img/curry.jpg', span: 38, caption: 'A curry that took all afternoon.', alt: 'A dark, slow-cooked curry in a steel dish' },
  { img: '/img/bread.jpg', span: 50, caption: 'Bread straight out of the oven.', alt: 'Flatbread fresh from a hot oven, blistered on top' },
  { img: '/img/platter.jpg', span: 40, caption: 'A platter, for when there are nine of you.', alt: 'A large mixed grill platter laid out for a group' },
] as const;

export function CravingGrid() {
  return (
    <section aria-labelledby="craving-heading" className="mt-16 lg:mt-24">
      <header className="mb-7 lg:mb-11">
        <p className="m-0 font-mono text-marketing-eyebrow-phone text-mk-ink uppercase lg:text-marketing-eyebrow">
          What’s on it
        </p>
        <h2
          id="craving-heading"
          className="mt-3 mb-0 font-display text-marketing-section-phone text-fg-primary lg:mt-4 lg:text-marketing-section"
        >
          Everything here made the list.
        </h2>
        <p className="mt-4 mb-0 max-w-[62ch] text-body-lg leading-relaxed text-mk-ink">
          Charcoal, rice, bread out of the oven — from kitchens whose certificates we’ve read, line by line,
          before you ever saw them.
        </p>
      </header>

      {/* Phones get one column of 4:5 plates in source order: a vertical scroll
          of food is the most appetising mobile form there is, and the uneven
          spans are a desktop device that does not survive a narrow column. */}
      <div className="grid auto-rows-auto grid-cols-2 gap-x-2.5 gap-y-0 lg:auto-rows-[8px] lg:grid-cols-3 lg:gap-x-5">
        {TILES.map((tile, i) => (
          <figure
            key={tile.img}
            // The span applies only from md up, where grid-auto-rows is 8px.
            // Below that each tile is an auto row with a fixed 4:5 plate.
            className="relative m-0 mb-2.5 aspect-4/5 overflow-hidden rounded-xl border border-line-decorative bg-surface-sunken lg:mb-5 lg:aspect-auto lg:[grid-row:span_var(--span)]"
            style={{ '--span': tile.span } as React.CSSProperties}
          >
            <Image
              src={tile.img}
              alt={tile.alt}
              width={1000}
              height={1250}
              sizes="(max-width: 767px) 50vw, 33vw"
              priority={i === 0}
              className="size-full object-cover"
            />
            {/* The only gradient anywhere on the site, and it is capped at ~35%
                of the tile so it reads as a caption plate, not as an overlay.
                The mid stop is 0.72 rather than a fade to nothing because the
                text sits in that band, and 0.72 is what makes the contrast hold
                against ANY photograph: forest #0F241C at 72% over pure white
                blends to #52615C, and white on that is 6.5:1 — above the 4.5:1
                floor even in the worst case the image could present. An
                automated contrast check cannot measure this (the computed
                background is `transparent` over a gradient over a bitmap), so
                the number is derived rather than sampled. Do not lower it. */}
            <figcaption className="absolute inset-x-0 bottom-0 bg-linear-to-t from-[rgba(15,36,28,0.92)] via-[rgba(15,36,28,0.72)] to-transparent px-3 pt-8 pb-3 text-[13px] leading-tight font-semibold text-white lg:px-4.5 lg:pt-10 lg:pb-4 lg:text-body-lg">
              {tile.caption}
            </figcaption>
          </figure>
        ))}
      </div>

      <p className="mt-6 mb-0 font-mono text-[11px] leading-relaxed tracking-[0.03em] text-mk-ink lg:text-[12px]">
        Kitchen names go up when they’ve passed the check — not before.
      </p>
    </section>
  );
}
