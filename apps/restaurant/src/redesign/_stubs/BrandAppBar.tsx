/**
 * TEMPORARY STUB for the DS `AppBar` brand-mark slot (SI `AuthTop`: "Proposed: AppBar with brand
 * mark — AppBar has no logo slot"; ds-request(web): #110, AppBar rebuild W2). Delete when
 * `@hg/ui-web/ds` `AppBar` takes a brand mark and no navigation.
 *
 * The public pages' header: the HalalGoes wordmark, then a context label after a 1px divider.
 * 80px tall, 48px side padding (16px under 600px); the label hides under 400px. No navigation.
 */
import { Wordmark } from '@hg/ui-web/primitives';

export interface BrandAppBarProps {
  /** Shown beside the wordmark ("Restaurant partner"). */
  context: string;
  testId?: string;
}

export function BrandAppBar({ context, testId = 'BrandAppBar' }: BrandAppBarProps) {
  return (
    <header
      data-testid={testId}
      className="flex h-20 w-full shrink-0 items-center gap-4 bg-surface-base px-4 min-[600px]:px-12"
    >
      <Wordmark height={32} title="HalalGoes" />
      <span className="hidden border-s border-line-decorative ps-4 text-body-md text-fg-secondary min-[400px]:block">
        {context}
      </span>
    </header>
  );
}
