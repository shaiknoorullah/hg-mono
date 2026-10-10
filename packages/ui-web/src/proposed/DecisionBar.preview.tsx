/**
 * DecisionBar specimens, named after the variants of the canvas board
 * `admin/restaurant-verification/DecisionBar` (a proposed composite, compared with the board by
 * eye). Width 516px, the console's checks pane.
 */

import { check, gates, sevenChecks } from '../ds/__tests__/w5-fixtures.js';
import { DecisionBar, type DecisionBarProps } from './DecisionBar.js';

/** Grouped under its own heading in the preview. */
export const component = 'DecisionBar';

const noop = () => {};
const pane = { width: 516 } as const;

function Bar({ checks, ...rest }: { checks: ReturnType<typeof sevenChecks> } & Partial<DecisionBarProps>) {
  const g = gates(checks);
  return (
    <div style={pane}>
      <DecisionBar approveGate={g.approve} rejectGate={g.reject} onApprove={noop} onReject={noop} onRequestChanges={noop} {...rest} />
    </div>
  );
}

/** Two checks still needed: Approve… and Reject… unavailable, with their reasons. */
export function Progress() {
  return <Bar checks={sevenChecks({ H4_ADDRESS_MATCH: null, H6_SCOPE_SUFFICIENT: null })} outstanding={['H4_ADDRESS_MATCH', 'H6_SCOPE_SUFFICIENT']} />;
}

/** All seven pass: Approve… is the primary. */
export function Allpass() {
  return <Bar checks={sevenChecks()} />;
}

/** One check failed: Reject… leads, Approve… drops to tertiary. */
export function Onefail() {
  return <Bar checks={sevenChecks({ H6_SCOPE_SUFFICIENT: check('H6_SCOPE_SUFFICIENT', 'FAIL') })} />;
}

/** The claim ended: every decision off, with the reason. */
export function Locklost() {
  return <Bar checks={sevenChecks({ H4_ADDRESS_MATCH: null })} disabledReason="your claim ended at 2:48 pm" />;
}

/** Reject… opened: the in-place reject form with the preselected reason. */
export function RejectOpen() {
  return <Bar checks={sevenChecks({ H6_SCOPE_SUFFICIENT: check('H6_SCOPE_SUFFICIENT', 'FAIL') })} defaultOpen="reject" />;
}

/** Approve… confirmed and sending: everything else blocked. */
export function Submitting() {
  return <Bar checks={sevenChecks()} defaultOpen="approve" submitting="approve" />;
}
