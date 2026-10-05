// Launch-path journey against the staging API.
// Secrets stay in memory. Step records are redacted before they are written.
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { ApiError, Session, pace, sleep } from './lib/client.mjs';
import { apiLogs, findEmailToken, findOtp, remoteStripeEnv } from './lib/logs.mjs';
import { hostOf, redact } from './lib/redact.mjs';
import { freshTotp } from './lib/totp.mjs';
import { padJpeg, tinyPdf, uploadBytes } from './lib/upload.mjs';

const HOME = process.env.HOME || '';
const ADMIN_ENV = `${HOME}/.config/halalgoes/secrets/admin-login.env`;
const STRIPE_ENV = `${HOME}/.config/halalgoes/secrets/test.env`;
const RESTAURANT_PIN = { latitude: 43.6532, longitude: -79.3832, accuracy_m: 10 };
const CUSTOMER_PIN = { latitude: 43.6525, longitude: -79.3817, accuracy_m: 10 };
const HALAL_CHECKS = [
  'H1_LEGIBLE_COMPLETE',
  'H2_ISSUER_ACCEPTED',
  'H3_NAME_MATCH',
  'H4_ADDRESS_MATCH',
  'H6_SCOPE_SUFFICIENT',
];

const args = process.argv.slice(2);
let base = process.env.HG_API || 'https://api.halalgoes.com';
let reportPath = '/tmp/grok-1-steps.md';
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--base') base = args[++i];
  else if (args[i] === '--report') reportPath = args[++i];
}
const jsonPath = '/tmp/grok-1-report.json';

const stamp = `${Date.now().toString(36)}${randomBytes(1).toString('hex')}`;
let restaurantPassword = '';
let stripeKey = '';

const ctx = {
  stamp,
  email: `e2e-${stamp}@halalgoes.test`,
  restaurantPhone: phone('416'),
  riderPhone: phone('437'),
  customerPhone: phone('647'),
  restaurantId: null,
  issuerId: null,
  legalName: `E2E Kitchen ${stamp}`,
  certifiedAddress: '220 Yonge Street, Toronto, ON M5B 2H1',
  itemIds: [],
  versionIds: [],
  menuDeferred: false,
  addressId: null,
  orderId: null,
  orderState: null,
  captured: false,
  assignmentId: null,
  riderAccountId: null,
};

const steps = [];
const blocked = new Set();
const startedAt = new Date().toISOString();

const admin = new Session({ base, surface: 'admin-web' });
const restaurant = new Session({ base, surface: 'restaurant-web' });
const rider = new Session({ base, surface: 'rider-app' });
const customer = new Session({ base, surface: 'customer-app' });

class StepFail extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'StepFail';
    this.code = extra.code || null;
    this.status = extra.status || 0;
    this.method = extra.method || null;
    this.path = extra.path || null;
    this.request = extra.request ?? null;
    this.response = extra.response ?? null;
    this.detail = extra.detail ?? null;
  }
}

function phone(npa) {
  const exchange = 200 + (Date.now() % 800);
  const line = String(randomBytes(2).readUInt16BE(0) % 10000).padStart(4, '0');
  return `+1${npa}${exchange}${line}`;
}

function parseEnv(text) {
  const out = {};
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const raw = trimmed.startsWith('export ') ? trimmed.slice(7) : trimmed;
    const eq = raw.indexOf('=');
    if (eq < 1) continue;
    let value = raw.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[raw.slice(0, eq).trim()] = value;
  }
  return out;
}

function loadEnv(path) {
  return parseEnv(readFileSync(path, 'utf8'));
}

function asList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function stripeMode(key) {
  if (!key) return 'missing';
  if (key.startsWith('sk_test_')) return 'test';
  if (key.startsWith('sk_live_')) return 'live';
  return 'unrecognized';
}

function hintFor(id, err) {
  const code = err.code || '';
  if (id === 'restaurant-email-verify' || code === 'EMAIL_NOT_VERIFIED') {
    return 'If the verification token is absent from the log, registration only records that mail was enqueued (services/hg/internal/auth/service_flows.go:489). Resend discards the token (services/hg/internal/auth/service_flows.go:542). The registration response has no token (services/hg/internal/auth/handlers.go:369) and verify returns no session (services/hg/internal/auth/handlers.go:408). Staging can echo the token the way a phone code is echoed, or it can send the mail. Production should keep verifying the address.';
  }
  if (id === 'rider-otp' || id === 'customer-otp' || code === 'OTP_NOT_IN_LOG') {
    return 'If the log line masks the phone and omits the code, staging is not echoing the sign-in code (services/hg/internal/auth/sms.go:34). The log line is services/hg/internal/auth/sms.go:39. Staging has to log the phone and the code. Production stays silent.';
  }
  if (id === 'seal-bind' || code === 'SEAL_NOT_FOUND') {
    return 'Binding a seal needs a code that was already issued, and no API issues one (services/hg/internal/handoff/store.go:218). Add a restaurant call that issues seal codes, or issue a batch when the restaurant goes live.';
  }
  if (code === 'TAX_PROFILE_MISSING') {
    return 'The quote has no tax rate for this province (services/hg/internal/orders/pricing/tax.go:211).';
  }
  if (code === 'CHECK_NOT_OVERRIDABLE') {
    return 'The date check and the reuse check are computed by the server. Sending a result for them returns CHECK_NOT_OVERRIDABLE.';
  }
  if (code === 'ORDER_STATE_TIMEOUT') {
    return 'If the order stays in CREATED after the card is confirmed, the payment webhook has not been applied (services/hg/internal/payments/webhook_worker.go:175).';
  }
  if (code === 'PAYOUT_ACCOUNT_INCOMPLETE' || id === 'rider-online') {
    return 'Payouts stay off until a person finishes the Stripe-hosted form. charges_enabled stays false by design. That is a human step when the API returned the onboarding link.';
  }
  if (id === 'issuing-body' || code === 'ISSUER_NOT_ACCEPTED') {
    return 'Only an accepted issuing body satisfies the issuer check. Promoting a body is limited to a super-admin, so a super-admin has to accept one.';
  }
  if (id === 'customer-receipt') {
    return 'The receipt read can be empty when the snapshot row was never written. A completed order has to write that snapshot.';
  }
  if (code === 'STEP_NOT_AVAILABLE' && id.startsWith('connect')) {
    return 'Creating a Connect account before the partner is approved returns STEP_NOT_AVAILABLE by design.';
  }
  return null;
}

