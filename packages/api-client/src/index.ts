/**
 * `@hg/api-client` — the only way a HalalGoes frontend talks to the API.
 *
 * Nothing in this package is hand-written except `client.ts` and `money.ts`.
 * `src/generated/**` is produced by `pnpm generate` from `contracts/openapi.yaml`
 * and MUST NOT be edited. See README.md.
 */
export * from './client.js';
export * from './money.js';
export * from './realtime.js';

export type { components, operations, paths, webhooks } from './generated/openapi.js';

import type { components } from './generated/openapi.js';

/**
 * Every named schema in the contract, re-exported flat so app code can write
 * `Schema['OrderCustomerView']` instead of spelling the `components` path.
 */
export type Schema = components['schemas'];

/* ------------------------------------------------------------------------- *
 * The enums an app is most likely to switch on, surfaced by name.
 * These are type aliases over the generated union — not re-declarations.
 * ------------------------------------------------------------------------- */
export type OrderState = components['schemas']['OrderState'];
export type DispatchState = components['schemas']['DispatchState'];
export type AssignmentState = components['schemas']['AssignmentState'];
export type PaymentState = components['schemas']['PaymentState'];
export type RefundState = components['schemas']['RefundState'];
export type HalalDisplayState = components['schemas']['HalalDisplayState'];
export type HalalCertificateStatus = components['schemas']['HalalCertificateStatus'];
export type RestaurantOnboardingState = components['schemas']['RestaurantOnboardingState'];
export type RiderOnboardingState = components['schemas']['RiderOnboardingState'];
export type KycDocumentState = components['schemas']['KycDocumentState'];
export type RestaurantAccountState = components['schemas']['RestaurantAccountState'];
export type RestaurantOpenState = components['schemas']['RestaurantOpenState'];
export type Role = components['schemas']['Role'];
export type Province = components['schemas']['Province'];
export type NextRoute = components['schemas']['NextRoute'];

/**
 * Terminal order states. `docs/spec/01-platform.md` §P-14: five of the fourteen are
 * terminal, and nothing transitions out of them.
 */
export const TERMINAL_ORDER_STATES = [
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
  'FAILED',
  'RESOLVED',
] as const satisfies readonly OrderState[];

export function isTerminalOrderState(state: OrderState): boolean {
  return (TERMINAL_ORDER_STATES as readonly string[]).includes(state);
}

/**
 * The two customer-visible halal states. Everything else 404s from customer read paths
 * (contradiction log #19), so a listing surface can never render an uncertified kitchen.
 */
export const CUSTOMER_VISIBLE_HALAL_STATES = [
  'CERTIFIED',
  'EXPIRING_SOON',
] as const satisfies readonly HalalDisplayState[];

/**
 * Exhaustiveness guard. Clients must treat an unknown enum value as "unsupported —
 * refresh the app", never crash, so this returns a fallback rather than throwing.
 */
export function assertNever<T>(value: never, fallback: T): T {
  return fallback;
}
