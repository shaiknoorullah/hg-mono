import { expect, test } from '@playwright/test';

import { declareUnpairable } from './design';
import { E2E_MODE } from './mode';
import { boardFailedRefunds, openAdmin } from './redesign-admin.refunds-staff.support';
import { openStaff } from './redesign-admin.staff.scene';

test.skip(E2E_MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The boards of the Refunds and Staff areas that no capture can pair with a screen, each declared
 * with its reason (tools/e2e/README.md, "Design captures"): the harness then lists them as declared
 * not comparable instead of leaving them uncovered. Every board of both areas was opened and read
 * before it was put here or given a capture; neither area's folder holds a board byte-identical to
 * another's.
 *
 * Four kinds, and the reason on each says which:
 * - not a screen: a component or a specimen drawn on its own;
 * - blocked: the app cannot reach the state until a contract operation, a contract field or an
 *   owner decision exists (the lists are issues 917 and 908, linked below);
 * - wrong: the board disagrees with the contract or with an owner decision, and the issue that
 *   lists it says the board is to be redrawn (issues 915 and 908). A capture of it would fail on the
 *   board's mistake, not on the screen;
 * - not built: the board draws a flow or a layout the app does not have.
 *
 * What a declaration saves is the screen the app shows in its place: the Refunds page, the staff
 * list or the invite page. Mock mode only.
 *
 * Board ids are written out in full on purpose: tools/e2e/web/check-boards.mjs validates only
 * literal ids.
 */
const BASE = process.env.E2E_ADMIN_REDESIGN_URL ?? process.env.BASE_URL;
if (BASE) test.use({ baseURL: BASE });

const I = 'https://github.com/shaiknoorullah/hg-mono/issues/';
const R917 = `${I}917`; // refund boards not built, and what each waits for
const R915 = `${I}915`; // refund boards that disagree with the contract
const S908 = `${I}908`; // staff boards that disagree with the contract or the server
const S1033 = `${I}1033`; // the pages emails link to have no boards
const ONCALL = `${I}169`; // naming the platform on-call engineer
const D1 = 'https://github.com/shaiknoorullah/hg-mono/pull/623'; // the pull request that made two-step sign-in optional for staff
const OPTIONAL_MFA = `two-step sign-in is optional for staff (the owner's decision, ${D1})`;
const ORDERS_SPEC = 'redesign-admin.orders-captures.spec.ts';

type Group = { name: string; boards: ReadonlyArray<readonly [string, string]> };

const REFUND_GROUPS: ReadonlyArray<Group> = [
  {
    name: 'refunds: not screens, components the boards import',
    boards: [
      ['admin/refunds/AdminNav', 'not a screen: the admin sidebar drawn alone at 264 by 900, a component the other boards import; the shell is in every page board'],
      ['admin/refunds/OrderDetail', `not a screen of this area: the order workspace the refund boards import, drawn in its own default state; its states are the admin/orders boards, captured by ${ORDERS_SPEC}`],
      ['admin/refunds/LiveMapPane', 'not a screen of this area: the live map pane component, 760 by 790, shared with the order workspace; its states are the LiveMap boards of admin/orders, captured by redesign-admin.live-map-captures.spec.ts'],
      ['admin/refunds/HalalState', 'not a screen: the proposed halal state badge component, drawn alone at 220 by 32'],
      ['admin/refunds/RefundReasons', 'not a screen: a reference sheet that lists the reasons of every scope at once, with who bears each; the form shows the reasons of the scope that is chosen, so no state of it draws the sheet'],
    ],
  },
  {
    name: 'refunds: blocked on the contract or an owner decision',
    boards: [
      ['admin/refunds/RefundFeesOnly', `blocked on a missing contract value: the staff refund route's scope has no fees-only value, so the board's Fees only scope cannot be chosen or issued (${R917})`],
      ['admin/refunds/RefundFeesOnlyIssued', `blocked on a missing contract value: the staff refund route's scope has no fees-only value, so a fees-only refund cannot be issued (${R917})`],
      ['admin/refunds/RefundHalalConcernStaff', `blocked on a missing contract field: a staff refund has no field for whether the evidence backs up a halal concern, and no evidence ids, so the restaurant-pays rule the board draws cannot be recorded (${R917}, https://github.com/shaiknoorullah/hg-mono/issues/916)`],
      ['admin/refunds/RefundApprovalsQueue', `blocked on an owner decision: a placeholder board for a refund approvals queue; whether to build it for launch is open, and it needs an approved board first (${R917})`],
      ['admin/refunds/RefundFailed', `blocked on an owner decision: the board's read-only failed-refund panel names the on-call engineer with placeholders ([On-call name], [phone]) the owner has not given (${R917}); the app opens a failed refund's order or starts its replacement from the queue row`],
      ['admin/refunds/RefundRetry', `not built: the board starts a replacement from the failed refund listed on the order, filled in from it; the app fills a replacement in only from the failed-refunds queue on the Refunds page, which the RefundsRetry capture draws (${R917})`],
    ],
  },
  {
    name: 'refunds: not states of the platform',
    boards: [
      ['admin/refunds/RefundDailyCap', `not a state of the platform: the board's canvas note says so. No endpoint returns the remaining limit and the server answers 202 above a limit instead of refusing, so nothing reaches this screen (${R915}, items 2 and 3)`],
      ['admin/refunds/RefundSelfApproval', `not a state of the platform: the board's canvas note says so. The server answers "can't approve your own" only when approving, never when issuing, and the approvals queue it points to waits on an owner decision (${R915}, item 3; ${R917})`],
    ],
  },
];

const ONCALL_PLACEHOLDERS = `blocked on an owner decision: the board names the platform on-call engineer with placeholders ([ON-CALL NAME], [ON-CALL PHONE]) and the runbook as bare text; the app reads the contact from the build and says when there is none, until the owner names them (${ONCALL}; ${S908}, item 7)`;

const STAFF_GROUPS: ReadonlyArray<Group> = [
  {
    name: 'staff: the on-call engineer and what has no operation yet',
    boards: [
      ['admin/staff/StaffDetailCancelInvite', ONCALL_PLACEHOLDERS],
      ['admin/staff/StaffDetailRemoveAccess', ONCALL_PLACEHOLDERS],
      ['admin/staff/StaffDetailResetMfa', ONCALL_PLACEHOLDERS],
      ['admin/staff/StaffDetailSuspended', ONCALL_PLACEHOLDERS],
      ['admin/staff/StaffDetailUnknownRole', ONCALL_PLACEHOLDERS],
      ['admin/staff/StaffDetailResetMfaDrawAhead', `blocked on a missing contract operation: a draw-ahead of a form that resets a colleague's two-step sign-in; no operation does, so the console sends a super admin to the on-call engineer (${S908}, item 4)`],
      ['admin/staff/StaffDetailResetMfaDone', `blocked on a missing contract operation: a draw-ahead of the result of a reset (who reset it and how it was confirmed); no operation resets two-step sign-in (${S908}, item 4)`],
    ],
  },
  {
    name: 'staff: not screens',
    boards: [
      ['admin/staff/AdminSidebar', 'not a screen: the proposed side navigation component, drawn alone at 264 by 900; the shell is in every page board'],
      ['admin/staff/FocusStates', 'not a screen: a specimen sheet of keyboard focus states on the design system’s own components, 1440 by 1600'],
    ],
  },
];

const NO_LOOKUP = 'no operation looks an invitation up, so the app has no checking step and learns a link is spent only when the password is sent';
const STALE_STEP1 = `wrong: draws Step 1 of 2 and "invited as an Admin by Aminah Rahman"; ${OPTIONAL_MFA}, so the app has one step, and no lookup gives the role or the inviter`;
const NO_STEP2 = `wrong: draws step 2 of 2, setting up two-step sign-in while accepting the invite; ${OPTIONAL_MFA}, so the app has no second step`;
const SPENT = `not built as drawn: the server answers an expired and a used link with the same 400 TOKEN_CONSUMED, so the app has one "expired or already used" screen; the board draws it apart, names the inviter, or needs an operation that does not exist. The one board is asked for in ${S1033}`;

const ACCEPT_GROUPS: ReadonlyArray<Group> = [
  {
    name: 'accept an invite: no lookup, one step',
    boards: [
      ['admin/staff/AcceptLoading', `not built: the board checks the link before it shows the form; ${NO_LOOKUP}`],
      ['admin/staff/AcceptLookupError', `not built: the board's "we couldn't check your invite link" needs a lookup; ${NO_LOOKUP}. A send that gets no answer says so on the form`],
      ['admin/staff/AcceptSetPassword', STALE_STEP1],
      ['admin/staff/AcceptPasswordShort', STALE_STEP1],
      ['admin/staff/AcceptBreached', STALE_STEP1],
      ['admin/staff/AcceptPasswordSubmitting', STALE_STEP1],
      ['admin/staff/AcceptOffline', STALE_STEP1],
      ['admin/staff/AcceptSetPassword390', STALE_STEP1],
      ['admin/staff/AcceptSetPassword320', STALE_STEP1],
      ['admin/staff/AcceptTotp', NO_STEP2],
      ['admin/staff/AcceptTotpSubmitting', NO_STEP2],
      ['admin/staff/AcceptTotpWrong', NO_STEP2],
      ['admin/staff/AcceptTotpLocked', NO_STEP2],
      ['admin/staff/AcceptResumeStep2', NO_STEP2],
      ['admin/staff/AcceptTotp390', NO_STEP2],
      ['admin/staff/AcceptTotp320', NO_STEP2],
      ['admin/staff/AcceptUsed', SPENT],
      ['admin/staff/AcceptExpired', SPENT],
      ['admin/staff/AcceptExpiredResend', SPENT],
      ['admin/staff/AcceptExpiredMidFlow', `${SPENT}. This one is also a step-2 state, which the app does not have (${D1})`],
      ['admin/staff/AcceptLockedPastExpiry', `${SPENT}. This one is also a step-2 state, which the app does not have (${D1})`],
      ['admin/staff/AcceptDone', `wrong: tells the person to sign in with a code from an authenticator app and to keep it safe; ${OPTIONAL_MFA}, so the app says to sign in with the work email and the password`],
    ],
  },
];

const SIGN_IN_GROUPS: ReadonlyArray<Group> = [
  {
    name: 'sign-in pages the invite flow leads to',
    boards: [
      ['admin/staff/SessionFirstSignIn', `wrong: says to sign in with a code from an authenticator app and pre-fills the email from an invite lookup that does not exist; ${OPTIONAL_MFA}. The sign-in page the emails lead to is listed in ${S1033}`],
      ['admin/staff/SessionLostAuthenticator', `blocked on an owner decision: draws the lost-authenticator help under the sign-in code step; the app draws it as its own screen, reached from that step, and its on-call line still carries placeholders until the owner names the engineer (${ONCALL})`],
    ],
  },
];

test.describe('redesigned admin · refund and staff boards no capture can pair (mock)', () => {
  test.use({ colorScheme: 'light' });

  // Every board declared here that is not a narrow-layout one is drawn at 1440 wide, and the
  // tablet project would only repeat the screenshots: the desktop project takes them.
  test.skip(({ viewport }) => viewport?.width !== 1440, 'the boards are drawn at 1440 wide');

  for (const group of REFUND_GROUPS) {
    test(group.name, async ({ page }) => {
      await openAdmin(page, '#/refunds', { failed: boardFailedRefunds });
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('grid', { name: 'Failed refunds' }).getByText('HG-7XQ3NE')).toBeVisible();
      await expect(page.getByText('Not built yet')).toHaveCount(0);
      for (const [board, reason] of group.boards) await declareUnpairable(page, board, reason);
    });
  }

  for (const group of STAFF_GROUPS) {
    test(group.name, async ({ page }) => {
      await openStaff(page, '#/staff');
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('grid', { name: 'Staff accounts' }).getByText('Sana Qureshi').first()).toBeVisible();
      await expect(page.getByText('Not built yet')).toHaveCount(0);
      for (const [board, reason] of group.boards) await declareUnpairable(page, board, reason);
    });
  }

  for (const group of ACCEPT_GROUPS) {
    test(group.name, async ({ page }) => {
      await page.goto('/accept-invite?token=e2eRedesignAdminWp1LinkToken_abcdefghijklmn');
      await expect(page.getByRole('heading', { level: 1, name: 'Set up your HalalGoes admin account' })).toBeVisible();
      for (const [board, reason] of group.boards) await declareUnpairable(page, board, reason);
    });
  }

  for (const group of SIGN_IN_GROUPS) {
    test(group.name, async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
      for (const [board, reason] of group.boards) await declareUnpairable(page, board, reason);
    });
  }
});