function failRecord(id, title, err, ms) {
  const api = err instanceof ApiError || err instanceof StepFail;
  return {
    id,
    title,
    status: 'fail',
    ms,
    method: api ? err.method || null : null,
    path: api ? err.path || null : null,
    http_status: api ? err.status || null : null,
    error_code: err.code || null,
    message: redact(err.message || 'failed'),
    request: redact(err.request ?? null),
    response: redact(err.response ?? null),
    detail: redact(err.detail ?? err.details ?? null),
    hint: hintFor(id, err),
  };
}

async function step(id, title, fn, opts = {}) {
  const needs = opts.needs || [];
  const provides = opts.provides ? [].concat(opts.provides) : [];
  const missing = needs.filter((key) => blocked.has(key));
  if (missing.length) {
    const detail = opts.onBlocked ? opts.onBlocked(missing) : { blocked_by: missing };
    steps.push({ id, title, status: 'blocked', blocked_by: missing, detail: redact(detail) });
    for (const key of provides) blocked.add(key);
    console.log(`blocked ${id}`);
    return;
  }
  const started = Date.now();
  try {
    const detail = await fn();
    steps.push({ id, title, status: 'pass', ms: Date.now() - started, detail: redact(detail ?? null) });
    console.log(`pass ${id}`);
  } catch (err) {
    steps.push(failRecord(id, title, err, Date.now() - started));
    for (const key of provides) blocked.add(key);
    console.log(`fail ${id}${err.code ? ` ${err.code}` : ''}`);
  }
}

async function loadStripeKey() {
  try {
    const env = loadEnv(STRIPE_ENV);
    const named = env.STRIPE_SECRET_KEY || env.STRIPE_API_KEY || env.STRIPE_SECRET;
    if (named) return named;
    const found = Object.values(env).find((value) => typeof value === 'string' && value.startsWith('sk_'));
    if (found) return found;
  } catch {
    // The server env file is the fallback.
  }
  try {
    const text = await remoteStripeEnv();
    const env = parseEnv(text);
    return env.STRIPE_SECRET_KEY || env.STRIPE_API_KEY || env.STRIPE_SECRET || '';
  } catch {
    return '';
  }
}

async function waitForOtp(target) {
  const deadline = Date.now() + 35_000;
  let widened = false;
  let last = { code: null, summary: {} };
  while (Date.now() < deadline) {
    const text = await apiLogs(widened ? '10m' : '2m');
    last = findOtp(text, target);
    if (last.code) return last;
    if (!widened && last.summary?.marker_lines === 0) {
      widened = true;
      continue;
    }
    await sleep(2000);
  }
  throw new StepFail('sign-in code was not in the API log', { code: 'OTP_NOT_IN_LOG', detail: last.summary });
}

async function otpSignup(session, target) {
  const requested = await session.call('POST', '/v1/auth/otp/request', {
    auth: false,
    body: { phone_e164: target, purpose: 'SIGN_IN' },
    expect: [200],
  });
  const challengeId = requested.data?.challenge_id;
  if (!challengeId) throw new StepFail('OTP challenge id was missing', { detail: { status: requested.status } });
  const found = await waitForOtp(target);
  const verified = await session.call('POST', '/v1/auth/otp/verify', {
    auth: false,
    body: { challenge_id: challengeId, code: found.code },
    expect: [200],
  });
  session.absorb(verified.data);
  return {
    account_id: verified.data?.principal?.account_id || null,
    is_new_account: verified.data?.is_new_account ?? null,
    log: found.summary,
  };
}

async function confirmPayment(clientSecret) {
  if (!stripeKey) throw new StepFail('stripe secret key is missing', { code: 'STRIPE_KEY_MISSING' });
  const id = String(clientSecret || '').split('_secret_')[0];
  if (!id.startsWith('pi_')) {
    throw new StepFail('payment intent id was not present', { detail: { client_secret_present: Boolean(clientSecret) } });
  }
  await pace();
  const res = await fetch(`https://api.stripe.com/v1/payment_intents/${id}/confirm`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ payment_method: 'pm_card_visa' }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => null);
  const tail = id.slice(-6);
  if (!res.ok) {
    throw new StepFail('stripe confirm failed', {
      code: json?.error?.code || 'STRIPE_CONFIRM_FAILED',
      status: res.status,
      detail: { pi_tail: tail, stripe_message: json?.error?.message || null },
    });
  }
  return { pi_tail: tail, stripe_status: json?.status || null };
}

async function watchOrder(orderId, done, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = {};
  while (Date.now() < deadline) {
    const order = await customer.call('GET', `/v1/orders/${orderId}`);
    const pay = await customer.call('GET', `/v1/orders/${orderId}/payment`);
    last = {
      order_state: order.data?.state || null,
      payment_state: pay.data?.state || null,
      amount_authorized_cents: pay.data?.amount_authorized_cents ?? null,
      amount_captured_cents: pay.data?.amount_captured_cents ?? null,
      amount_refunded_cents: pay.data?.amount_refunded_cents ?? null,
    };
    if (orderId === ctx.orderId) ctx.orderState = last.order_state;
    if (done(last)) return last;
    await sleep(3000);
  }
  throw new StepFail('timed out waiting for the order', { code: 'ORDER_STATE_TIMEOUT', detail: last });
}

function paymentVoided(row) {
  return (row.payment_state === 'CANCELED' || row.payment_state === 'CANCELLED') && row.amount_captured_cents === 0;
}

async function placeOrder() {
  if (!ctx.itemIds.length || !ctx.addressId) {
    throw new StepFail('cart inputs are missing', { detail: { items: ctx.itemIds.length, address: Boolean(ctx.addressId) } });
  }
  const first = await customer.call('POST', '/v1/cart/lines', {
    query: { replace: true },
    body: {
      menu_item_id: ctx.itemIds[0],
      variant_id: null,
      addons: [],
      quantity: 1,
      special_request: 'E2E no onions',
    },
    expect: [200],
  });
  if (ctx.itemIds[1]) {
    await customer.call('POST', '/v1/cart/lines', {
      body: { menu_item_id: ctx.itemIds[1], variant_id: null, addons: [], quantity: 1 },
      expect: [200],
    });
  }
  const quote = await customer.call('POST', '/v1/quotes', {
    body: {
      cart_id: first.data?.id,
      delivery_address_id: ctx.addressId,
      fulfilment: 'DELIVERY',
      tip_cents: 200,
      promo_code: null,
      scheduled_for: null,
    },
    expect: [201],
  });
  const total = quote.data?.total_cents;
  if (!Number.isInteger(total) || total <= 0) {
    throw new StepFail('quote total was not a positive integer number of cents', { detail: { total_cents: total ?? null } });
  }
  const created = await customer.call('POST', '/v1/orders', {
    body: {
      quote_id: quote.data.id,
      save_payment_method: false,
      delivery_instructions: ['LEAVE_AT_DOOR'],
      special_instructions: 'E2E leave at the door',
    },
    expect: [201],
  });
  const orderId = created.data?.order?.id;
  let secret = created.data?.client_secret;
  if (!secret && orderId) {
    const pay = await customer.call('GET', `/v1/orders/${orderId}/payment`);
    secret = pay.data?.client_secret;
  }
  const stripe = await confirmPayment(secret);
  const settled = await watchOrder(orderId, (row) => row.order_state === 'RESTAURANT_PENDING', 90_000);
  return { order_id: orderId, total_cents: total, ...stripe, ...settled };
}

