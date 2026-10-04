/**
 * Error copy, keyed off the stable `error.code` enum — **never off `error.message`**
 * (customer spec §0.2, rider spec §0.1, 02-components.md §36).
 *
 * `ErrorCode` is imported from `@hg/api-client`, so this table is typed against the contract. It
 * is deliberately a `Partial` record: mapping all ~145 codes would be busywork and most never
 * reach a user-facing surface. An unmapped code falls back to generic copy **and reports the code**
 * through `onUnmappedCode`, so the gap is discoverable instead of invisible.
 */
import type { ErrorCode } from '@hg/api-client';

export interface ErrorCopy {
  title: string;
  /** Plain-language cause, then what the user can do. */
  description: string;
  /** Whether Retry is the honest affordance. A 409 that will 409 again does not offer Retry. */
  retryable: boolean;
  /** Point the user at support rather than at a button that cannot help. */
  supportable?: boolean;
}

/**
 * The distinct non-code states. Network-offline is its own state with its own copy, not a generic
 * error (02-components.md §36).
 */
export const OFFLINE_COPY: ErrorCopy = {
  title: 'You are offline',
  description:
    'We could not reach HalalGoes. Check your connection — anything you have entered is kept.',
  retryable: true,
};

export const GENERIC_COPY: ErrorCopy = {
  title: 'Something went wrong on our side',
  description:
    'This is not something you did. Try again, and if it keeps happening send us the details below.',
  retryable: true,
  supportable: true,
};

