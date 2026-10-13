/**
 * `IssuerCombobox` — choose the certifying body from the issuer registry (approval packet P31,
 * #196; board `admin/restaurant-verification/Verify-IssuerList`). The contract forbids free text
 * here ("it would make the badge meaningless"), so the only way to name a body is the list.
 *
 * - Built on the listbox `Select` (shadcn Popover + cmdk Command): a `role="combobox"` trigger,
 *   a filter field, `role="option"` rows, and "No matches for …" when the filter finds nothing.
 * - Every registry status is shown **in words** under the body's name, and again beside the
 *   chosen body as a Badge. Accepted is the only status that passes check H2. Statuses use
 *   neutral, outline or warning tones: never danger, never a green fill (invariants 9 and 10).
 * - States: closed, open, filtered, no match, loading (skeleton rows), error (`errorText`).
 * - "Not in the list? Propose it…" is offered when the page can propose a body (`onPropose`).
 *
 * Statuses are the contract's `HalalIssuingBodyStatus` (PROPOSED, ACCEPTED, SUSPENDED, RETIRED,
 * REJECTED), not the packet's draft names: the contract wins (AGENTS.md "How to work here").
 */

import type { CSSProperties } from 'react';
import type { Schema } from '@hg/api-client';

import { cn } from '../lib/utils.js';
import { Badge, type BadgeVariant } from '../ds/Badge.js';
import { Button } from '../ds/Button.js';
import { Select } from '../ds/Select.js';

/** The registry status of an issuing body (contract enum). */
export type IssuerStatus = Schema['HalalIssuingBodyStatus'];

/** One issuing body as the list needs it (a subset of the contract's `HalalIssuingBody`). */
export interface IssuerOption {
  id: string;
  name: string;
  status: IssuerStatus;
}

/** Props of the proposed `IssuerCombobox` (packet P31), with contract statuses. */
export interface IssuerComboboxProps {
  label: string;
  issuers: readonly IssuerOption[];
  /** The chosen body's id (`issuing_body_id`). */
  value: string | null;
  onValueChange: (id: string) => void;
  errorText?: string | null;
  helperText?: string;
  required?: boolean;
  disabled?: boolean;
  /** The registry is loading: skeleton rows in the list, never an empty list. */
  loading?: boolean;
  /** Offers "Not in the list? Propose it…". */
  onPropose?: () => void;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

/** Each status in words; RETIRED reads as withdrawn. */
export const ISSUER_STATUS_LABEL: Readonly<Record<IssuerStatus, string>> = {
  ACCEPTED: 'Accepted',
  PROPOSED: 'Proposed, not reviewed yet',
  SUSPENDED: 'Suspended',
  RETIRED: 'Withdrawn',
  REJECTED: 'Not accepted',
};

/** Badge tone per status: never danger. */
const STATUS_TONE: Readonly<Record<IssuerStatus, BadgeVariant>> = {
  ACCEPTED: 'outline',
  PROPOSED: 'neutral',
  SUSPENDED: 'warning',
  RETIRED: 'neutral',
  REJECTED: 'warning',
};

/** The status line under a body's name in the list. */
function statusLine(status: IssuerStatus): string {
  return status === 'ACCEPTED'
    ? 'Accepted: can pass Issuer accepted (H2)'
    : `${ISSUER_STATUS_LABEL[status]}: Issuer accepted (H2) can’t pass`;
}

/** A searchable list of issuing bodies, each with its registry status in words. */
export function IssuerCombobox({
  label,
  issuers,
  value,
  onValueChange,
  errorText,
  helperText = 'From the registry. Only an Accepted body passes Issuer accepted (H2).',
  required = true,
  disabled = false,
  loading = false,
  onPropose,
  testId = 'IssuerCombobox',
  style,
  className,
}: IssuerComboboxProps) {
  const chosen = issuers.find((i) => i.id === value);
  return (
    <div data-testid={testId} style={style} className={cn('flex flex-col gap-2', className)}>
      <Select
        variant="listbox"
        searchable
        label={label}
        required={required}
        disabled={disabled}
        loading={loading}
        placeholder="Choose the issuing body"
        emptyText="No issuing bodies in the registry yet"
        value={value}
        options={issuers.map((i) => ({ value: i.id, label: i.name, description: statusLine(i.status) }))}
        onValueChange={onValueChange}
        errorText={errorText ?? null}
        helperText={helperText}
        testId={`${testId}-select`}
      />
      {chosen ? (
        <span className="flex flex-wrap items-center gap-2 text-body-sm text-fg-secondary" data-testid={`${testId}-status`}>
          <Badge variant={STATUS_TONE[chosen.status]} icon={chosen.status === 'ACCEPTED' ? 'check' : 'info'}>
            {ISSUER_STATUS_LABEL[chosen.status]}
          </Badge>
          {chosen.status === 'ACCEPTED'
            ? 'In the registry as Accepted.'
            : 'Only an Accepted body passes Issuer accepted (H2): it can be recorded only as Fail or Not assessed.'}
        </span>
      ) : null}
      {onPropose ? (
        <div>
          <Button variant="link" disabled={disabled} onPress={onPropose} testId={`${testId}-propose`}>
            Not in the list? Propose it…
          </Button>
        </div>
      ) : null}
    </div>
  );
}
