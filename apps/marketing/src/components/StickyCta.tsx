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
 * not know. It watches a zero-height sentinel at the end of the hero rather
 * than the hero itself: the hero is tall enough on a phone that waiting for it
 * to leave entirely would hold the bar back past the point it is useful.
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
    const sentinel = document.getElementById('hero-end');
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
        // `!isIntersecting` alone is true both when the sentinel is ABOVE the
        // viewport (scrolled past — what we want) and when it is still BELOW it
        // (not reached yet). On a phone the hero is taller than the screen, so
        // the sentinel starts below and the bar would appear immediately, over
        // the hero it is meant to follow. Only above counts as gone.
        heroGone = !entry.isIntersecting && entry.boundingClientRect.top < 0;
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
