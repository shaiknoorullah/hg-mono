/**
 * SevenChecks specimens, named after the variants of the canvas board
 * `admin/restaurant-verification/Checks` (a proposed composite: no live preview page, compared with
 * the board by eye). Width 490px, the console's checks pane.
 */

import { check, sevenChecks } from '../ds/__tests__/w5-fixtures.js';
import { SevenChecks } from './SevenChecks.js';

/** Grouped under its own heading in the preview. */
export const component = 'SevenChecks';

const noop = () => {};
const pane = { width: 490 } as const;
const unrecorded = (key: Parameters<typeof check>[0], computed: 'PASS' | 'FAIL' | null) => ({
  ...check(key, 'NOT_ASSESSED', computed),
  checked_at: null,
});

/** Progress: five recorded, H4 (suggested Fail) and H6 not recorded yet. */
export function Progress() {
  return (
    <div style={pane}>
      <SevenChecks
        checks={sevenChecks({ H4_ADDRESS_MATCH: unrecorded('H4_ADDRESS_MATCH', 'FAIL'), H6_SCOPE_SUFFICIENT: unrecorded('H6_SCOPE_SUFFICIENT', 'PASS') })}
        suggestionDetail={{
          H4_ADDRESS_MATCH: 'The certified address text differs from the premises on the application.',
          H6_SCOPE_SUFFICIENT: 'The saved scope is Whole establishment.',
        }}
        onCheckChange={noop}
        intro="A suggestion is a hint, not an answer. Not assessed blocks approval, like Fail."
      />
    </div>
  );
}

/** H6 restricted (scope Supplier chain only) and recorded as Fail; H2 restricted, not recorded. */
export function Restricted() {
  return (
    <div style={pane}>
      <SevenChecks
        checks={sevenChecks({ H2_ISSUER_ACCEPTED: null, H6_SCOPE_SUFFICIENT: check('H6_SCOPE_SUFFICIENT', 'FAIL') })}
        restrictedKeys={['H2_ISSUER_ACCEPTED', 'H6_SCOPE_SUFFICIENT']}
        restrictionReasons={{
          H2_ISSUER_ACCEPTED: 'HFSAA is Suspended in the registry. Only an Accepted body passes this check.',
          H6_SCOPE_SUFFICIENT: 'Scope is Supplier chain only: only Whole establishment or Kitchen only passes.',
        }}
        onCheckChange={noop}
      />
    </div>
  );
}

/** H5 computed Fail: locked for everyone. */
export function H5Fail() {
  return (
    <div style={pane}>
      <SevenChecks checks={sevenChecks({ H5_DATES_VALID: check('H5_DATES_VALID', 'FAIL') })} onCheckChange={noop} />
    </div>
  );
}

/** Read-only after the decision (support, decided, unclaimed). */
export function Readonly() {
  return (
    <div style={pane}>
      <SevenChecks
        checks={sevenChecks({ H4_ADDRESS_MATCH: { ...check('H4_ADDRESS_MATCH', 'PASS', 'FAIL'), note: 'Same premises.' } })}
        readOnly
        intro="Read-only. The results recorded for this certificate."
      />
    </div>
  );
}

/** Recording is off: the claim ended, the reason shown above the rows. */
export function Locklost() {
  return (
    <div style={pane}>
      <SevenChecks checks={sevenChecks({ H4_ADDRESS_MATCH: null, H6_SCOPE_SUFFICIENT: null })} readOnly readOnlyReason="Recording is off: your claim ended at 2:48 pm" />
    </div>
  );
}

/** Loading the recorded results. */
export function Loading() {
  return (
    <div style={pane}>
      <SevenChecks checks={[]} status="loading" />
    </div>
  );
}
