/**
 * The whole motion system. ~30 lines, one observer, no library.
 *
 * Thesis: motion here makes things feel *deliberate*, never *alive*. We are
 * selling careful clerical work done by a person — so nothing swoops, bounces,
 * springs or pops. If a visitor could describe a transition afterwards, it was
 * too much. The best available motion decision is to use less than expected: a
 * page about slow, human checking that scrolls calmly and refuses to perform is
 * itself the argument.
 *
 * The hidden state lives only under `html.js` (set by an inline head script
 * before paint), so if this module fails to load the page is simply visible.
 */
const REVEAL = '[data-reveal], [data-print]';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const els = Array.from(document.querySelectorAll<HTMLElement>(REVEAL));

if (reduce || !('IntersectionObserver' in window)) {
  els.forEach((el) => el.classList.add('is-in'));
} else {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        // Stagger within a group so a section reads as one thought, not six.
        // Capped at 6 so a long list never leaves the reader waiting.
        const group = el.closest('[data-reveal-group]');
        if (group) {
          const sibs = Array.from(group.querySelectorAll<HTMLElement>('[data-reveal]'));
          const i = Math.max(0, sibs.indexOf(el));
          el.style.setProperty('--reveal-delay', `${Math.min(i, 5) * 60}ms`);
        }
        el.classList.add('is-in');
        io.unobserve(el);
      }
    },
    { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
  );
  els.forEach((el) => io.observe(el));
}

/**
 * The mobile sticky ask. It appears once the hero form has scrolled away and
 * hides again whenever any waitlist form is actually on screen — two asks
 * competing for the same thumb is worse than one.
 */
const sticky = document.querySelector<HTMLElement>('[data-sticky-cta]');
if (sticky && 'IntersectionObserver' in window) {
  const forms = Array.from(document.querySelectorAll('.waitlist-form'));
  let formVisible = true;
  const visible = new Set<Element>();
  const fio = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) visible.add(e.target);
        else visible.delete(e.target);
      }
      formVisible = visible.size > 0;
      sticky.classList.toggle('is-in', !formVisible);
    },
    { threshold: 0.2 },
  );
  forms.forEach((f) => fio.observe(f));
  sticky.classList.toggle('is-in', !formVisible);
}
