/**
 * Route elements the shell itself provides (WP-1): not found, and the Halal certificates entry
 * page (owner question Q7: the certificate register is cut at launch, so the nav item explains
 * where certificates are reached instead). The 403 page is drawn by `AdminShell` and the
 * "Not built yet" stand-in by `routes.tsx`, each as a local section; their copy is in `./copy`.
 *
 * The app bar above carries each page's `h1`; these sections start at `h2`.
 */
import { useHref } from 'react-router-dom';

import { Button, EmptyState } from '../ds';
import { NOT_FOUND } from './copy';
import { useLanding } from './landing';

/** An address the console has no page for. "Back to …" is outlined, as on `RV/Shell-Forbidden`. */
export function NotFoundPage() {
  const back = useLanding();
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
      <div className="w-full max-w-[552px] rounded-lg border border-line-decorative bg-surface-raised">
        <EmptyState
          title={NOT_FOUND.title}
          description={NOT_FOUND.body}
          action={
            <Button variant="tertiary" onPress={back.go}>
              {back.label}
            </Button>
          }
        />
      </div>
    </div>
  );
}

/**
 * Halal certificates (owner question Q7). The certificate register needs an API that does not
 * exist yet (manifest §5), so this page says where certificates are reached: from a restaurant's
 * application, in the state ACTIVE once the restaurant is live.
 */
export function CertificatesEntryPage() {
  const activeHref = useHref('/restaurants?state=ACTIVE');
  return (
    <section aria-labelledby="certificates-entry-heading" className="flex min-h-0 flex-1 items-start justify-center overflow-auto p-6">
      <div className="w-full max-w-[640px] rounded-lg border border-line-decorative bg-surface-raised p-6">
        <h2 id="certificates-entry-heading" className="text-heading-sm text-fg-primary">
          Certificates are opened from a restaurant’s application
        </h2>
        <p className="mt-2 text-body-md text-fg-secondary">
          There is no list of every certificate yet. To check or verify a restaurant’s halal certificate, open its
          application: the certificate is with its documents. Restaurants that are already live have the state Active.
        </p>
        <div className="mt-4">
          <Button variant="secondary" href={activeHref} iconEnd="chevron-right">
            Open active restaurants
          </Button>
        </div>
      </div>
    </section>
  );
}
