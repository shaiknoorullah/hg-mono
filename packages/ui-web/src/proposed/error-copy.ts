/**
 * The ErrorState copy map, keyed off the stable `error.code` enum, never off `error.message`
 * (02-components.md §36). Ported from the pre-rebuild `feedback/ErrorState.tsx`, which the
 * released apps still render and which cannot change before launch; the legacy copy goes when
 * the cut-over (W8) deletes that file.
 */

/** One code's copy. */
export interface Copy {
  title: string;
  description: string;
  /** Some errors are not retryable; offering Retry teaches people the system is arbitrary. */
  retryable?: boolean;
}

/** Codes not listed fall back to `GENERIC` and report themselves. */
export const COPY: Partial<Record<string, Copy>> = {
  /* --- client-only ------------------------------------------------------- */
  NETWORK_OFFLINE: {
    title: 'You are offline',
    description:
      'Your device has no connection. Nothing has been lost — reconnect and try again.',
    retryable: true,
  },
  CLIENT_TIMEOUT: {
    title: 'That took too long',
    description: 'The request timed out before the server answered. It may still have worked.',
    retryable: true,
  },
  TRANSPORT_ERROR: {
    title: 'Could not reach the server',
    description:
      'The request never got a response — a connection, network, or access-policy failure ' +
      'before the server could answer. Check your connection, or that this address is reachable ' +
      'from where you are, then try again.',
    retryable: true,
  },

  /* --- transport / platform ---------------------------------------------- */
  INTERNAL_ERROR: {
    title: 'Something went wrong on our side',
    description: 'This is not your fault. Try again, and quote the request id if it persists.',
    retryable: true,
  },
  TIMEOUT: {
    title: 'The server took too long',
    description: 'The request timed out. Try again in a moment.',
    retryable: true,
  },
  RATE_LIMITED: {
    title: 'Too many requests',
    description: 'Slow down for a moment, then try again.',
    retryable: true,
  },
  VALIDATION_FAILED: {
    title: 'Some details need fixing',
    description: 'One or more fields were rejected. Correct them and submit again.',
    retryable: false,
  },
  NOT_FOUND: {
    title: 'Not found',
    description: 'This record does not exist, or it has been removed.',
    retryable: false,
  },
  FORBIDDEN: {
    title: 'You cannot open this',
    description: 'Your role does not have access to this record.',
    retryable: false,
  },
  PERMISSION_DENIED: {
    title: 'You cannot do this',
    description: 'Your role does not carry the permission this action needs.',
    retryable: false,
  },
  FORBIDDEN_PERMISSION: {
    title: 'You cannot do this',
    description: 'Your role does not carry the permission this action needs.',
    retryable: false,
  },
  AUTHENTICATION_REQUIRED: {
    title: 'Please sign in again',
    description: 'Your session has ended. Signing in again will bring you back here.',
    retryable: false,
  },
  SESSION_EXPIRED: {
    title: 'Your session expired',
    description: 'Sign in again to continue where you left off.',
    retryable: false,
  },

  /* --- halal, the special case ------------------------------------------- */
  /**
   * C-12 R3: `RESTAURANT_UNAVAILABLE` at checkout is a 409 with halal-specific copy, and
   * the cart is **not** emptied.
   */
  RESTAURANT_UNAVAILABLE: {
    title: 'This restaurant is not available right now',
    description:
      'This restaurant’s halal certification is no longer current, so we can’t place this order. Your cart is saved.',
    retryable: false,
  },
  HALAL_CERTIFICATE_REQUIRED: {
    title: 'A halal certificate is required',
    description: 'This step cannot be completed until a current halal certificate is on file.',
    retryable: false,
  },
  UNRECOGNISED_CERTIFIER: {
    title: 'Issuing body not in the registry',
    description:
      'Only certifying bodies in the accepted registry can be recorded. Pick one from the list.',
    retryable: false,
  },
  DUPLICATE_CERTIFICATE: {
    title: 'This certificate is already in use',
    description:
      'The certificate number is registered to another restaurant. It cannot be approved twice.',
    retryable: false,
  },

  /* --- admin review ------------------------------------------------------ */
  CHECKLIST_INCOMPLETE: {
    title: 'Checks are outstanding',
    description: 'Every check must pass before this can be approved. The outstanding keys are marked.',
    retryable: false,
  },
  CHECK_FAILED: {
    title: 'A check did not pass',
    description: 'The failing checks are marked. Resolve them or reject with a reason.',
    retryable: false,
  },
  CHECK_NOT_OVERRIDABLE: {
    title: 'This check cannot be overridden',
    description: 'It is computed by the system and is not open to a manual override.',
    retryable: false,
  },
  REVIEW_LOCK_LOST: {
    title: 'Someone else took this review',
    description: 'Another reviewer holds the lock on this record. Refresh the queue.',
    retryable: true,
  },
  ALREADY_DECIDED: {
    title: 'Already decided',
    description: 'A decision was recorded on this record while you were working.',
    retryable: false,
  },
  CASE_REQUIRED: {
    title: 'A case link is required',
    description: 'Revealing this field needs a linked case and a justification.',
    retryable: false,
  },
  DOCUMENT_ALREADY_EXPIRED: {
    title: 'This document has expired',
    description: 'An expired document cannot be approved. Ask the partner to re-upload.',
    retryable: false,
  },
  UPLOAD_NOT_FOUND: {
    title: 'The document is missing',
    description:
      'The stored object for this record cannot be found. A check cannot be recorded against a document nobody can see.',
    retryable: false,
  },

  /* --- restaurant queue -------------------------------------------------- */
  ILLEGAL_TRANSITION: {
    title: 'That is no longer possible',
    description: 'The order has already moved on. Refresh to see where it is now.',
    retryable: true,
  },
  ILLEGAL_STATE_TRANSITION: {
    title: 'That is no longer possible',
    description: 'The order has already moved on. Refresh to see where it is now.',
    retryable: true,
  },
  ORDER_CANCELLED: {
    title: 'This order was cancelled',
    description: 'It is no longer in the queue. No further action is needed.',
    retryable: false,
  },
  OFFER_EXPIRED: {
    title: 'That offer expired',
    description: 'The response window closed before this reached us.',
    retryable: false,
  },
};

/** The fallback for an unmapped or absent code. */
export const GENERIC: Copy = {
  title: 'Something went wrong',
  description:
    'We could not complete that. Try again — if it keeps happening, send support the details below.',
  retryable: true,
};
