import { expect, test, type Page } from '@playwright/test';

import { declareUnpairable } from './design';
import { projectMeta } from './mode';
import { STATUS, choose, details, open, save } from './redesign-restaurant.onboarding.scene';
import { MODE, openSignedIn, scenarioPayload as fixture, torontoDateIn as torontoDate } from './redesign-restaurant.support';

test.skip(MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The boards of the restaurant Onboarding area that no capture can pair with a screen, each declared
 * with its reason (tools/e2e/README.md, "Design captures"): the harness then lists them as declared not
 * comparable instead of leaving them uncovered. The states that can be captured are in
 * `redesign-restaurant.onboarding-captures.spec.ts`; this file holds 44 of the area's
 * 139 boards.
 *
 * Five kinds, and the reason on each says which:
 * - a part drawn alone: the page boards are made of these, and are compared instead;
 * - several rows in several states at once: one screenshot cannot match a board that draws four rows
 *   each with a different error;
 * - blocked: the app cannot reach the state until a contract operation, a contract field or an owner
 *   decision exists
 *   ([#848](https://github.com/shaiknoorullah/hg-mono/issues/848),
 *   [#849](https://github.com/shaiknoorullah/hg-mono/issues/849));
 * - not built: the screen is on the list of unbuilt onboarding items
 *   ([#851](https://github.com/shaiknoorullah/hg-mono/issues/851)), or on the list of boards the app
 *   cannot draw ([#1046](https://github.com/shaiknoorullah/hg-mono/issues/1046));
 * - drawn at a size the app does not have.
 *
 * What a declaration saves is the screen the app shows in its place, so the capture shows what is
 * there instead. Board ids are written out in full on purpose: tools/e2e/web/check-boards.mjs
 * validates only literal ids.
 */

const NB = 'https://github.com/shaiknoorullah/hg-mono/issues/851';
const UNDRAWN = 'https://github.com/shaiknoorullah/hg-mono/issues/1046';
const CONTRACT = 'https://github.com/shaiknoorullah/hg-mono/issues/848';
const CUISINES = 'https://github.com/shaiknoorullah/hg-mono/issues/849';

const PART = 'a part drawn alone, not a screen:';
const PAGES_ARE_COMPARED = 'the page boards that import it are compared instead';

type Group = {
  name: string;
  /** How the app is put in the state whose place the declarations take. */
  show: (page: Page) => Promise<void>;
  boards: ReadonlyArray<readonly [string, string]>;
};

const docsStep = async (page: Page) => {
  await open(page, '/onboarding/documents', { status: STATUS.documents, docs: 'restaurant_document_pack_ready' });
  await expect(page.getByTestId('document-workspace')).toBeVisible();
};

const GROUPS: ReadonlyArray<Group> = [
  {
    name: 'parts: the setup chrome',
    show: docsStep,
    boards: [
      ['restaurant/onboarding/OnbTop', `${PART} the 1440 by 64 setup header; every page board draws it in its first 64 px`],
      ['restaurant/onboarding/AuthTop', `${PART} the 1440 by 80 sign-in header that the reflow boards draw above the setup`],
      ['restaurant/onboarding/OnbSide', `${PART} the 288 by 836 setup checklist rail (collapsible); ${PAGES_ARE_COMPARED}`],
      ['restaurant/onboarding/OnbPhoneHead', `${PART} the 358 by 260 reflow setup header with the checklist collapsed; ${PAGES_ARE_COMPARED}`],
    ],
  },
  {
    name: 'parts: the panes and mains of each step',
    show: docsStep,
    boards: [
      ['restaurant/onboarding/ProfilePanes', `${PART} the 1096 by 796 business profile, sections and detail, drawn in one of thirteen modes; ${PAGES_ARE_COMPARED}`],
      ['restaurant/onboarding/DocsPanes', `${PART} the 1096 by 796 documents, list and detail, drawn in one of fourteen modes; ${PAGES_ARE_COMPARED}`],
      ['restaurant/onboarding/ReviewPanes', `${PART} the 1096 by 796 review and fix documents, list and detail; ${PAGES_ARE_COMPARED}`],
      ['restaurant/onboarding/PayoutPanes', `${PART} the 1096 by 796 payout setup, status and next step; ${PAGES_ARE_COMPARED}`],
      ['restaurant/onboarding/MenuPanes', `${PART} the 1096 by 796 first menu and opening hours; ${PAGES_ARE_COMPARED}`],
      ['restaurant/onboarding/AccountState', `${PART} the 1096 by 796 account state and setup blockers; ${PAGES_ARE_COMPARED}`],
      ['restaurant/onboarding/ProfileMain', `${PART} the 832 by 2360 business profile form that the tablet and reflow boards import; ${PAGES_ARE_COMPARED}`],
      ['restaurant/onboarding/DocsMain', `${PART} the 832 by 2300 documents step that the tablet and reflow boards import; ${PAGES_ARE_COMPARED}`],
      ['restaurant/onboarding/ReviewMain', `${PART} the 832 by 1860 review and fix documents that the tablet and reflow boards import; ${PAGES_ARE_COMPARED}`],
      ['restaurant/onboarding/PayoutMain', `${PART} the 832 by 1080 payout setup step that the tablet and reflow boards import; ${PAGES_ARE_COMPARED}`],
      ['restaurant/onboarding/MenuMain', `${PART} the 832 by 1240 first menu that the tablet and reflow boards import; ${PAGES_ARE_COMPARED}`],
      ['restaurant/onboarding/HoursBlock', `${PART} the 832 by 860 opening hours that the tablet and reflow boards import; ${PAGES_ARE_COMPARED}`],
      ['restaurant/onboarding/RenewCert', `${PART} the 640 by 560 renewed halal certificate panel (setup blocker and delisted console); the blocker boards that import it are compared instead`],
      ['restaurant/onboarding/AppNotApproved', `${PART} the 560 by 900 application-not-approved content; the page board App-NotApproved is compared instead`],
    ],
  },
  {
    name: 'several rows in several error states at once',
    show: docsStep,
    boards: [
      ['restaurant/onboarding/Docs-AttachErrors', 'the board draws all four rows at once, each with a different save error (an upload that did not finish, details not saved after a network error, a refused 422); one capture reaches one row at a time'],
      ['restaurant/onboarding/Docs-UploadErrors', 'the board draws all four rows at once, each with a different upload error (type, certifier, size, checksum); one capture reaches one row at a time'],
      ['restaurant/onboarding/Docs-ScanRejected', 'the board draws all four rows at once: the three upload errors of Docs-UploadErrors and, selected, a file our file check rejected with its reason; one capture reaches one row at a time'],
    ],
  },
  {
    name: 'not built: replacing an added document',
    show: docsStep,
    boards: [
      ['restaurant/onboarding/Docs-Replacing', `not built: the documents step offers a file picker only on an empty, rejected or expired row; an added row has Download only, so a document cannot be replaced before it is sent (${UNDRAWN})`],
    ],
  },
  {
    name: 'not built: withdrawing an application',
    show: docsStep,
    boards: [
      ['restaurant/onboarding/Withdraw-Confirm', `blocked on a missing contract operation: nothing withdraws an application from the restaurant side (${CONTRACT})`],
      ['restaurant/onboarding/Withdraw-Confirming', `blocked on a missing contract operation: nothing withdraws an application from the restaurant side (${CONTRACT})`],
      ['restaurant/onboarding/Withdraw-Error', `blocked on a missing contract operation: nothing withdraws an application from the restaurant side (${CONTRACT})`],
    ],
  },
  {
    name: 'not built: the renewed certificate on the review step',
    show: async (page) => {
      await open(page, '/onboarding/review', { status: STATUS.review, profile: 'restaurant_profile_halal_expired' }, { pack: 'restaurant_document_pack_halal_expired' });
      await choose(page, 'halal-certificate-hma-2027.pdf');
      await expect(details(page, 'halal certificate')).toBeVisible();
      await page.locator('#halal-certificate-valid').fill(torontoDate(730));
      await save(page).click();
      // Recorded, not asserted: the footer the board's button belongs to is "Send renewal"; the one the
      // page shows after the save is "Review status" ("Nothing to do right now").
      await page.waitForLoadState('networkidle');
      const sendRenewal = await page.getByRole('region', { name: 'Send renewal' }).count();
      test.info().annotations.push({ type: 'send-renewal-footer', description: sendRenewal > 0 ? 'shown' : 'not shown' });
    },
    boards: [
      ['restaurant/onboarding/Review-ExpiredReplaced', `not reachable: on the review step a saved document is drawn as in review, and the footer that offers "Send renewed certificate" looks for a replaced row in another state, so the page says "Nothing to do right now" (${UNDRAWN})`],
      ['restaurant/onboarding/Review-ExpiredSending', `not reachable: the "Send renewed certificate" button the board presses never shows on the review step (${UNDRAWN})`],
      ['restaurant/onboarding/Review-ExpiredSendFailed', `not reachable: the "Send renewed certificate" button the board presses never shows on the review step (${UNDRAWN})`],
    ],
  },
  {
    name: 'not built: the profile map pin, in-page sign-in and read-only view',
    show: async (page) => {
      await open(page, '/onboarding/profile', { status: STATUS.profile });
      await expect(page.getByTestId('profile-screen')).toBeVisible();
    },
    boards: [
      ['restaurant/onboarding/Profile-SessionExpired', `not built: a lost session shows the console's one signed-out dialog, not a sign-in inside the page (${NB})`],
      ['restaurant/onboarding/Profile-Location', `not built: the profile has no map search; a coordinate readout with arrow keys stands in for the pin (${NB})`],
      ['restaurant/onboarding/Profile-SearchError', `not built: the profile has no map search, so there is no "no match" state to draw (${NB})`],
      ['restaurant/onboarding/Profile-PinPlaced', `not built: the profile has no map and no pin to place (${NB})`],
      ['restaurant/onboarding/Profile-PinMoved', `not built: the profile has no map and no pin to drag (${NB})`],
      ['restaurant/onboarding/Profile-ReadOnly', `not built: the reviewed-profile read-only view, and blocked on the pin-move request that has no contract operation (${NB})`],
    ],
  },
  {
    name: 'payout: the live console page',
    show: async (page) => {
      await open(page, '/onboarding/payout', { status: STATUS.payout, connect: 'connect_status_past_due' });
      await expect(page.getByTestId('payout-screen')).toBeVisible();
    },
    boards: [
      ['restaurant/onboarding/Payout-PastDue', `the board draws the live console's payouts page with Stripe's pause and a new order arriving in the header strip; the payout page of the live console is the payouts area's, and the strip is drawn by the live orders area (${UNDRAWN})`],
    ],
  },
  {
    name: 'drawn at a size the app does not have: opening hours at 912',
    show: async (page) => {
      await open(page, '/onboarding/menu', { status: STATUS.menu, menu: 'owned_menu_with_pending_version', hours: 'restaurant_hours_split_past_midnight' });
      await expect(page.getByTestId('hours-summary')).toBeVisible();
    },
    boards: [
      ['restaurant/onboarding/Hours-Set', 'drawn 912 by 1020, a width the app does not have (it runs at 1440, from 1024 on tablets, and reflows to 320); the saved opening hours at 1440 are compared as Menu-HoursSet'],
    ],
  },
  {
    name: 'setup blocker: a food safety certificate',
    show: async (page) => {
      await open(page, '/onboarding', { status: STATUS.payout, profile: 'restaurant_profile_halal_certified', docs: 'restaurant_document_pack_food_safety_expired' });
      await page.waitForLoadState('networkidle');
    },
    boards: [
      ['restaurant/onboarding/Delisted-Setup-FoodSafety', `not built: the setup blocker is drawn only for the halal certificate; an expired food safety certificate while setup is open has no blocker page (${UNDRAWN})`],
    ],
  },
  {
    name: 'the live console for account states',
    show: async (page) => {
      await page.route('**/v1/restaurant/profile', async (route) => route.fulfill({ json: { data: await fixture(page, 'restaurant_profile_account_suspended') } }));
      await page.route('**/v1/restaurant/onboarding/status', async (route) => route.fulfill({ json: { data: await fixture(page, STATUS.done) } }));
      await openSignedIn(page, '/orders');
      await page.waitForLoadState('networkidle');
    },
    boards: [
      ['restaurant/onboarding/Suspended-Console', `not built: no console without a board of orders and with new orders in a strip under the app bar; the app draws a suspended live restaurant as the orders board with status banners (${UNDRAWN})`],
      ['restaurant/onboarding/Delisted-Console', `not built: no console without a board of orders and with new orders in a strip under the app bar; the app draws a delisted live restaurant as the orders board with status banners (${UNDRAWN})`],
      ['restaurant/onboarding/Delisted-Console-Renew', `not built: no console for a delisted restaurant with the renewal panel beside a list of orders (${UNDRAWN})`],
      ['restaurant/onboarding/Delisted-Console-Sent', `not built: no console for a delisted restaurant with a renewed certificate sent, beside a list of orders (${UNDRAWN})`],
    ],
  },
];

test.describe('redesigned restaurant · onboarding boards no capture can pair (mock)', () => {
  test.use({ colorScheme: 'light' });

  // Every board here is drawn at 1440 wide (Hours-Set at 912); the desktop project takes the captures.
  test.skip(({ viewport }) => viewport?.width !== 1440, 'the boards are drawn at 1440 wide');

  for (const group of GROUPS) {
    test(group.name, async ({ page }) => {
      await group.show(page);
      for (const [board, reason] of group.boards) await declareUnpairable(page, board, reason);
    });
  }
});

test.describe('redesigned restaurant · onboarding boards no capture can pair, tablet and phone (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('tablet: the console for account states', async ({ page }) => {
    test.skip(page.viewportSize()?.width !== 1024, 'drawn at 1024 wide');
    await page.route('**/v1/restaurant/profile', async (route) => route.fulfill({ json: { data: await fixture(page, 'restaurant_profile_account_suspended') } }));
    await page.route('**/v1/restaurant/onboarding/status', async (route) => route.fulfill({ json: { data: await fixture(page, STATUS.done) } }));
    await openSignedIn(page, '/orders');
    await page.waitForLoadState('networkidle');
    await declareUnpairable(page, 'restaurant/onboarding/Tab-SuspendedConsole-1024', `not built: no console without a board of orders and with new orders in a strip under the app bar (${UNDRAWN})`);
    await declareUnpairable(page, 'restaurant/onboarding/Tab-DelistedConsole-1024', `not built: no console without a board of orders and with new orders in a strip under the app bar (${UNDRAWN})`);
  });

  test.describe('phone', () => {
    test.use({ viewport: { width: 320, height: 1000 } });

    test('reflow: the business profile with the cuisine picker', async ({ page }) => {
      test.skip(projectMeta().viewport !== 'desktop', 'one capture at 320 px, not one per project');
      await open(page, '/onboarding/profile', { status: STATUS.profile });
      await expect(page.getByTestId('profile-screen')).toBeVisible();
      await declareUnpairable(
        page,
        'restaurant/onboarding/Reflow-Profile-320',
        `blocked on a missing contract operation: the board draws the cuisine picker, and no operation lists the cuisines a restaurant can choose (${CUISINES}); the profile at 320 px is what the app draws`,
      );
    });
  });
});