export const ERROR_COPY: Partial<Record<ErrorCode, ErrorCopy>> = {
  /* ---------------------------------------------------------------- halal-specific (C-12 R3) */
  /**
   * The one piece of copy in the system that has to be exactly right. 409 at checkout because the
   * restaurant's certification lapsed. The cart is NOT emptied.
   */
  RESTAURANT_UNAVAILABLE: {
    title: "We can't place this order right now",
    description:
      "This restaurant's halal certification is no longer current, so we can't place this order. Your cart is saved.",
    retryable: false,
    supportable: true,
  },

  /* ------------------------------------------------------------------------------- transport */
  TIMEOUT: {
    title: 'That took too long',
    description: 'The request timed out before we heard back. Nothing was changed. Try again.',
    retryable: true,
  },
  RATE_LIMITED: {
    title: 'Too many attempts',
    description: 'Wait a moment before trying again.',
    retryable: true,
  },
  INTERNAL_ERROR: GENERIC_COPY,

  /* ------------------------------------------------------------------------------------ auth */
  AUTHENTICATION_REQUIRED: {
    title: 'Please sign in again',
    description: 'Your session has ended. Signing in again brings you straight back here.',
    retryable: false,
  },
  SESSION_EXPIRED: {
    title: 'Please sign in again',
    description: 'Your session has ended. Signing in again brings you straight back here.',
    retryable: false,
  },
  FORBIDDEN: {
    title: 'You do not have access to this',
    description: 'This account cannot view this page. If that looks wrong, contact support.',
    retryable: false,
    supportable: true,
  },
  PERMISSION_DENIED: {
    title: 'You do not have access to this',
    description: 'This account cannot perform this action.',
    retryable: false,
    supportable: true,
  },
  NOT_FOUND: {
    title: 'We could not find that',
    description: 'It may have been removed, or the link may be out of date.',
    retryable: false,
  },
  ACCOUNT_SUSPENDED: {
    title: 'This account is suspended',
    description: 'Contact support to find out what is needed to restore it.',
    retryable: false,
    supportable: true,
  },

  /* ------------------------------------------------------------------------ browse and cart */
  RESTAURANT_CLOSED: {
    title: 'This restaurant is closed',
    description: 'It is not accepting orders right now. Your cart is saved for when it reopens.',
    retryable: false,
  },
  ITEM_UNAVAILABLE: {
    title: 'That item just sold out',
    description: 'The kitchen marked it unavailable. Everything else in your cart is unchanged.',
    retryable: false,
  },
  CART_HAS_UNAVAILABLE_ITEMS: {
    title: 'Some items are no longer available',
    description: 'Remove the flagged items to continue. The rest of your cart is unchanged.',
    retryable: false,
  },
  DIFFERENT_RESTAURANT: {
    title: 'Your cart is from a different restaurant',
    description: 'Start a new cart to order from here, or finish the one you have.',
    retryable: false,
  },
  BELOW_MINIMUM_ORDER: {
    title: 'Order is below this restaurant’s minimum',
    description: 'Add a little more to reach the minimum for delivery.',
    retryable: false,
  },
  ADDRESS_OUT_OF_RANGE: {
    title: 'That address is outside the delivery area',
    description: 'Pick another saved address, or order from a restaurant closer to you.',
    retryable: false,
  },
  PROVINCE_NOT_SERVED: {
    title: 'We do not deliver in that province yet',
    description: 'You can still browse. We will let you know when we arrive.',
    retryable: false,
  },

  /* -------------------------------------------------------------------------------- checkout */
  QUOTE_EXPIRED: {
    title: 'Prices were refreshed',
    description: 'Your quote expired before checkout finished. Review the total and try again.',
    retryable: true,
  },
  QUOTE_STALE: {
    title: 'Prices were refreshed',
    description: 'Something changed while you were checking out. Review the total and try again.',
    retryable: true,
  },
  PRICE_CHANGED: {
    title: 'The price changed',
    description: 'Review the new total before placing the order.',
    retryable: true,
  },
  PAYMENT_METHOD_INVALID: {
    title: 'That payment method was declined',
    description: 'Your bank did not authorise it. Try another card — you have not been charged.',
    retryable: false,
  },
  CAPTURE_FAILED: {
    title: 'We could not take the payment',
    description: 'Nothing was charged. Try another payment method.',
    retryable: true,
  },
  ACTIVE_ORDER_EXISTS: {
    title: 'You already have an order in progress',
    description: 'Finish or cancel it before placing another.',
    retryable: false,
  },

  /* ----------------------------------------------------------------------------------- order */
  CANCELLATION_WINDOW_CLOSED: {
    title: 'This order can no longer be cancelled here',
    description: 'It is already being prepared. Contact support if something is wrong.',
    retryable: false,
    supportable: true,
  },
  ORDER_CANCELLED: {
    title: 'This order was cancelled',
    description: 'Any authorised amount is released back to you.',
    retryable: false,
  },
  ILLEGAL_TRANSITION: {
    title: 'That is no longer possible',
    description: 'The order moved on while this screen was open. Refresh to see where it is now.',
    retryable: true,
  },

  /* ----------------------------------------------------------------------------------- rider */
  OFFER_ALREADY_TAKEN: {
    title: 'Another rider took this one',
    description: 'Nothing went wrong on your end. Back to waiting for offers.',
    retryable: false,
  },
  OFFER_EXPIRED: {
    title: 'The offer expired',
    description: 'Nothing went wrong on your end. Back to waiting for offers.',
    retryable: false,
  },
  OFFER_WITHDRAWN: {
    title: 'The offer was withdrawn',
    description: 'Nothing went wrong on your end. Back to waiting for offers.',
    retryable: false,
  },
  ACTIVE_DELIVERY_IN_PROGRESS: {
    title: 'You have a delivery in progress',
    description: 'Finish it first. You can choose to go offline as soon as it is delivered.',
    retryable: false,
  },
  GEOFENCE_REQUIRED: {
    title: 'You are not close enough yet',
    description: 'Move closer, or confirm your location with a reason if the address is wrong.',
    retryable: true,
  },
  INVALID_TRANSITION: {
    title: 'That step is no longer available',
    description: 'The delivery has already moved on. Refresh to see the current step.',
    retryable: true,
  },
  POD_REQUIRED: {
    title: 'Proof of delivery is required',
    description: 'Take the photo to complete this delivery.',
    retryable: false,
  },
  CANNOT_GO_ONLINE: {
    title: 'You cannot go online yet',
    description: 'Something in your account is blocking it. The reasons are listed on your home screen.',
    retryable: false,
  },

  /* ------------------------------------------------------------------------------ restaurant */
  DOCUMENT_ALREADY_EXPIRED: {
    title: 'That document has expired',
    description: 'Upload a current one to continue.',
    retryable: false,
  },
  HALAL_CERTIFICATE_REQUIRED: {
    title: 'A halal certificate is required',
    description: 'Upload a current certificate from an accepted certifying body to continue.',
    retryable: false,
  },
  UNRECOGNISED_CERTIFIER: {
    title: 'We do not recognise that certifying body',
    description: 'Choose one from the list. If yours is missing, contact support so we can review it.',
    retryable: false,
    supportable: true,
  },
};

/** Look up copy for a code. Returns `null` for an unmapped code so the caller can report it. */
export function copyForCode(code: string | undefined | null): ErrorCopy | null {
  if (!code) return null;
  return ERROR_COPY[code as ErrorCode] ?? null;
}
