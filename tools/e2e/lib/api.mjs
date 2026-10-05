// A small client for the HalalGoes API, for the parts of a flow that happen off-screen: an order
// placed by a second customer, a lookup of what the apps just did. Same calls the apps make
// (contracts/openapi.yaml); no shortcut around the API.
//
//   node tools/e2e/lib/api.mjs place-order <customer key>    places an order, prints {id, code, state}
//   node tools/e2e/lib/api.mjs order <order id>              the order as the admin sees it
//
// <customer key> is a key under `customers` in world.json (written by tools/e2e/seed/seed.sh).
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { waitForCode } from './otp.mjs';
import { OUT } from './paths.mjs';
import { freshTotp } from './totp.mjs';

export const API = process.env.E2E_API_URL ?? 'http://localhost:8080';

/** world.json: the seeded people and places, and their sign-in details. */
export function world() {
  const p = path.join(OUT, 'world.json');
  if (!existsSync(p)) {
    throw new Error(`world.json not found at ${p}: run tools/e2e/seed/seed.sh first`);
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}

/** A fresh Idempotency-Key (the API wants 16–128 characters). */
const idem = () => randomBytes(16).toString('hex');

/** Calls the API; returns `data` from the envelope, or throws with the API's error code. */
export async function call(method, route, { token, body, client, idempotent } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (client) headers['X-HG-Client'] = client;
  if (idempotent) headers['Idempotency-Key'] = idem();
  const res = await fetch(`${API}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = json.error ?? {};
    throw new Error(`${method} ${route} → ${res.status} ${err.code ?? ''} ${err.message ?? text}`.trim());
  }
  return json.data;
}

/**
 * Phone sign-in, the way the apps do it: ask for a code, read it from the API's log (HG_ENV=local
 * logs it instead of texting it), verify it. `client` is customer-app or rider-app.
 */
export async function signInByPhone(phone, client = 'customer-app') {
  const since = new Date(Date.now() - 2000).toISOString();
  const challenge = await call('POST', '/v1/auth/otp/request', {
    client,
    body: { phone_e164: phone, purpose: 'SIGN_IN', device_id: null },
  });
  const code = await waitForCode(phone, { since });
  const grant = await call('POST', '/v1/auth/otp/verify', {
    client,
    body: { challenge_id: challenge.challenge_id, code, device_id: null },
  });
  return grant.access_token;
}

/** Email and password sign-in; staff also give the TOTP code of the moment. */
export async function signInByEmail(email, password, { totpSecret, client = 'restaurant-web' } = {}) {
  const totp_code = totpSecret ? await freshTotp(totpSecret) : null;
  const grant = await call('POST', '/v1/auth/login', { client, body: { email, password, totp_code } });
  return grant.access_token;
}

/**
 * One delivery order from a seeded customer: the first menu item into a fresh cart, a quote for
 * the customer's seeded address, the order. The API's fake payment client (no Stripe keys,
 * HG_ENV=local) authorises it at once, so it lands in the restaurant's queue (RESTAURANT_PENDING),
 * which then has 180 seconds to accept.
 */
export async function placeOrder(customerKey) {
  const w = world();
  const customer = w.customers[customerKey];
  if (!customer) throw new Error(`no customer "${customerKey}" in world.json`);
  const token = await signInByPhone(customer.phone, 'customer-app');
  await call('DELETE', '/v1/cart', { token, idempotent: true }).catch(() => {});
  const cart = await call('POST', '/v1/cart/lines?replace=true', {
    token,
    idempotent: true,
    body: { menu_item_id: w.restaurant.menuItemId, variant_id: null, addons: [], quantity: 1, special_request: null },
  });
  const quote = await call('POST', '/v1/quotes', {
    token,
    idempotent: true,
    body: {
      cart_id: cart.id,
      delivery_address_id: customer.addressId,
      fulfilment: 'DELIVERY',
      tip_cents: 200,
      promo_code: null,
    },
  });
  const placed = await call('POST', '/v1/orders', {
    token,
    idempotent: true,
    body: {
      quote_id: quote.id,
      payment_method_id: null,
      save_payment_method: false,
      delivery_instructions: [],
      special_instructions: null,
    },
  });
  const { id, code, state } = placed.order;
  return { id, code, state };
}

/** The admin's view of one order (state, dispatch state, timeline). */
export async function adminOrder(orderId) {
  const w = world();
  const token = await signInByEmail(w.admin.email, w.password, { totpSecret: w.admin.totpSecret, client: 'admin-web' });
  return call('GET', `/v1/admin/orders/${orderId}`, { token });
}

async function main([command, arg]) {
  switch (command) {
    case 'place-order':
      return placeOrder(arg);
    case 'order':
      return adminOrder(arg);
    default:
      throw new Error('usage: api.mjs place-order <customer key> | order <order id>');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
    .then((result) => console.log(JSON.stringify(result)))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
