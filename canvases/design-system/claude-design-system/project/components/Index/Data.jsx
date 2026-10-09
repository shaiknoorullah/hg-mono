/* Admin kit sample data + contract mappings. Every field below is named after its
   contracts/openapi.yaml schema; nothing here is invented beyond sample values.
   Ids are UUIDv7-shaped (the contract's `format: uuid`); humans read OrderSummary.code.
   Certificate numbers are SAMPLE FREE TEXT, transcribed from the certificate. */
const { Badge, Button, HalalBadge, ORDER_STATE_LABELS } = window.HalalGoesDesignSystem_d11a47;

const ID = {
  me: '0192b3c4-5d6e-7a10-8b1c-2d3e4f506172',
  other: '0192b3c4-61a2-7b33-9c44-d5e6f7081920',
  r1: '0192a7e1-3f20-7c41-a8b2-9d0e1f2a3b4c', r2: '0192a7e1-4a31-7d52-b9c3-0e1f2a3b4c5d',
  r3: '0192a7e1-5b42-7e63-8ad4-1f2a3b4c5d6e', r4: '0192a7e1-6c53-7f74-9be5-2a3b4c5d6e7f',
  cert: '0192b0f2-7d64-7085-acf6-3b4c5d6e7f80', doc: '0192b0f2-8e75-7196-bd07-4c5d6e7f8091',
  rid1: '0192b1a3-9f86-72a7-8e18-5d6e7f8091a2', rid2: '0192b1a3-a097-73b8-9f29-6e7f8091a2b3', rid3: '0192b1a3-b1a8-74c9-a03a-7f8091a2b3c4',
  o1: '0192b3c1-0a1b-7c2d-8e3f-405162738495', o2: '0192b3c1-1b2c-7d3e-9f40-5162738495a6', o3: '0192b3c1-2c3d-7e4f-a051-62738495a6b7',
  o4: '0192b3c1-3d4e-7f50-b162-738495a6b7c8', o5: '0192b3c1-4e5f-7061-8273-8495a6b7c8d9',
  ref1: '0192b3d9-5f60-7172-9384-95a6b7c8d9ea', mv1: '0192b2e8-6071-7283-a495-a6b7c8d9eafb', mv2: '0192b2e8-7182-7394-b5a6-b7c8d9eafb0c',
};

const human = code => code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' ');
const opts = list => list.map(v => ({ value: v, label: human(v) }));

/* A 36-character uuid does not fit a compact column: show head…tail, full value on hover,
   and a copy action (Solar has no copy glyph, so the action is a text button). Gap: CopyableId. */
function ShortId({ id, copy = true }) {
  const [done, setDone] = React.useState(false);
  return (
    <span data-gap="CopyableId" title={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontFamily: 'var(--font-mono)', fontSize: 'var(--type-mono-sm-size)', color: 'var(--text-tertiary)' }}>
      {id.slice(0, 8)}…{id.slice(-4)}
      {copy && <Button size="sm" variant="ghost" accessibilityLabel={done ? 'Id copied' : 'Copy id ' + id} onPress={e => { e.stopPropagation(); setDone(true); try { navigator.clipboard.writeText(id); } catch (x) {} }} style={{ minHeight: 28, padding: '0 6px' }}>{done ? 'Copied' : 'Copy'}</Button>}
    </span>
  );
}

/* OrderState: all 14 values. Labels come from the design system's shared mapping
   (ORDER_STATE_LABELS, the port of ui-native order-track.ts); the kit only picks the Badge
   variant. Red (danger) is used only for FAILED — a payment/order failure, never a halal state. */
const ORDER_TONE = {
  CREATED: 'neutral', AUTHORIZED: 'neutral', RESTAURANT_PENDING: 'warning', PREPARING: 'info', READY_FOR_PICKUP: 'info',
  PICKED_UP: 'info', ARRIVED: 'info', DELIVERED: 'outline', COMPLETED: 'outline', CANCELLED: 'neutral',
  REJECTED: 'warning', FAILED: 'danger', DISPUTED: 'warning', RESOLVED: 'outline',
};
const ORDER_STATE = Object.fromEntries(Object.keys(ORDER_TONE).map(k => [k, [ORDER_STATE_LABELS[k] || human(k), ORDER_TONE[k]]]));
const OrderStateBadge = ({ s }) => <Badge variant={ORDER_STATE[s][1]} size="sm">{ORDER_STATE[s][0]}</Badge>;

