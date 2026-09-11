/**
 * Manual verification driver for the customer app's design-system sweep (BottomNav + Icon
 * primitive + Plus Jakarta). Not part of any test suite — run by hand against a built web export
 * served locally and the repo's mock API on :4010:
 *
 *   pnpm mock                                                          # :4010
 *   cd apps/customer && EXPO_PUBLIC_API_BASE_URL=http://localhost:4010 \
 *     npx expo export --platform web --output-dir /tmp/hg-customer-export --clear
 *   (cd /tmp/hg-customer-export && python3 -m http.server 8935 &)
 *   node tools/verify/customer-design-system-sweep.mjs
 *
 * This is react-native-web, not a native device — it proves the component tree, the Icon SVGs
 * and BottomNav's glass/action-button render and the OTP + navigation flows execute end to end.
 * It is NOT the native iOS/Android dev-build render this app's brief says it doesn't have.
 */
import { chromium } from 'playwright';

const OUT = 'tools/verify';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });

await page.goto('http://localhost:8935/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.getByPlaceholder('+1 416 555 0100').fill('+14165550100');
await page.getByRole('button', { name: 'Send code' }).click();
await page.waitForTimeout(1200);
await page.getByPlaceholder('000000').fill('123456');
await page.getByRole('button', { name: 'Verify' }).click();
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/customer-discovery-tabbar.png` });

await page.getByTestId('CustomerTabBar-tab-profile').click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/customer-profile.png` });

await page.getByText('Saved addresses').click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/customer-addresses.png` });

await page.goBack();
await page.waitForTimeout(800);
await page.getByTestId('CustomerTabBar-action-cart').click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/customer-cart.png` });

await browser.close();
