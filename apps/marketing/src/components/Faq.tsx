'use client';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { type AudienceTrack } from '@/lib/audiences';

/**
 * shadcn's Accordion — Radix underneath, so the disclosure semantics, the
 * roving focus, the aria-expanded/aria-controls pairing and the height
 * animation are the component's job rather than mine.
 *
 * `type="multiple"` on purpose: these are independent objections, and answering
 * one should not close the one above it. `collapsible` is implied by multiple.
 */
export function Faq({ track }: { track: AudienceTrack }) {
  return (
    <section id="faq" className="mt-16 scroll-mt-6 md:mt-24">
      <div className="md:grid md:grid-cols-[1fr_440px] md:items-start md:gap-16">
        <h2 className="m-0 max-w-[12ch] font-display text-marketing-section-phone text-fg-primary md:text-marketing-section">
          Questions people ask.
        </h2>

        <Accordion type="multiple" className="mt-6 md:mt-0">
          {track.faq.map(({ q, a }) => (
            <AccordionItem key={q} value={q} className="border-line-decorative">
              <AccordionTrigger className="py-4 text-body-lg leading-snug font-semibold text-fg-primary hover:no-underline">
                {q}
              </AccordionTrigger>
              <AccordionContent className="max-w-[58ch] pb-4 text-body-md leading-relaxed text-mk-ink">
                {a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
