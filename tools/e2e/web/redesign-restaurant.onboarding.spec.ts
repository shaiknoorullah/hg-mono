/**
 * Restaurant redesign onboarding (setup after sign-in): the states a new owner meets before the
 * console opens. Each state is captured for the design board it must match (tools/e2e/README.md,
 * "Design captures"); boards are drawn at 1440 wide, so the tablet project takes no capture.
 *
 * Mock mode only: the onboarding status, document list and profile come from the contract
 * fixtures by scenario, answered with `page.route`.
 */
import { expect, test, type Page, type Route } from '@playwright/test';
import { expectDesignFor, type BoardFor } from './design';
import { MODE, MOCK_API, documentScrolls, openSignedIn } from './redesign-restaurant.support';

const ONB = 'restaurant/onboarding/';

async function payload(page: Page, scenario: string) {
  const r = await page.request.get(`${MOCK_API}/__mock/scenarios/${scenario}`);
  return (await r.json()).data.payload;
}

/** Answers `glob` with a contract fixture; `status` makes it an error answer instead. */
async function answer(page: Page, glob: string, scenario: string | { status: number }) {
  if (typeof scenario !== 'string') {
    await page.route(glob, (route: Route) =>
      route.fulfill({ status: scenario.status, json: { error: { code: 'INTERNAL_ERROR', message: 'boom', request_id: 'req_e2e' } } }),
    );
    return;
  }
  const data = await payload(page, scenario);
  await page.route(glob, (route: Route) => route.fulfill({ json: { data } }));
}

async function open(page: Page, path: string, state: { status: string | { status: number }; docs: string | { status: number }; profile?: string }) {
  await answer(page, '**/v1/restaurant/onboarding/status', state.status);
  await answer(page, '**/v1/restaurant/documents', state.docs);
  if (state.profile) await answer(page, '**/v1/restaurant/profile', state.profile);
  await openSignedIn(page, path);
}

async function settled(page: Page, board: BoardFor) {
  const m = await documentScrolls(page);
  expect(m.scrollWidth, 'nothing overflows sideways').toBeLessThanOrEqual(m.innerWidth);
  await expectDesignFor(page, board);
}

test.describe('restaurant redesign · onboarding (mock)', () => {
  test.skip(MODE !== 'mock', 'states answered from the contract fixtures');

  test('documents step, nothing added yet', async ({ page }) => {
    await open(page, '/onboarding/documents', { status: 'restaurant_onboarding_documents_pending', docs: 'restaurant_document_pack_empty', profile: 'restaurant_profile_account_pending' });
    await expect(page.getByTestId('setup-rail').first()).toBeVisible();
    await settled(page, { 1440: `${ONB}Docs-None` });
  });

  test('documents step, the list does not load', async ({ page }) => {
    await open(page, '/onboarding/documents', { status: 'restaurant_onboarding_documents_pending', docs: { status: 500 }, profile: 'restaurant_profile_account_pending' });
    await expect(page.getByRole('button', { name: /try again/i }).first()).toBeVisible();
    await settled(page, { 1440: `${ONB}Docs-LoadError` });
  });

  test('application not approved is final', async ({ page }) => {
    await open(page, '/onboarding', { status: 'restaurant_onboarding_application_rejected', docs: 'restaurant_document_pack_empty', profile: 'restaurant_profile_account_pending' });
    await expect(page.getByTestId('onboarding-end')).toBeVisible();
    await settled(page, { 1440: `${ONB}App-NotApproved`, 1024: `${ONB}Tab-AppNotApproved-1024` });
  });
});