/* RefundState: its own column, never folded into the order state (there is no REFUNDED order state). */
const REFUND_STATE = {
  REQUESTED: ['Requested', 'warning'], PENDING_APPROVAL: ['Needs approval', 'warning'], APPROVED: ['Approved', 'info'],
  AUTHORISED: ['Authorised', 'info'], SUBMITTED: ['Submitted', 'info'], SUCCEEDED: ['Succeeded', 'outline'],
  SETTLED: ['Settled', 'outline'], FAILED: ['Failed', 'danger'], DECLINED: ['Declined', 'neutral'], CANCELLED: ['Cancelled', 'neutral'],
};
const RefundStateBadge = ({ s }) => <Badge variant={REFUND_STATE[s][1]} size="sm">{REFUND_STATE[s][0]}</Badge>;

const ONBOARDING = {
  REGISTERED: ['Registered', 'neutral'], EMAIL_VERIFIED: ['Email verified', 'neutral'], PHONE_VERIFIED: ['Phone verified', 'neutral'],
  PROFILE_PENDING: ['Profile pending', 'neutral'], VEHICLE_PENDING: ['Vehicle pending', 'neutral'], DOCUMENTS_PENDING: ['Documents pending', 'neutral'],
  DOCUMENTS_REVIEW: ['In review', 'info'], DOCUMENTS_APPROVED: ['Documents approved', 'outline'], DOCUMENTS_REJECTED: ['Fix documents', 'warning'],
  PAYOUT_PENDING: ['Payout pending', 'neutral'], MENU_PENDING: ['Menu pending', 'neutral'], ACTIVE: ['Active', 'outline'], WITHDRAWN: ['Withdrawn', 'neutral'],
};
const OnboardingBadge = ({ s }) => <Badge variant={ONBOARDING[s][1]} size="sm">{ONBOARDING[s][0]}</Badge>;

const KYC = { SUBMITTED: ['Submitted', 'neutral'], IN_REVIEW: ['In review', 'info'], APPROVED: ['Approved', 'outline'], REJECTED: ['Rejected', 'warning'], EXPIRED: ['Expired', 'neutral'], SUPERSEDED: ['Superseded', 'neutral'] };
const KycBadge = ({ s }) => <Badge variant={KYC[s][1]} size="sm">{KYC[s][0]}</Badge>;

/* HalalDisplayState straight from the payload (contract enum verbatim). Missing -> the badge
   renders nothing and reports HALAL_DISPLAY_STATE_MISSING. Admin is an operational surface. */
const AdminHalal = ({ s }) => <HalalBadge state={s} surface="operational" size="sm" />;

/* The accepted registry (seed/002_halal_issuing_bodies.sql, S-11). */
const BODIES = [
  { id: '0192a001-0001-7001-8001-000000000001', name: 'Halal Monitoring Authority (HMA Canada)', aliases: ['HMA'], country: 'CA', region: 'ON', website: 'hmacanada.org', status: 'ACCEPTED', requires_issuer_confirmation: false },
  { id: '0192a001-0002-7002-8002-000000000002', name: 'Islamic Society of North America Canada (ISNA Canada)', aliases: ['ISNA Canada'], country: 'CA', region: 'ON', website: 'isnacanada.com', status: 'ACCEPTED', requires_issuer_confirmation: false },
  { id: '0192a001-0003-7003-8003-000000000003', name: 'Halal Food Standards Alliance of America (HFSAA)', aliases: ['HFSAA'], country: 'US', region: null, website: null, status: 'ACCEPTED', requires_issuer_confirmation: true },
];

const REJECT_HALAL = ['ILLEGIBLE', 'EXPIRED_OR_EXPIRING', 'ISSUER_NOT_ACCEPTED', 'NAME_MISMATCH', 'ADDRESS_MISMATCH', 'SCOPE_INSUFFICIENT', 'DUPLICATE_CERTIFICATE', 'SUSPECTED_FORGERY', 'OTHER'];

