import { expect, test } from '@playwright/test';

import { declareUnpairable } from './design';
import { E2E_MODE } from './mode';
import { FATIMA } from './redesign-admin.rider-onboarding.scene';
import { inReview, openApp } from './redesign-admin.rider-onboarding.steps';

test.skip(E2E_MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The boards of the rider onboarding area that no capture can pair with a screen, each declared
 * with its reason (tools/e2e/README.md, "Design captures"): the harness then lists them as
 * declared not comparable instead of leaving them uncovered. Every board of the area was opened
 * and read before it was put here; the area's folder also holds no copy of another area's board,
 * and no board byte-identical to one.
 *
 * Four kinds, and the reason on each says which:
 * - not a screen: a design-system specimen or a proposed component drawn on its own;
 * - blocked: the app cannot reach the state until a contract operation, a contract field or an
 *   owner decision exists (the list is issue 873,
 *   https://github.com/shaiknoorullah/hg-mono/issues/873);
 * - unpairable: the board draws a flow or a layout the app does not have, and no route reaches it.
 *
 * What a declaration saves is the screen the app shows in its place: the application open at
 * `#/riders/<id>`, claimed by the signed-in reviewer. Mock mode only.
 *
 * Board ids are written out in full on purpose: tools/e2e/web/check-boards.mjs validates only
 * literal ids.
 */
const BASE = process.env.E2E_ADMIN_REDESIGN_URL ?? process.env.BASE_URL;
if (BASE) test.use({ baseURL: BASE });

const RO = 'https://github.com/shaiknoorullah/hg-mono/issues/873';

const GROUPS: ReadonlyArray<{ name: string; boards: ReadonlyArray<readonly [string, string]> }> = [
  {
    name: 'not screens: specimens and proposed components',
    boards: [
      ['admin/rider-onboarding/FocusSpecimens', 'not a screen: a sheet of the design system’s keyboard focus rings on its own components'],
      ['admin/rider-onboarding/ForcedColors', 'not a screen: a specimen sheet of the forced-colours (Windows high contrast) rendering of the components'],
      ['admin/rider-onboarding/PanelDecision', 'not a screen: the proposed decision panel component, drawn alone in a 924 by 740 slot'],
      ['admin/rider-onboarding/PanelRejectDocument', 'not a screen: the proposed document rejection panel component, drawn alone in a 500 by 740 slot'],
      ['admin/rider-onboarding/SideNav', 'not a screen: the proposed side navigation component, drawn alone at 264 by 900; the shell is in every page board'],
    ],
  },
  {
    name: 'blocked: the masked email and its reveal',
    boards: [
      ['admin/rider-onboarding/DetailEmailReveal', `blocked on a missing contract operation: no way to reveal a rider's email with a recorded reason (${RO})`],
      ['admin/rider-onboarding/DetailEmailRevealInvalid', `blocked on a missing contract operation: no reveal of a rider's email (${RO})`],
      ['admin/rider-onboarding/DetailEmailRevealSubmitting', `blocked on a missing contract operation: no reveal of a rider's email (${RO})`],
      ['admin/rider-onboarding/DetailEmailRevealFailed', `blocked on a missing contract operation: no reveal of a rider's email (${RO})`],
      ['admin/rider-onboarding/DetailEmailRevealRefused', `blocked on a missing contract operation: no reveal of a rider's email, so no 403 to draw (${RO})`],
      ['admin/rider-onboarding/DetailEmailRevealRateLimited', `blocked on a missing contract operation: no reveal of a rider's email, so no 429 or retry time (${RO})`],
      ['admin/rider-onboarding/DetailEmailRevealed', `blocked on a missing contract operation: no reveal of a rider's email, and the server sends the email in full instead of masked (${RO})`],
      ['admin/rider-onboarding/DetailEmailHiddenAgain', `blocked on a missing contract operation: no reveal of a rider's email, so no reveal lifetime (${RO})`],
    ],
  },
  {
    name: 'blocked: support agents and re-opening',
    boards: [
      ['admin/rider-onboarding/DetailSupportCase', `blocked on an owner decision and a missing contract field: support agents have no rider route at launch, and the application carries no support case (${RO})`],
      ['admin/rider-onboarding/DetailSupportError', `blocked on an owner decision: support agents have no rider route at launch (${RO})`],
      ['admin/rider-onboarding/DetailSupportLoading', `blocked on an owner decision: support agents have no rider route at launch (${RO})`],
      ['admin/rider-onboarding/DetailSupportReopen', `blocked on a missing contract operation and an owner decision: no operation re-opens a rejected application, and support agents have no rider route (${RO})`],
      ['admin/rider-onboarding/DetailSupportReopenRefused', `blocked on a missing contract operation and an owner decision: no operation re-opens a rejected application (${RO})`],
      ['admin/rider-onboarding/DecisionSupportReopen', `blocked on a missing contract operation: no operation re-opens a rejected application (${RO})`],
      ['admin/rider-onboarding/SupportReopenFailed', `blocked on a missing contract operation: no operation re-opens a rejected application (${RO})`],
      ['admin/rider-onboarding/SupportReopenInvalid', `blocked on a missing contract operation: no operation re-opens a rejected application (${RO})`],
      ['admin/rider-onboarding/SupportReopenOffline', `blocked on a missing contract operation: no operation re-opens a rejected application (${RO})`],
      ['admin/rider-onboarding/SupportReopenSubmitting', `blocked on a missing contract operation: no operation re-opens a rejected application (${RO})`],
    ],
  },
  {
    name: 'blocked: Super Admin reverse, override and release',
    boards: [
      ['admin/rider-onboarding/DetailSuperAdmin', `blocked on a missing contract operation: no operation reverses a rejection or overrides a document decision (${RO})`],
      ['admin/rider-onboarding/DetailSuperPast30', `blocked on a missing contract operation: no operation reverses a rejection, so no 30-day window (${RO})`],
      ['admin/rider-onboarding/DetailSuperClaim', `blocked on a missing contract operation: no operation releases or reassigns another reviewer’s claim (${RO})`],
      ['admin/rider-onboarding/DecisionSuperAdmin', `blocked on a missing contract operation: no operation reverses a rejection (${RO})`],
      ['admin/rider-onboarding/SuperReverseFailed', `blocked on a missing contract operation: no operation reverses a rejection (${RO})`],
      ['admin/rider-onboarding/SuperReverseInvalid', `blocked on a missing contract operation: no operation reverses a rejection (${RO})`],
      ['admin/rider-onboarding/SuperReverseSubmitting', `blocked on a missing contract operation: no operation reverses a rejection (${RO})`],
      ['admin/rider-onboarding/SuperOverride', `blocked on a missing contract operation: no operation overrides a document decision (${RO})`],
      ['admin/rider-onboarding/SuperOverrideFailed', `blocked on a missing contract operation: no operation overrides a document decision (${RO})`],
      ['admin/rider-onboarding/SuperOverrideInvalid', `blocked on a missing contract operation: no operation overrides a document decision (${RO})`],
      ['admin/rider-onboarding/SuperOverrideNoDecision', `blocked on a missing contract operation: no operation overrides a document decision (${RO})`],
      ['admin/rider-onboarding/SuperOverrideReject', `blocked on a missing contract operation: no operation overrides a document decision (${RO})`],
      ['admin/rider-onboarding/SuperOverrideSubmitting', `blocked on a missing contract operation: no operation overrides a document decision (${RO})`],
      ['admin/rider-onboarding/SuperReleaseClaim', `blocked on a missing contract operation: no operation releases or reassigns a claim, and no staff list to reassign to (${RO})`],
    ],
  },
  {
    name: 'blocked: the forgery hold, the attempt limit, a changed vehicle and a rider not yet submitted',
    boards: [
      ['admin/rider-onboarding/DetailForgeryHold', `blocked on a missing contract operation: no way to put a rider application on a forgery hold, or to read one (${RO})`],
      ['admin/rider-onboarding/DecisionRejectDocumentForgery', `blocked on a missing contract operation: no forgery hold that records the check and the note and releases the claim (${RO})`],
      ['admin/rider-onboarding/DecisionDeactivated', `blocked on a missing contract field: RiderApplication carries no deactivation outcome (account status and reason) (${RO})`],
      ['admin/rider-onboarding/DecisionRejectFinal', `blocked on a missing contract field: no deactivation outcome on RiderApplication for the last attempt (${RO})`],
      ['admin/rider-onboarding/DecisionRequestChangesFinal', `blocked on a missing contract field: no deactivation outcome on RiderApplication for the last attempt (${RO})`],
      ['admin/rider-onboarding/DetailVehicleChanged', `blocked on a missing contract field: no vehicle-change event (previous type and date) and no distinct Changes requested state (${RO})`],
      ['admin/rider-onboarding/DetailVehicleChangedAfterApproval', `blocked on a missing contract field: no vehicle-change event and no forced-offline account state (${RO})`],
      ['admin/rider-onboarding/DetailPreSubmission', `blocked on a missing contract field: RiderApplication requires submitted_at and sla_due_at, so a rider with no documents cannot be opened as drawn (${RO})`],
      ['admin/rider-onboarding/DetailRegistered', `blocked on a missing contract field: RiderApplication requires a profile, submitted_at and sla_due_at, so a rider who has only registered cannot be opened (${RO})`],
    ],
  },
  {
    name: 'unpairable: a flow or a layout the app does not have',
    boards: [
      ['admin/rider-onboarding/DetailSessionExpired', 'the board draws an in-page "Your session ended" card that replaces the application; the app answers a 401 with the console’s one blocking dialog over the page it was on, drawn by the alerts and sessions boards'],
      ['admin/rider-onboarding/DetailClaimTakenWhileReading', 'the board draws the moment another reviewer takes the application while you read it; nothing tells the open page its claim moved, and the settled state is the claimed-by-another-reviewer board'],
      ['admin/rider-onboarding/DetailReady', 'the board draws Approve rider switched off with every document approved, because approval had no contract when it was drawn; the approval change has landed, so no state of the app draws it, and the last-document board draws the approval that works'],
      ['admin/rider-onboarding/DetailLastDocApproved', 'the board draws the status line that says approval is not available after the last document is approved, from before the approval contract change; the app moves focus to Approve rider instead, as the last-document-approved board draws'],
    ],
  },
];

test.describe('redesigned admin · rider onboarding boards no capture can pair (mock)', () => {
  test.use({ colorScheme: 'light' });

  for (const group of GROUPS) {
    test(group.name, async ({ page }) => {
      await openApp(page, { detail: (me) => inReview(me) }, FATIMA.id);
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('Not built yet')).toHaveCount(0);
      for (const [board, reason] of group.boards) await declareUnpairable(page, board, reason);
    });
  }
});
