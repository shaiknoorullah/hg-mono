/**
 * TEMPORARY STUB for the owner-approved DS `KeyValueList` (ds-request(web): #195). Delete when
 * `@hg/ui-web/proposed` exports it. A definition list: label left, value right, a hairline
 * between rows.
 */
import type { ReactNode } from 'react';

export interface KeyValueRow {
  key: string;
  label: string;
  value: ReactNode;
}

export function KeyValueList({ rows, testId }: { rows: readonly KeyValueRow[]; testId?: string }) {
  return (
    <dl className="m-0 flex flex-col" data-testid={testId}>
      {rows.map((r, i) => (
        <div key={r.key} className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 ${i === 0 ? '' : 'border-t border-line-decorative'}`}>
          <dt className="text-body-md text-fg-secondary">{r.label}</dt>
          <dd className="m-0 text-body-md font-medium text-fg-primary">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
