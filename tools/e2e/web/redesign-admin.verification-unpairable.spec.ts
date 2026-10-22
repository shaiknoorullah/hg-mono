import { expect, test } from '@playwright/test';

import { declareUnpairable } from './design';
import { E2E_MODE } from './mode';
import { appWith, arrive, karahiApp, karahiCert, KARAHI, openAt, karahiRow, type Scene } from './redesign-admin.verification.scene';

test.skip(E2E_MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The boards of the Restaurant Verification area that no capture can pair with a screen, each
 * declared with its reason (tools/e2e/README.md, "Design captures"): the harness then lists them
 * as declared not comparable instead of leaving them uncovered. Every board of the area was
 * opened and read before it was put here.
 *
 * Four kinds, and the reason on each says which:
 * - not a screen: a design-system specimen, a proposed component or an annotation sheet drawn on
 *   its own, or several states of one screen drawn side by side;
 * - blocked: the app cannot reach the state until a contract operation, a contract field or an
 *   owner decision exists (the lists are the application review API,
 *   https://github.com/shaiknoorullah/hg-mono/issues/173, and the staff sessions and step-up API,
 *   https://github.com/shaiknoorullah/hg-mono/issues/170);
 * - not built: the contract allows it and the screen does not draw it yet, with the issue;
 * - unreachable: the screen has the state's cause, but not the state.
 *
 * What a declaration saves is the screen the app shows in the board's place, taken from the page
 * the board belongs to: the queue, an application, a certificate, or the certificates entry page.
 * Mock mode only.
 *
 * Board ids are written out in full on purpose: tools/e2e/web/check-boards.mjs validates only
 * literal ids.
 */
const BASE = process.env.E2E_ADMIN_REDESIGN_URL ?? process.env.BASE_URL;
if (BASE) test.use({ baseURL: BASE });

const ISSUE = 'https://github.com/shaiknoorullah/hg-mono/issues/';
const REVIEW_API = `${ISSUE}173`;
const DECISION_RECORD = `${ISSUE}841`;
const REGISTER = `${ISSUE}943`;
const STEP_UP_API = `${ISSUE}170`;
const LOOKUPS_API = `${ISSUE}171`;
const PROFILE_API = `${ISSUE}174`;
const DS_REQUEST = `${ISSUE}699`;
const SIDE_NAV = `${ISSUE}979`;
const VIEWER = `${ISSUE}928`;
const RENEWAL_CASE = `${ISSUE}273`;
const WORKSPACE_GAPS = `${ISSUE}1050`;

const COMPONENT = (what: string) => `not a screen: ${what}, drawn on its own; the page boards that compose it are compared instead (${DS_REQUEST})`;
const COMPOSITE = (what: string) => `not a screen: ${what} drawn side by side on one canvas; each state the app has is captured by its own test, but not at the board's layout`;
const NEEDS = (what: string, issue: string) => `blocked on a missing contract operation: ${what} (${issue})`;

type Boards = ReadonlyArray<readonly [string, string]>;

const QUEUE: Boards = [
  ['admin/restaurant-verification/QueueGrid', COMPONENT('the applications grid and its states, 1152 by 820, with no sidebar or app bar')],
  ['admin/restaurant-verification/Queue-SuperAdmin', NEEDS('no operation releases or reassigns another reviewer’s claim, so "Release claim…" for a super admin cannot be drawn', REVIEW_API)],
  [
    'admin/restaurant-verification/Queue-AllStates',
    NEEDS('the board draws a twelfth onboarding state, "Waiting on certifying body", which the contract’s eleven onboarding states do not have, and a "Released" claim', REVIEW_API),
  ],
];

const APPLICATION: Boards = [
  ['admin/restaurant-verification/AppBody', COMPONENT('the application, documents and scan panes, 1284 by 848, with no sidebar or app bar')],
  ['admin/restaurant-verification/AppFacts', COMPONENT('the application’s key facts list, 356 by 148')],
  [
    'admin/restaurant-verification/Decision-ModalStates',
    COMPOSITE('every decision panel (submitting, not sent, fields to fix) on a 1440 by 3200 canvas'),
  ],
  [
    'admin/restaurant-verification/App-ListOpen',
    `not built: the screen draws the three panes and no applications list strip, so there is no open list to collapse the scan pane (${WORKSPACE_GAPS})`,
  ],
  [
    'admin/restaurant-verification/App-SupportDeepLink',
    `not built: no link opens a document from the application, so a support agent following one is never told their role does not review documents (${WORKSPACE_GAPS})`,
  ],
  [
    'admin/restaurant-verification/App-Rejected',
    NEEDS('the contract’s onboarding states have no "Rejected" value and the application carries no decision record (who decided, when, why)', `${REVIEW_API}, ${DECISION_RECORD}`),
  ],
  ['admin/restaurant-verification/App-DocFlagForgery', NEEDS('no way to put a document on a suspected-forgery hold that records the check as Fail and releases the claim', REVIEW_API)],
  ['admin/restaurant-verification/Case-Forgery', NEEDS('no way to read or hold a suspected-forgery flag on an application, or to limit the decision to a super admin while one is on', REVIEW_API)],
  ['admin/restaurant-verification/Case-ForgeryClear', NEEDS('no super admin action to clear or keep a suspected-forgery flag', REVIEW_API)],
];

const CONSOLE: Boards = [
  ['admin/restaurant-verification/CertPane', COMPONENT('the scan pane of the verification console, 432 by 780')],
  ['admin/restaurant-verification/Checks', COMPONENT('the seven checks (step 2), 482 by 720')],
  ['admin/restaurant-verification/Checks-Gaps', 'not a screen: an annotation sheet on why the seven checks are not the design system’s halal checklist, and what that checklist lacks'],
  ['admin/restaurant-verification/DecisionBar', COMPONENT('the decision bar (step 3), 516 by 178')],
  ['admin/restaurant-verification/Transcription', COMPONENT('the transcription (step 1), 356 by 928')],
  ['admin/restaurant-verification/VerifyHeader', COMPONENT('the certificate and claim strip, 1344 by 108')],
  [
    'admin/restaurant-verification/Verify-Transcription',
    COMPOSITE('the transcription’s required, server-refused, save-failed, saving, saved and date-error states, 1760 by 3000'),
  ],
  [
    'admin/restaurant-verification/Verify-ComputedFail',
    'not a screen: an annotation sheet of three computed or locked failures (Dates valid, Unique not reused, Issuer accepted) side by side at 1760 by 1300; each is captured by its own test',
  ],
  ['admin/restaurant-verification/Verify-Statuses', COMPONENT('a specimen sheet of the halal state badge in rejected, renewal due, expired, revoked and superseded')],
  [
    'admin/restaurant-verification/Verify-OverrideShort',
    'unreachable: the board draws "Add at least 6 more characters" under a note typed against the suggestion, but the Record button stays off until the note has 20 characters, so the client check it shows can never run; the server’s refusal of a short note is captured as the override refused board',
  ],
  [
    'admin/restaurant-verification/Verify-IssuerConfirm',
    NEEDS('no way to record that the issuing body confirmed a certificate outside HalalGoes, so a body that requires confirmation can never be approved', REVIEW_API),
  ],
  [
    'admin/restaurant-verification/Verify-ProposalSent',
    NEEDS('no "waiting on certifying body" state and no action to release the claim while a proposed body is reviewed', REVIEW_API),
  ],
  [
    'admin/restaurant-verification/Verify-WaitingOnBody',
    NEEDS('no "waiting on certifying body" state, so a released application cannot be read as waiting on a body', REVIEW_API),
  ],
  [
    'admin/restaurant-verification/Verify-Renewal',
    NEEDS('no renewal case or claim for a live restaurant’s expiring certificate, outside an application', `${REVIEW_API}, ${RENEWAL_CASE}`),
  ],
  ['admin/restaurant-verification/Verify-RenewalAsk', NEEDS('no renewal case to ask a live restaurant for a different renewal certificate from', `${REVIEW_API}, ${RENEWAL_CASE}`)],
  ['admin/restaurant-verification/Verify-NoorStepUp', NEEDS('no step-up verification before a revoke (no re-authentication call)', STEP_UP_API)],
  ['admin/restaurant-verification/Viewer-ThumbsLoading', NEEDS('documents carry no page count, so the viewer has no pages to show thumbnails of', `${REVIEW_API}, ${VIEWER}`)],
];

const REGISTER_BOARDS: Boards = [
  ['admin/restaurant-verification/HalalGrid', COMPONENT('the halal certificate register grid, 1152 by 820')],
  ['admin/restaurant-verification/HalalState', COMPONENT('the halal state badge in its expiring-soon tint with the date, 220 by 40')],
  ['admin/restaurant-verification/Halal-Register', NEEDS('no operation lists halal certificates by status and expiry, and /certificates is a shell page', `${REVIEW_API}, ${REGISTER}`)],
  ['admin/restaurant-verification/Halal-Register-Empty', NEEDS('no operation lists halal certificates', `${REVIEW_API}, ${REGISTER}`)],
  ['admin/restaurant-verification/Halal-Register-Error', NEEDS('no operation lists halal certificates', `${REVIEW_API}, ${REGISTER}`)],
  ['admin/restaurant-verification/Halal-Register-Filtered', NEEDS('no operation lists halal certificates', `${REVIEW_API}, ${REGISTER}`)],
  ['admin/restaurant-verification/Halal-Register-Loading', NEEDS('no operation lists halal certificates', `${REVIEW_API}, ${REGISTER}`)],
  ['admin/restaurant-verification/Halal-Register-More', NEEDS('no operation lists halal certificates, so no cursor to page with', `${REVIEW_API}, ${REGISTER}`)],
  ['admin/restaurant-verification/Halal-ListOpen', NEEDS('no operation lists halal certificates, so there is no register to open one from', `${REVIEW_API}, ${REGISTER}`)],
];

const SHELL: Boards = [
  ['admin/restaurant-verification/InlineAlert', COMPONENT('the inline alert in its tones, 528 by 134')],
  ['admin/restaurant-verification/InlineAlert-Variants', COMPONENT('every inline alert tone, the blocking alert and the list and action slots, 1200 by 900')],
  ['admin/restaurant-verification/Textarea', COMPONENT('the text area in its label, helper, counter, error and read-only states, 528 by 200')],
  ['admin/restaurant-verification/SideNav', `${COMPONENT('the side navigation expanded, 264 by 900')}; the stub is reconciled in ${SIDE_NAV}`],
  ['admin/restaurant-verification/SideNav-ActiveOptions', `not a screen: options for showing the current page in the side navigation, 408 by 1120; the choice is made in ${SIDE_NAV}`],
  ['admin/restaurant-verification/SideNav-Rail', `${COMPONENT('the side navigation collapsed to its 72 px rail, 72 by 900')}; the stub is reconciled in ${SIDE_NAV}`],
  ['admin/restaurant-verification/Shell-Focus', COMPOSITE('the keyboard focus rings on real components, the grid keyboard map and the certificate pan keys, 1440 by 2600')],
  ['admin/restaurant-verification/Shell-Toasts', COMPOSITE('every decision’s feedback toast (approved, rejected, changes requested, revoked, proposed)')],
  ['admin/restaurant-verification/Shell-Banners', COMPOSITE('the offline, reconnecting and high-severity alert banners')],
  ['admin/restaurant-verification/Shell-AuthStates', COMPOSITE('the step-up and re-sign-in dialog’s wrong-code, too-many-attempts and in-flight states, 1440 by 1500')],
  ['admin/restaurant-verification/Shell-StepUp', NEEDS('no step-up verification before sensitive actions (no re-authentication call, no `mfa_verified_at`)', STEP_UP_API)],
  ['admin/restaurant-verification/Shell-IdleWarning', NEEDS('the session carries no idle or absolute deadline, so the console cannot warn before the 30-minute sign-out', STEP_UP_API)],
  ['admin/restaurant-verification/SignIn-Totp', NEEDS('no authenticator enrolment for a first sign-in (setup code, QR code, confirm)', STEP_UP_API)],
  ['admin/restaurant-verification/SignIn-TotpStates', NEEDS('no authenticator enrolment, so none of its loading, failed and no-QR states exist', STEP_UP_API)],
  ['admin/restaurant-verification/Find', NEEDS('no restaurant directory search, so the shell has no "Find a restaurant"', LOOKUPS_API)],
  ['admin/restaurant-verification/ProfileChanges', NEEDS('no reviewed profile change requests (legal name, address, description); the page is cut at launch', PROFILE_API)],
  ['admin/restaurant-verification/ProfileChanges-States', NEEDS('no reviewed profile change requests; the page is cut at launch', PROFILE_API)],
];

interface Group {
  name: string;
  hash: string;
  scene: Scene;
  boards: Boards;
}

const GROUPS: readonly Group[] = [
  { name: 'queue', hash: '#/restaurants', scene: { list: () => [karahiRow()] }, boards: QUEUE },
  {
    name: 'application',
    hash: `#/restaurants/${KARAHI.id}`,
    scene: { app: (c) => karahiApp(c) },
    boards: APPLICATION,
  },
  {
    name: 'certificate',
    hash: `#/certificates/${KARAHI.certId}`,
    scene: { cert: (c) => karahiCert(c), app: (c) => appWith(c, karahiCert(c)) },
    boards: CONSOLE,
  },
  { name: 'certificates entry page', hash: '#/certificates', scene: {}, boards: REGISTER_BOARDS },
  {
    name: 'shell',
    hash: `#/certificates/${KARAHI.certId}`,
    scene: { cert: (c) => karahiCert(c), app: (c) => appWith(c, karahiCert(c)) },
    boards: SHELL,
  },
];

test.describe('redesigned admin · restaurant verification boards no capture can pair (mock)', () => {
  test.use({ colorScheme: 'light' });

  // Every board of the area is drawn at 1440 wide (or at its own size), and the panes a panel
  // squeezes at 1024 are a finding of their own, not this spec's: the desktop project takes the
  // captures.
  test.skip(({ viewport }) => viewport?.width !== 1440, 'the verification boards are drawn at 1440 wide');

  for (const group of GROUPS) {
    test(group.name, async ({ page }) => {
      await arrive(page, group.scene);
      await openAt(page, group.hash);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('#app-bar-heading')).toBeVisible();
      for (const [board, reason] of group.boards) await declareUnpairable(page, board, reason);
    });
  }
});
