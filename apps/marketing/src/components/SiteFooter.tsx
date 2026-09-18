import Link from 'next/link';
import { ConsentPreferencesButton } from '@/components/ConsentManager';

/**
 * Still deliberately thin. Privacy, terms and contact have to exist before they
 * are linked to, and none of them do yet — a footer full of dead links is the
 * clearest possible signal that a site was generated rather than built.
 *
 * Cookie preferences is the exception and is not optional: consent that cannot
 * be withdrawn as easily as it was given is not consent.
 */
export function SiteFooter() {
  const link = 'inline-flex min-h-11 items-center text-body-sm text-fg-secondary underline underline-offset-4';

  return (
    <footer className="mt-16 flex flex-col gap-2 border-t border-line-decorative pt-8 pb-10 md:mt-24 md:flex-row md:items-center md:justify-between md:gap-6">
      <p className="m-0 font-display text-heading-sm font-extrabold tracking-[-0.03em] text-fg-primary">Halal Goes</p>

      <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-6">
        <Link href="/blog" className={link}>
          Writing
        </Link>
        <ConsentPreferencesButton className={`${link} cursor-pointer bg-transparent p-0`} />
      </nav>

      <p className="m-0 text-body-sm text-fg-secondary">Ontario, Canada. Launching soon — prices in CAD.</p>
    </footer>
  );
}