async function createMenu() {
  const category = await restaurant.call('POST', '/v1/restaurant/menu/categories', {
    body: { name: 'E2E Mains', sort_order: 1 },
    expect: [201, 409],
  });
  if (category.status === 409) {
    if (category.error?.code === 'STEP_NOT_AVAILABLE') return { deferred: true, code: category.error.code };
    throw new StepFail('menu category was rejected', {
      code: category.error?.code,
      status: 409,
      detail: category.error,
    });
  }
  const items = [
    { name: 'E2E Lentil soup', price_cents: 1299, description: 'E2E lentil soup for the staging journey.' },
    { name: 'E2E Rice plate', price_cents: 1899, description: 'E2E rice plate for the staging journey.' },
  ];
  const itemIds = [];
  const versionIds = [];
  for (const item of items) {
    const created = await restaurant.call('POST', '/v1/restaurant/menu/items', {
      body: {
        category_id: category.data.id,
        name: item.name,
        price_cents: item.price_cents,
        description: item.description,
        allergens_declared: true,
        allergen_tags: [],
      },
      expect: [201, 409],
    });
    if (created.status === 409) {
      if (created.error?.code === 'STEP_NOT_AVAILABLE') return { deferred: true, code: created.error.code };
      throw new StepFail('menu item was rejected', { code: created.error?.code, status: 409, detail: created.error });
    }
    itemIds.push(created.data.id);
    if (created.data?.pending_version?.id) versionIds.push(created.data.pending_version.id);
  }
  ctx.itemIds = itemIds;
  ctx.versionIds = versionIds;
  ctx.menuDeferred = false;
  return { deferred: false, category_id: category.data.id, item_ids: itemIds, version_ids: versionIds };
}

async function connectAccount(session) {
  const created = await session.call('POST', '/v1/connect/account', { expect: [201, 409] });
  if (created.status === 409) {
    return { conflict: created.error?.code || 'conflict', onboarding_host: null };
  }
  const link = await session.call('POST', '/v1/connect/onboarding-link', { expect: [201] });
  const status = await session.call('GET', '/v1/connect/status');
  return {
    conflict: null,
    charges_enabled: status.data?.charges_enabled ?? null,
    payouts_enabled: status.data?.payouts_enabled ?? null,
    details_submitted: status.data?.details_submitted ?? null,
    onboarding_host: hostOf(link.data?.url),
    human_step: status.data?.payouts_enabled
      ? null
      : 'A person must finish the Stripe-hosted form before payouts turn on.',
  };
}

async function approveDocuments(docs, pathFor) {
  const reviewed = [];
  for (const doc of docs) {
    if (doc.state !== 'SUBMITTED' && doc.state !== 'IN_REVIEW') {
      reviewed.push({ id: doc.id, doc_type: doc.doc_type, state: doc.state, skipped: true });
      continue;
    }
    const res = await admin.call('POST', pathFor(doc.id), { body: { decision: 'APPROVE' }, expect: [200] });
    reviewed.push({ id: doc.id, doc_type: doc.doc_type, state: res.data?.state || 'APPROVED' });
  }
  return reviewed;
}

async function transition(assignmentId, toState, point) {
  const body = { to_state: toState, occurred_at: new Date().toISOString(), ...point };
  try {
    return await rider.call('POST', `/v1/riders/me/assignments/${assignmentId}/transitions`, { body, expect: [200] });
  } catch (err) {
    const blob = `${err.code || ''} ${err.message || ''}`.toLowerCase();
    if (err.code === 'GEOFENCE_REQUIRED' || blob.includes('geofence') || blob.includes('too far') || blob.includes('outside')) {
      body.override_reason = 'E2E staging journey GPS is a fixed test pin';
      return rider.call('POST', `/v1/riders/me/assignments/${assignmentId}/transitions`, { body, expect: [200] });
    }
    throw err;
  }
}

async function proveDelivery(assignmentId, orderId) {
  const photo = await uploadBytes(rider, {
    purpose: 'POD',
    contentType: 'image/jpeg',
    bytes: padJpeg(),
    orderId,
  });
  await rider.call('POST', `/v1/riders/me/assignments/${assignmentId}/proof-of-delivery`, {
    body: { method: 'PHOTO', handover_method: 'LEFT_AT_DOOR', photo_object_id: photo.id },
    expect: [200],
  });
  return photo.host;
}

function clip(value) {
  const text = JSON.stringify(value, null, 2);
  if (!text) return 'null';
  return text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text;
}

function writeReports(fatal) {
  const counts = { pass: 0, fail: 0, blocked: 0 };
  for (const row of steps) counts[row.status] = (counts[row.status] || 0) + 1;
  const lines = [
    '# API journey',
    '',
    `- started: ${startedAt}`,
    `- finished: ${new Date().toISOString()}`,
    `- base: ${base}`,
    `- stripe key mode: ${stripeMode(stripeKey)}`,
    `- pass: ${counts.pass || 0}`,
    `- fail: ${counts.fail || 0}`,
    `- blocked: ${counts.blocked || 0}`,
    '',
  ];
  if (fatal) lines.push(`Runner stopped: ${redact(fatal)}`, '');
  lines.push('| Step | Status | HTTP | Code |', '| --- | --- | --- | --- |');
  for (const row of steps) {
    lines.push(`| ${row.id} | ${row.status} | ${row.http_status ?? ''} | ${row.error_code ?? ''} |`);
  }
  lines.push('', '## Steps', '');
  for (const row of steps) {
    lines.push(`### ${row.status} ${row.id}`, '', row.title, '');
    if (row.message) lines.push(`Message: ${row.message}`, '');
    if (row.method) lines.push(`Request: ${row.method} ${row.path}`, '');
    if (row.hint) lines.push(`Likely cause: ${row.hint}`, '');
    lines.push('```json', clip(redact({
      http_status: row.http_status ?? null,
      error_code: row.error_code ?? null,
      blocked_by: row.blocked_by ?? null,
      request: row.request ?? null,
      response: row.response ?? null,
      detail: row.detail ?? null,
    })), '```', '');
  }
  writeFileSync(reportPath, lines.join('\n'));
  writeFileSync(jsonPath, JSON.stringify(redact({
    started: startedAt,
    finished: new Date().toISOString(),
    base,
    stripe_key_mode: stripeMode(stripeKey),
    fatal: fatal ? redact(fatal) : null,
    steps,
  }), null, 2));
}

