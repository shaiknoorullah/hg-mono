/**
 * TEMPORARY STUB for the proposed DS `Disclosure` (ds-request(web): #195, shadcn Collapsible).
 * Delete when `@hg/ui-web/proposed` exports it. Native `details`/`summary`, so it opens with
 * Enter or Space and announces its state without script.
 */
import type { ReactNode } from 'react';

export function Disclosure({ summary, children, testId }: { summary: string; children: ReactNode; testId?: string }) {
  return (
    <details className="rounded-[12px] border border-line-decorative px-4 py-2" data-testid={testId}>
      <summary className="hg-focus flex min-h-11 cursor-pointer items-center text-label-lg text-fg-primary">{summary}</summary>
      <div className="flex flex-col gap-2 pb-2 pt-1 text-body-md text-fg-secondary">{children}</div>
    </details>
  );
}
