'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { WaitlistForm } from '@/components/WaitlistForm';
import { type AudienceTrack } from '@/lib/audiences';

/**
 * The ask, kept in reach once the hero has scrolled away — and taken off the
 * screen again as soon as the footer arrives, so the same ask is never in front
 * of somebody twice.
 *
 * Two IntersectionObservers rather than scroll maths. The bar is a function of
 * what is on screen, not of a scroll position, so it stays correct when the
 * viewport changes, when a section grows, and on a page whose length it does
 * not know.
 *
 * WHAT IT WATCHES, and why it is a region rather than a mark. `#hero-zone`
 * spans everything the bar is meant to sit below — the hero on a track page,
 * the masthead on a document page. It used to be a 1px mark at the end of the
 * hero, and that was a real bug: at 390 and at 1024 the mark sits BELOW the
 * fold, so it was `isIntersecting: false` at rest and still `false` after a
 * jump past it. A boolean that does not change delivers no second entry, so
 * `heroGone` stayed false and the bar never appeared again for the rest of the
 * session — after an anchor jump, End, PageDown, or any frame that moved more
 * than a viewport. A region that starts at the top of the page is intersecting
 * before the threshold and not intersecting after it, so the crossing is a
 * state change however it is made, and a reload is not the only cure.
 *
 * On a document page the same region also has to be SHORT enough to clear on a
 * page as short as `/blog`, which is barely a viewport of scrolling — a
 * full-screen sentinel there needed more scroll than the page had, and the bar
 * never appeared at any width.
 *
 * Above `lg` the bar carries the whole form, consent line included. CASL
 * consent travels with the field and is never implied, and the sentence is long
 * — so below `lg` the bar is a prompt that sends you to the footer form
 * instead, where the same sentence has the room to be read. Three forms
 * competing on one phone screen is worse than one that fits.
 *
 * It publishes its own height as `--sticky-cta-h` so nothing else has to guess:
 * the footer reserves it, and a pinned layout can too. The reserve is constant
 * rather than tied to whether the bar is currently shown, because a padding
 * that toggled with it would jog the page each time it came and went.
 */
export function StickyCta({ track }: { track: AudienceTrack }) {
  const bar = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = bar.current;
    const sentinel = document.getElementById('hero-zone');
    const footer = document.getElementById('site-footer');
    if (!el || !sentinel || !footer) return;

    // Measured, not hard-coded: the bar is one row on a phone and two above lg,
    // and a wrong guess here puts the last footer line under it.
    const publishHeight = () =>
      document.documentElement.style.setProperty('--sticky-cta-h', `${el.offsetHeight}px`);
    publishHeight();

    let heroGone = false;
    let footerHere = false;
    const apply = () => setShow(heroGone && !footerHere);

    const heroWatch = new IntersectionObserver(
      ([entry]) => {
        // `!isIntersecting` alone is true both when the region is ABOVE the
        // viewport (scrolled past — what we want) and when it is still BELOW it
        // (not reached yet). The region starts at the top of the page so only
        // the first is reachable, but the test is kept: it is what makes the
        // rule true by construction rather than by where the region happens to
        // begin, and it costs nothing.
        heroGone = !entry.isIntersecting && entry.boundingClientRect.bottom <= 0;
        apply();
      },
      { threshold: 0 },
    );
    const footerWatch = new IntersectionObserver(
      ([entry]) => {
        footerHere = entry.isIntersecting;
        apply();
      },
      { threshold: 0, rootMargin: '0px 0px -8% 0px' },
    );

    heroWatch.observe(sentinel);
    footerWatch.observe(footer);
    window.addEventListener('resize', publishHeight);

    return () => {
      heroWatch.disconnect();
      footerWatch.disconnect();
      window.removeEventListener('resize', publishHeight);
      document.documentElement.style.removeProperty('--sticky-cta-h');
    };
  }, []);

  return (
    <div
      ref={bar}
      aria-label="Join the waitlist"
      data-sticky-cta=""
      data-show={show}
      className={[
        'fixed inset-x-0 bottom-0 z-30 border-t border-line-decorative bg-surface-raised',
        'px-5 py-3 lg:px-14 lg:py-3.5',
        'transition-[transform,visibility] duration-300 ease-[cubic-bezier(.2,0,0,1)] motion-reduce:transition-none',
        show ? 'translate-y-0 visible' : 'invisible translate-y-[102%]',
      ].join(' ')}
    >
      <div className="mx-auto flex max-w-[1280px] flex-nowrap items-center justify-between gap-3.5">
        <p className="m-0 min-w-0 text-body-sm text-mk-ink lg:max-w-[34ch]">
          <b className="font-bold text-fg-primary">Ontario · launching soon.</b>
          {/* The second sentence repeats the footer form's own reassurance. On a
              phone it costs a whole line of a bar that is already taking room
              from the page, so it is only shown where there is room for it. */}
          <span className="hidden lg:inline"> One email the day we open in your area.</span>
        </p>

        <Button asChild className="h-12 flex-none rounded-xl px-5 font-bold no-underline lg:hidden">
          <a href="#footer-waitlist">Join the waitlist</a>
        </Button>

        <div className="hidden min-w-0 flex-[0_1_620px] lg:block">
          <WaitlistForm track={track} context="sticky" compact />
        </div>
      </div>
    </div>
  );
}
