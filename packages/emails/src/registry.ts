import type { Template } from './define.js';
import { emailVerification, passwordReset, staffInvite } from './templates/account.js';
import { generic } from './templates/generic.js';
import { certificateLapsed, certificateRenewalReminder } from './templates/halal.js';
import { payoutSent } from './templates/money.js';
import {
  restaurantApplicationApproved,
  restaurantApplicationChangesRequested,
  restaurantApplicationRejected,
  riderApplicationApproved,
  riderApplicationChangesRequested,
  riderApplicationRejected,
} from './templates/onboarding.js';
import {
  restaurantReinstated,
  restaurantSuspended,
  riderReinstated,
  riderSuspended,
} from './templates/standing.js';

/**
 * Every template the Go service can send, by name. The Go side
 * (services/hg/internal/notify/emailtmpl) loads exactly this set from the
 * exported manifest, and its builders (services/hg/internal/notify/messages.go)
 * name these templates; a name in one place but not the other fails a test on
 * each side.
 */
export const templates: readonly Template[] = [
  generic,
  emailVerification,
  passwordReset,
  staffInvite,
  restaurantApplicationApproved,
  restaurantApplicationChangesRequested,
  restaurantApplicationRejected,
  riderApplicationApproved,
  riderApplicationChangesRequested,
  riderApplicationRejected,
  restaurantSuspended,
  restaurantReinstated,
  riderSuspended,
  riderReinstated,
  payoutSent,
  certificateRenewalReminder,
  certificateLapsed,
];