async function run() {
  stripeKey = await loadStripeKey();
  const mode = stripeMode(stripeKey);
  if (mode === 'live' || mode === 'unrecognized') {
    console.log(`stripe key mode: ${mode}; refusing to run`);
    writeReports(`stripe key mode: ${mode}; refusing to run`);
    process.exit(2);
  }
  console.log(`stripe key mode: ${mode}`);
  restaurantPassword = `E2e-${randomBytes(18).toString('base64url')}!9a`;

  await step('admin-sign-in', 'Admin signs in with email, password, and a one-time code', async () => {
    const env = loadEnv(ADMIN_ENV);
    if (!env.SEED_EMAIL || !env.SEED_PASSWORD || !env.TOTP_SECRET) {
      throw new StepFail('admin login file is missing a required value', { code: 'ADMIN_ENV_MISSING' });
    }
    const bodyFor = async () => ({
      email: env.SEED_EMAIL,
      password: env.SEED_PASSWORD,
      totp_code: await freshTotp(env.TOTP_SECRET),
    });
    let res = await admin.call('POST', '/v1/auth/login', {
      auth: false,
      body: await bodyFor(),
      expect: [200, 401, 429],
    });
    if (res.status === 429) throw new StepFail('admin login is rate limited', { status: 429, code: 'RATE_LIMITED' });
    if (res.status === 401) {
      const left = 30 - (Math.floor(Date.now() / 1000) % 30);
      await sleep((left + 1) * 1000);
      res = await admin.call('POST', '/v1/auth/login', { auth: false, body: await bodyFor(), expect: [200] });
    }
    admin.absorb(res.data);
    return {
      account_id: res.data?.principal?.account_id || null,
      roles: (res.data?.principal?.roles || []).map((role) => role.role),
    };
  }, { provides: 'admin' });

  await step('issuing-body', 'Admin finds or proposes an accepted halal issuing body', async () => {
    const list = await admin.call('GET', '/v1/admin/halal-issuing-bodies', { query: { status: 'ACCEPTED', limit: 50 } });
    const bodies = asList(list.data);
    const chosen = bodies.find((body) => body.requires_issuer_confirmation === false) || bodies[0];
    if (chosen) {
      ctx.issuerId = chosen.id;
      return { source: 'existing', id: chosen.id, requires_issuer_confirmation: chosen.requires_issuer_confirmation ?? null };
    }
    const proposed = await admin.call('POST', '/v1/admin/halal-issuing-bodies', {
      body: {
        name: `E2E Halal Registry ${stamp}`,
        justification: 'E2E staging journey needs one accepted issuing body so the certificate checks can be recorded.',
        country: 'CA',
        region: 'ON',
      },
      expect: [201],
    });
    const id = proposed.data?.id;
    try {
      await admin.call('POST', `/v1/admin/halal-issuing-bodies/${id}/status`, {
        body: {
          status: 'ACCEPTED',
          justification: 'E2E staging journey accepts this body so the certificate review can proceed.',
          requires_issuer_confirmation: false,
        },
        expect: [200],
      });
    } catch (err) {
      if (err.status === 403) {
        throw new StepFail('issuing body was proposed and a super-admin still has to accept it', {
          code: 'ISSUER_NOT_ACCEPTED',
          status: 403,
          detail: { body_id: id },
        });
      }
      throw err;
    }
    ctx.issuerId = id;
    return { source: 'created', id };
  }, { needs: ['admin'] });

  await step('restaurant-register', 'Partner registers with email', async () => {
    const config = await restaurant.call('GET', '/v1/config/public', { auth: false });
    let terms = config.data?.terms_version || '2026-01';
    const body = {
      business_name: ctx.legalName,
      email: ctx.email,
      password: restaurantPassword,
      terms_version: terms,
    };
    let res = await restaurant.call('POST', '/v1/auth/register/restaurant', {
      auth: false,
      body,
      expect: [201, 409],
    });
    if (res.status === 409) {
      if (res.error?.code !== 'TERMS_VERSION_STALE' || !res.error?.details?.current) {
        throw new StepFail('restaurant register was rejected', { status: 409, code: res.error?.code, detail: res.error });
      }
      terms = res.error.details.current;
      body.terms_version = terms;
      res = await restaurant.call('POST', '/v1/auth/register/restaurant', { auth: false, body, expect: [201] });
    }
    ctx.restaurantId = res.data?.restaurant_id || null;
    return { restaurant_id: ctx.restaurantId, onboarding_state: res.data?.onboarding_state || null, terms_version: terms };
  }, { provides: 'registered' });

  await step('restaurant-email-verify', 'Partner verifies email, or the gap is recorded', async () => {
    const first = await findEmailToken(await apiLogs('5m'), ctx.email);
    let resendCode = null;
    try {
      await restaurant.call('POST', '/v1/auth/email/resend', {
        auth: false,
        body: { email: ctx.email },
        expect: [202],
      });
    } catch (err) {
      resendCode = err.code || null;
    }
    await sleep(2000);
    const second = await findEmailToken(await apiLogs('5m'), ctx.email);
    const token = second.token || first.token;
    const log = {
      first: first.summary,
      resend_code: resendCode,
      second: second.summary,
      token_length: token ? token.length : 0,
    };
    if (token) {
      const verified = await restaurant.call('POST', '/v1/auth/email/verify', {
        auth: false,
        body: { token },
        expect: [200, 204],
      });
      if (verified.status === 200 && verified.data?.access_token) {
        restaurant.absorb(verified.data);
        return {
          verified: true,
          via: 'verify',
          account_id: verified.data?.principal?.account_id || null,
          log,
        };
      }
      const after = await restaurant.call('POST', '/v1/auth/login', {
        auth: false,
        body: { email: ctx.email, password: restaurantPassword },
        expect: [200, 401],
      });
      if (after.status === 200 && after.data?.access_token) {
        restaurant.absorb(after.data);
        return {
          verified: true,
          via: 'verify-then-login',
          account_id: after.data?.principal?.account_id || null,
          log,
        };
      }
      throw new StepFail('email was verified but sign-in did not issue a session', {
        code: 'EMAIL_VERIFIED_NO_SESSION',
        status: after.status,
        detail: { log, verify_status: verified.status },
      });
    }
    const login = await restaurant.call('POST', '/v1/auth/login', {
      auth: false,
      body: { email: ctx.email, password: restaurantPassword },
      expect: [200, 401],
    });
    if (login.status === 200 && login.data?.access_token) {
      restaurant.absorb(login.data);
      return { verified: true, via: 'login', account_id: login.data?.principal?.account_id || null, log };
    }
    throw new StepFail('email verification token was not available', {
      code: 'EMAIL_NOT_VERIFIED',
      status: login.status,
      detail: {
        log,
        email_verification_required: login.error?.details?.email_verification_required ?? null,
      },
    });
  }, { needs: ['registered'], provides: 'restaurant' });

  await step('restaurant-profile', 'Partner saves a Toronto profile', async () => {
    const res = await restaurant.call('PUT', '/v1/restaurant/profile', {
      body: {
        display_name: ctx.legalName,
        legal_name: ctx.legalName,
        phone_e164: ctx.restaurantPhone,
        description: 'E2E journey kitchen for the staging API test.',
        line1: '220 Yonge Street',
        city: 'Toronto',
        province: 'ON',
        postal_code: 'M5B 2H1',
        avg_prep_minutes: 20,
        latitude: RESTAURANT_PIN.latitude,
        longitude: RESTAURANT_PIN.longitude,
        cuisine_ids: [],
        timezone: 'America/Toronto',
        owner_first_name: 'E2E',
        owner_last_name: 'Owner',
      },
      expect: [200],
    });
    const address = res.data?.address;
    ctx.legalName = res.data?.legal_name || ctx.legalName;
    if (address?.line1) ctx.certifiedAddress = `${address.line1}, ${address.city}, ${address.province} ${address.postal_code}`;
    return { onboarding_state: res.data?.onboarding_state || null, account_state: res.data?.account_state || null };
  }, { needs: ['restaurant'] });

  await step('restaurant-hours', 'Partner opens all week', async () => {
    const build = (closes) => [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      day_of_week: day,
      opens_at: '00:00',
      closes_at: closes,
    }));
    try {
      const res = await restaurant.call('PUT', '/v1/restaurant/hours', {
        body: { intervals: build('23:59'), overrides: [] },
        expect: [200],
      });
      return { closes_at: '23:59', timezone: res.data?.timezone || null };
    } catch (err) {
      if (err.status !== 422) throw err;
      const res = await restaurant.call('PUT', '/v1/restaurant/hours', {
        body: { intervals: build('23:45'), overrides: [] },
        expect: [200],
      });
      return { closes_at: '23:45', timezone: res.data?.timezone || null };
    }
  }, { needs: ['restaurant'] });

  await step('restaurant-documents', 'Partner uploads the document pack and submits it', async () => {
    if (!ctx.issuerId) throw new StepFail('no accepted issuing body is available', { code: 'ISSUER_NOT_ACCEPTED' });
    const pdf = tinyPdf();
    const specs = [
      { doc_type: 'BUSINESS_LICENCE' },
      {
        doc_type: 'HALAL_CERTIFICATE',
        valid_until: '2027-12-31',
        issued_on: '2026-01-15',
        certificate_number: `E2E-${stamp}`,
        issuer_body_id: ctx.issuerId,
      },
      { doc_type: 'FOOD_SAFETY', valid_until: '2027-12-31', issued_on: '2026-01-15' },
      { doc_type: 'OWNER_ID', valid_until: '2027-12-31', issued_on: '2026-01-15' },
    ];
    const attached = [];
    for (const spec of specs) {
      const uploaded = await uploadBytes(restaurant, { purpose: 'KYC_DOCUMENT', contentType: 'application/pdf', bytes: pdf });
      const body = { doc_type: spec.doc_type, stored_object_id: uploaded.id };
      if (spec.valid_until) body.valid_until = spec.valid_until;
      if (spec.issued_on) body.issued_on = spec.issued_on;
      if (spec.certificate_number) body.certificate_number = spec.certificate_number;
      if (spec.issuer_body_id) body.issuer_body_id = spec.issuer_body_id;
      const doc = await restaurant.call('POST', '/v1/restaurant/documents', { body, expect: [201] });
      attached.push({ doc_type: spec.doc_type, id: doc.data?.id || null, state: doc.data?.state || null, host: uploaded.host });
    }
    const submitted = await restaurant.call('POST', '/v1/restaurant/documents/submit', { expect: [200] });
    return { documents: attached, onboarding_state: submitted.data?.onboarding_state || null };
  }, { needs: ['restaurant'], provides: 'docs' });

  await step('menu-create', 'Partner creates a category and two items', async () => {
    const created = await createMenu();
    ctx.menuDeferred = Boolean(created.deferred);
    return created;
  }, { needs: ['restaurant'], provides: 'menu' });

  await step('connect-before-approval', 'Partner asks for Connect before approval', async () => {
    const result = await connectAccount(restaurant);
    if (result.conflict && result.conflict !== 'STEP_NOT_AVAILABLE') {
      throw new StepFail('Connect before approval failed unexpectedly', { code: result.conflict, detail: result });
    }
    return { ...result, expected: Boolean(result.conflict) };
  }, { needs: ['restaurant'] });

  await step('admin-approve-documents', 'Admin approves the partner documents', async () => {
    const application = await admin.call('GET', `/v1/admin/restaurant-applications/${ctx.restaurantId}`);
    const reviewed = await approveDocuments(
      application.data?.documents || [],
      (id) => `/v1/admin/restaurant-documents/${id}/review`,
    );
    return { reviewed, blockers: application.data?.blockers || [] };
  }, { needs: ['admin', 'restaurant', 'docs'] });

  await step('halal-transcribe-approve', 'Admin transcribes and approves the halal certificate', async () => {
    const application = await admin.call('GET', `/v1/admin/restaurant-applications/${ctx.restaurantId}`);
    const certificateId = application.data?.halal_certificate?.id;
    if (!certificateId) {
      throw new StepFail('application has no halal certificate', {
        detail: { blockers: application.data?.blockers || [] },
      });
    }
    await admin.call('PUT', `/v1/admin/halal-certificates/${certificateId}/transcription`, {
      body: {
        certificate_number: `E2E-${stamp}`,
        certified_address: ctx.certifiedAddress,
        certified_legal_name: ctx.legalName,
        expires_on: '2027-12-31',
        issued_on: '2026-01-15',
        issuing_body_id: ctx.issuerId,
        scope: 'WHOLE_ESTABLISHMENT',
      },
      expect: [200],
    });
    await admin.call('PUT', `/v1/admin/halal-certificates/${certificateId}/checks`, {
      body: { checks: HALAL_CHECKS.map((checkKey) => ({ check_key: checkKey, result: 'PASS' })) },
      expect: [200],
    });
    const cert = await admin.call('GET', `/v1/admin/halal-certificates/${certificateId}`);
    const checks = cert.data?.checks || [];
    const failed = checks.filter((check) => check.result !== 'PASS').map((check) => ({
      check_key: check.check_key,
      result: check.result,
    }));
    if (failed.length || checks.length < 7) {
      throw new StepFail('halal checks are not all passing', { detail: { failed, count: checks.length } });
    }
    await admin.call('POST', `/v1/admin/halal-certificates/${certificateId}/decision`, {
      body: { decision: 'APPROVE' },
      expect: [200],
    });
    return { certificate_id: certificateId, checks: checks.length };
  }, { needs: ['admin', 'restaurant', 'docs'] });

  await step('admin-approve-application', 'Admin approves the partner application', async () => {
    const before = await admin.call('GET', `/v1/admin/restaurant-applications/${ctx.restaurantId}`);
    const res = await admin.call('POST', `/v1/admin/restaurant-applications/${ctx.restaurantId}/decision`, {
      body: {
        decision: 'APPROVE',
        reason_code: 'ALL_CHECKS_PASSED',
        reason_text: 'E2E staging journey approved the application.',
      },
      expect: [200],
    });
    return {
      blockers_before: before.data?.blockers || [],
      onboarding_state: res.data?.onboarding_state || before.data?.onboarding_state || null,
    };
  }, { needs: ['admin', 'restaurant', 'docs'] });

  await step('menu-finish', 'Admin approves the menu versions', async () => {
    if (ctx.menuDeferred || ctx.itemIds.length === 0) {
      const created = await createMenu();
      if (created.deferred) {
        throw new StepFail('menu is still not available at this onboarding step', { code: created.code || 'STEP_NOT_AVAILABLE' });
      }
    }
    if (ctx.versionIds.length === 0) {
      const queue = await admin.call('GET', '/v1/admin/menu-reviews', {
        query: { restaurant_id: ctx.restaurantId, limit: 50 },
      });
      ctx.versionIds = asList(queue.data).map((version) => version.id);
    }
    for (const versionId of ctx.versionIds) {
      await admin.call('POST', `/v1/admin/menu-reviews/${versionId}/decision`, {
        body: { decision: 'APPROVE' },
        expect: [200],
      });
    }
    return { version_ids: ctx.versionIds, item_ids: ctx.itemIds };
  }, { needs: ['restaurant', 'admin', 'menu'], provides: 'menu' });

  await step('connect-after-approval', 'Partner opens Stripe Connect in test mode', async () => {
    const result = await connectAccount(restaurant);
    if (result.conflict) {
      throw new StepFail('Connect account was not created after approval', { code: result.conflict, detail: result });
    }
    return result;
  }, { needs: ['restaurant'] });

  await step('restaurant-live', 'Partner heartbeats and the live state is read', async () => {
    const beat = await restaurant.call('POST', '/v1/restaurant/heartbeat', { expect: [200] });
    const availability = await restaurant.call('PATCH', '/v1/restaurant/availability', {
      body: { is_accepting_orders: true },
      expect: [200],
    });
    const status = await restaurant.call('GET', '/v1/restaurant/onboarding/status');
    const detail = {
      onboarding_state: status.data?.onboarding_state || null,
      account_state: status.data?.account_state || null,
      blocking_reason: status.data?.blocking_reason || null,
      current_step: status.data?.current_step || null,
      steps_completed: status.data?.steps_completed || null,
      open_state: beat.data?.open_state || null,
      is_accepting_orders: availability.data?.is_accepting_orders ?? null,
    };
    if (detail.onboarding_state !== 'ACTIVE' || detail.account_state !== 'LIVE') {
      throw new StepFail('restaurant is not active and live', { detail });
    }
    return detail;
  }, { needs: ['restaurant'], provides: 'restaurant-live' });

  await step('rider-otp', 'Rider signs up by phone', async () => {
    const signed = await otpSignup(rider, ctx.riderPhone);
    ctx.riderAccountId = signed.account_id;
    return signed;
  }, { provides: 'rider' });

  await step('rider-profile', 'Rider saves a profile', async () => {
    const res = await rider.call('POST', '/v1/riders/me/onboarding/profile', {
      body: { first_name: 'E2E', last_name: 'Rider', date_of_birth: '1995-04-12', timezone: 'America/Toronto' },
    });
    return { onboarding_state: res.data?.onboarding_state || null };
  }, { needs: ['rider'] });

  await step('rider-vehicle', 'Rider selects a bicycle', async () => {
    const res = await rider.call('POST', '/v1/riders/me/onboarding/vehicle', { body: { vehicle_type: 'BICYCLE' } });
    return { onboarding_state: res.data?.onboarding_state || res.data?.vehicle_type || null };
  }, { needs: ['rider'] });

  await step('rider-documents', 'Rider uploads an ID and a photo', async () => {
    const idFile = await uploadBytes(rider, { purpose: 'KYC_DOCUMENT', contentType: 'application/pdf', bytes: tinyPdf() });
    await rider.call('POST', '/v1/riders/me/documents', {
      body: { doc_type: 'GOVERNMENT_ID', stored_object_id: idFile.id, expires_on: '2027-12-31' },
      expect: [201],
    });
    const photo = await uploadBytes(rider, { purpose: 'KYC_DOCUMENT', contentType: 'image/jpeg', bytes: padJpeg() });
    await rider.call('POST', '/v1/riders/me/documents', {
      body: { doc_type: 'PROFILE_PHOTO', stored_object_id: photo.id },
      expect: [201],
    });
    const submitted = await rider.call('POST', '/v1/riders/me/onboarding/documents', { expect: [200] });
    return { onboarding_state: submitted.data?.onboarding_state || null, upload_host: photo.host };
  }, { needs: ['rider'], provides: 'rider-docs' });

  await step('admin-approve-rider', 'Admin approves the rider', async () => {
    const application = await admin.call('GET', `/v1/admin/rider-applications/${ctx.riderAccountId}`);
    const reviewed = await approveDocuments(
      application.data?.documents || [],
      (id) => `/v1/admin/rider-documents/${id}/review`,
    );
    const decision = await admin.call('POST', `/v1/admin/rider-applications/${ctx.riderAccountId}/decision`, {
      body: {
        decision: 'APPROVE',
        reason_code: 'ALL_CHECKS_PASSED',
        reason_text: 'E2E staging journey approved the rider.',
      },
      expect: [200],
    });
    return {
      reviewed,
      blockers: application.data?.blockers || [],
      onboarding_state: decision.data?.onboarding_state || null,
    };
  }, { needs: ['admin', 'rider', 'rider-docs'] });

  await step('rider-connect', 'Rider opens Stripe Connect in test mode', async () => {
    const result = await connectAccount(rider);
    if (result.conflict) throw new StepFail('rider Connect account was not created', { code: result.conflict, detail: result });
    return result;
  }, { needs: ['rider'] });

  await step('rider-online', 'Rider goes online beside the restaurant', async () => {
    const availability = await rider.call('PUT', '/v1/riders/me/availability', {
      body: { is_online: true, ...RESTAURANT_PIN },
      expect: [200],
    });
    await rider.call('POST', '/v1/riders/me/positions', {
      body: { points: [{ ...RESTAURANT_PIN, recorded_at: new Date().toISOString() }] },
      expect: [200, 202],
    });
    const state = availability.data || {};
    if (state.availability_state !== 'ONLINE_IDLE' || state.can_receive_offers !== true) {
      const reasons = state.blocking_reasons || [];
      throw new StepFail('rider cannot receive offers', {
        code: reasons[0] || 'RIDER_NOT_ONLINE',
        detail: { availability_state: state.availability_state || null, blocking_reasons: reasons },
      });
    }
    return { availability_state: state.availability_state, can_receive_offers: true };
  }, { needs: ['rider'], provides: 'rider-online' });

  await step('customer-otp', 'Customer signs up by phone', async () => {
    return otpSignup(customer, ctx.customerPhone);
  }, { provides: 'customer' });

  await step('customer-profile', 'Customer saves a name', async () => {
    const res = await customer.call('PATCH', '/v1/me/profile', { body: { first_name: 'E2E', last_name: 'Guest' } });
    return { first_name: res.data?.first_name || 'E2E' };
  }, { needs: ['customer'] });

  await step('customer-address', 'Customer adds an address near the restaurant', async () => {
    const res = await customer.call('POST', '/v1/addresses', {
      body: {
        label: 'E2E Home',
        is_default: true,
        line1: '100 Queen St W',
        city: 'Toronto',
        province: 'ON',
        postal_code: 'M5H 2N2',
        latitude: CUSTOMER_PIN.latitude,
        longitude: CUSTOMER_PIN.longitude,
      },
      expect: [201],
    });
    ctx.addressId = res.data?.id || null;
    return { address_id: ctx.addressId };
  }, { needs: ['customer'], provides: 'address' });

  await step('customer-browse', 'Customer opens the feed', async () => {
    const feed = await customer.call('GET', '/v1/feed');
    return { feed_count: asList(feed.data?.restaurants || feed.data).length };
  }, { needs: ['customer'] });

  await step('customer-menu', 'Customer opens this restaurant and its menu', async () => {
    const list = await customer.call('GET', '/v1/restaurants', {
      query: {
        latitude: CUSTOMER_PIN.latitude,
        longitude: CUSTOMER_PIN.longitude,
        max_distance_m: 5000,
      },
    });
    const found = asList(list.data).some((card) => card.id === ctx.restaurantId);
    const one = await customer.call('GET', `/v1/restaurants/${ctx.restaurantId}`);
    const menu = await customer.call('GET', `/v1/restaurants/${ctx.restaurantId}/menu`);
    const names = [];
    for (const category of menu.data?.categories || []) {
      for (const item of category.items || []) names.push(item.name);
    }
    if (!names.some((name) => String(name).startsWith('E2E'))) {
      throw new StepFail('customer menu did not include the journey items', { detail: { found_in_list: found, names } });
    }
    return { found_in_list: found, halal: one.data?.halal?.display_state || null, item_count: names.length };
  }, { needs: ['customer', 'restaurant-live', 'menu'] });

  await step('customer-quote-order', 'Customer quotes, places, and confirms the card', async () => {
    const placed = await placeOrder();
    ctx.orderId = placed.order_id;
    ctx.orderState = placed.order_state;
    return placed;
  }, { needs: ['customer', 'restaurant-live', 'menu', 'address'], provides: 'order' });

  await step('restaurant-sees-order', 'Restaurant list includes the order', async () => {
    const list = await restaurant.call('GET', '/v1/restaurant/orders');
    const rows = asList(list.data);
    const hit = rows.find((row) => row.id === ctx.orderId);
    if (!hit) {
      throw new StepFail('order was not in the restaurant list', { detail: { count: rows.length, order_state: ctx.orderState } });
    }
    return { state: hit.state, count: rows.length };
  }, { needs: ['restaurant', 'order'] });

  await step('restaurant-accept', 'Restaurant accepts and the payment is captured', async () => {
    const accepted = await restaurant.call('POST', `/v1/restaurant/orders/${ctx.orderId}/accept`, { expect: [200] });
    const pay = await watchOrder(
      ctx.orderId,
      (row) => row.payment_state === 'SUCCEEDED' && row.amount_captured_cents > 0,
      60_000,
    );
    ctx.captured = true;
    return { accept_state: accepted.data?.state || null, ...pay };
  }, { needs: ['restaurant', 'order'], provides: 'captured' });

  await step('restaurant-ready', 'Restaurant marks the order ready', async () => {
    const res = await restaurant.call('POST', `/v1/restaurant/orders/${ctx.orderId}/ready`, { expect: [200] });
    return { state: res.data?.state || null };
  }, { needs: ['restaurant', 'order', 'captured'] });

  await step('seal-bind', 'Restaurant binds a package seal', async () => {
    await restaurant.call('POST', `/v1/orders/${ctx.orderId}/handoff/seal`, {
      body: { seal_code: `E2E-SEAL-${stamp}` },
      expect: [200, 201],
    });
    return { bound: true };
  }, { needs: ['restaurant', 'order'] });

  await step('rider-offer-accept', 'Rider receives the offer and accepts it', async () => {
    const deadline = Date.now() + 75_000;
    let last = null;
    let offer = null;
    while (Date.now() < deadline) {
      try {
        const current = await rider.call('GET', '/v1/riders/me/offers/current');
        if (current.data?.offer_id) offer = current.data;
      } catch (err) {
        if (err.status !== 404) throw err;
      }
      const dashboard = await rider.call('GET', '/v1/riders/me/dashboard');
      if (!offer && dashboard.data?.current_offer?.offer_id) offer = dashboard.data.current_offer;
      last = { offer_order_id: offer?.order_id || null, mode: dashboard.data?.mode || null };
      if (offer?.order_id === ctx.orderId) break;
      offer = null;
      await sleep(3000);
    }
    if (!offer || offer.order_id !== ctx.orderId) {
      throw new StepFail('no offer arrived for this order', { code: 'OFFER_TIMEOUT', detail: last });
    }
    const accepted = await rider.call('POST', `/v1/riders/me/offers/${offer.offer_id}/accept`, { expect: [200, 201] });
    ctx.assignmentId = accepted.data?.id || null;
    return { assignment_id: ctx.assignmentId, state: accepted.data?.state || null };
  }, { needs: ['rider-online', 'order', 'captured'], provides: 'offer' });

  await step('rider-deliver', 'Rider arrives, picks up, and delivers', async () => {
    const assignmentId = ctx.assignmentId;
    const pickup = ['EN_ROUTE_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'PICKED_UP'];
    for (const state of pickup) await transition(assignmentId, state, RESTAURANT_PIN);
    await transition(assignmentId, 'EN_ROUTE_TO_DROPOFF', CUSTOMER_PIN);
    await transition(assignmentId, 'ARRIVED_AT_DROPOFF', CUSTOMER_PIN);
    const host = await proveDelivery(assignmentId, ctx.orderId);
    try {
      await transition(assignmentId, 'DELIVERED', CUSTOMER_PIN);
    } catch (err) {
      if (err.code !== 'POD_REQUIRED') throw err;
      await proveDelivery(assignmentId, ctx.orderId);
      await transition(assignmentId, 'DELIVERED', CUSTOMER_PIN);
    }
    return { assignment_id: assignmentId, pod_host: host, state: 'DELIVERED' };
  }, { needs: ['rider-online', 'offer', 'order'] });

  await step('customer-delivered', 'Customer sees the order delivered', async () => {
    const seen = await watchOrder(
      ctx.orderId,
      (row) => row.order_state === 'DELIVERED' || row.order_state === 'COMPLETED',
      60_000,
    );
    return seen;
  }, { needs: ['customer', 'order'], provides: 'happy-terminal' });

  await step('customer-receipt', 'Customer reads the receipt', async () => {
    const res = await customer.call('GET', `/v1/orders/${ctx.orderId}/receipt`, { expect: [200, 404] });
    if (res.status === 404 || !res.data?.receipt_number) {
      throw new StepFail('receipt was missing', {
        status: res.status,
        code: res.error?.code || 'RECEIPT_MISSING',
        detail: { has_body: Boolean(res.data) },
      });
    }
    return {
      receipt_number: res.data.receipt_number,
      amount_charged_cents: res.data.payment?.amount_charged_cents ?? null,
    };
  }, { needs: ['customer', 'order'] });

  await step('customer-rating', 'Customer rates the order', async () => {
    const res = await customer.call('PUT', `/v1/orders/${ctx.orderId}/rating`, {
      body: { food: { score: 5 }, rider: { score: 5 } },
      expect: [200],
    });
    return { food: res.data?.food?.score ?? null, rider: res.data?.rider?.score ?? null };
  }, { needs: ['customer', 'order', 'happy-terminal'] });

  const sideBlocked = () => ({
    order_id: ctx.orderId,
    order_state: ctx.orderState,
    note: 'The first order is still active, so another order was not placed.',
  });

  await step('side-cancel', 'Customer cancels a second order before acceptance', async () => {
    const placed = await placeOrder();
    await customer.call('POST', `/v1/orders/${placed.order_id}/cancel`, {
      body: { reason_code: 'CHANGED_MIND' },
      expect: [200],
    });
    const pay = await watchOrder(
      placed.order_id,
      (row) => row.order_state === 'CANCELLED' && paymentVoided(row),
      60_000,
    );
    return { order_id: placed.order_id, total_cents: placed.total_cents, ...pay };
  }, { needs: ['customer', 'restaurant-live', 'menu', 'address', 'happy-terminal'], provides: 'cancel-settled', onBlocked: sideBlocked });

  await step('side-reject', 'Restaurant rejects a third order and the payment is voided', async () => {
    const placed = await placeOrder();
    await restaurant.call('POST', `/v1/restaurant/orders/${placed.order_id}/reject`, {
      body: {
        reason_code: 'KITCHEN_AT_CAPACITY',
        note: 'E2E staging journey is rejecting this order on purpose.',
      },
      expect: [200],
    });
    const pay = await watchOrder(
      placed.order_id,
      (row) => row.order_state === 'REJECTED' && paymentVoided(row),
      60_000,
    );
    return { order_id: placed.order_id, ...pay };
  }, { needs: ['restaurant', 'customer', 'restaurant-live', 'menu', 'address', 'cancel-settled'], onBlocked: sideBlocked });

  await step('refund', 'A refund is requested for the captured order', async () => {
    const body = {
      order_id: ctx.orderId,
      kind: 'FULL',
      reason_code: 'FOOD_QUALITY',
      note: 'E2E journey refund after a delivered test order',
    };
    const customerRefund = await customer.call('POST', '/v1/refunds', { body, expect: [201, 403] });
    if (customerRefund.status === 201) {
      return { via: 'customer', refund_id: customerRefund.data?.id || null, state: customerRefund.data?.state || null };
    }
    const adminRefund = await admin.call('POST', '/v1/admin/refunds', {
      body: {
        order_id: ctx.orderId,
        scope: 'FULL',
        reason_code: 'FOOD_QUALITY',
        reason_text: 'E2E journey refund after a delivered test order',
      },
      expect: [201, 202],
    });
    return { via: 'admin', http_status: adminRefund.status, state: adminRefund.data?.state || null };
  }, { needs: ['captured', 'order', 'admin'] });
}

let fatal = null;
try {
  await run();
} catch (err) {
  fatal = err.message || 'runner stopped';
  console.log(`fail runner${err.code ? ` ${err.code}` : ''}`);
} finally {
  writeReports(fatal);
}
const bad = steps.some((row) => row.status !== 'pass') || fatal;
console.log(`report ${reportPath}`);
process.exit(bad ? 1 : 0);