/* RestaurantApplicationSummary rows. */
const APPLICATIONS = [
  { restaurant_id: ID.r1, display_name: 'Sufra Kitchen', city: 'Mississauga', province: 'ON', onboarding_state: 'DOCUMENTS_REVIEW', submission_count: 1, assigned_admin_id: null, review_lock_expires_at: null, submitted_at: '2 Sept, 09:14', sla_due_at: '4 Sept, 09:14', sla: 'ok' },
  { restaurant_id: ID.r2, display_name: 'Bait Al Mandi', city: 'Toronto', province: 'ON', onboarding_state: 'DOCUMENTS_REVIEW', submission_count: 2, assigned_admin_id: ID.other, lock_owner: 'Maryam K.', review_lock_expires_at: '14:32', submitted_at: '1 Sept, 16:40', sla_due_at: '3 Sept, 16:40', sla: 'breached' },
  { restaurant_id: ID.r3, display_name: 'Karahi House', city: 'Toronto', province: 'ON', onboarding_state: 'DOCUMENTS_REVIEW', submission_count: 1, assigned_admin_id: ID.me, lock_owner: 'You', review_lock_expires_at: '14:48', submitted_at: '3 Sept, 11:02', sla_due_at: '5 Sept, 11:02', sla: 'ok' },
  { restaurant_id: ID.r4, display_name: 'Tandoor Lane', city: 'Markham', province: 'ON', onboarding_state: 'DOCUMENTS_REJECTED', submission_count: 3, assigned_admin_id: null, review_lock_expires_at: null, submitted_at: '28 Aug, 10:20', sla_due_at: '30 Aug, 10:20', sla: 'waiting' },
];

/* RiderApplicationSummary rows. */
const RIDER_APPS = [
  { rider_account_id: ID.rid1, display_name: 'Yusuf A.', vehicle_type: 'BICYCLE', onboarding_state: 'DOCUMENTS_REVIEW', attempt_number: 1, assigned_admin_id: null, submitted_at: '3 Sept, 08:12', sla_due_at: '5 Sept, 08:12', sla: 'ok' },
  { rider_account_id: ID.rid2, display_name: 'Fatima N.', vehicle_type: 'CAR', onboarding_state: 'DOCUMENTS_REVIEW', attempt_number: 2, assigned_admin_id: ID.other, lock_owner: 'Maryam K.', review_lock_expires_at: '14:40', submitted_at: '2 Sept, 19:55', sla_due_at: '4 Sept, 19:55', sla: 'ok' },
  { rider_account_id: ID.rid3, display_name: 'Musa I.', vehicle_type: 'SCOOTER', onboarding_state: 'DOCUMENTS_REJECTED', attempt_number: 1, assigned_admin_id: null, submitted_at: '30 Aug, 12:01', sla_due_at: '1 Sept, 12:01', sla: 'waiting' },
];

/* OrderSummary rows. `code` is the human reference; `id` is the uuid. */
const ORDERS = [
  { id: ID.o1, code: 'A7Q2', state: 'PREPARING', restaurant: 'Zaytoun Grill', item_count: 3, total_cents: 4187, placed_at: '18:47' },
  { id: ID.o2, code: 'K9PD', state: 'RESTAURANT_PENDING', restaurant: 'Karahi House', item_count: 2, total_cents: 2650, placed_at: '18:46' },
  { id: ID.o3, code: 'B4WZ', state: 'DELIVERED', restaurant: 'Anatolia Doner', item_count: 2, total_cents: 1899, placed_at: '18:38' },
  { id: ID.o4, code: 'Y1LM', state: 'REJECTED', restaurant: 'Zaytoun Grill', item_count: 1, total_cents: 3199, placed_at: '18:34' },
  { id: ID.o5, code: 'C3QQ', state: 'DISPUTED', restaurant: 'Anatolia Doner', item_count: 1, total_cents: 1749, placed_at: '18:12' },
];

Object.assign(window, {
  ID, ShortId, ORDER_STATE, OrderStateBadge, REFUND_STATE, RefundStateBadge, ONBOARDING, OnboardingBadge, KycBadge,
  AdminHalal, BODIES, REJECT_HALAL, human, opts, APPLICATIONS, RIDER_APPS, ORDERS,
});
