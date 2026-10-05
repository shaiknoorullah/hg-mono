-- Seed data for Admin Journeys (Al-Barakah Grill & Tariq Rider)
BEGIN;

-- 1. Restaurant Owner account
INSERT INTO account (id, email, password_hash, status)
VALUES (
    'e2e00000-0000-4000-8000-00000000b002',
    'owner@albarakah.e2e.halalgoes.test',
    (SELECT password_hash FROM account WHERE email = 'admin@halalgoes.com'),
    'ACTIVE'
)
ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- 2. Restaurant
INSERT INTO restaurant (
    id, slug, display_name, legal_name, phone_e164, line1, city, province, postal_code, country,
    location, onboarding_state, account_state
)
VALUES (
    'e2e00000-0000-4000-8000-0000000000a3',
    'e2e-al-barakah',
    'E2E Al-Barakah Grill',
    'Al-Barakah Grill Inc.',
    '+14165550188',
    '123 Danforth Ave',
    'Toronto',
    'ON',
    'M4K 1N2',
    'CA',
    ST_SetSRID(ST_MakePoint(-79.35, 43.68), 4326),
    'DOCUMENTS_REVIEW',
    'PENDING'
)
ON CONFLICT (id) DO UPDATE SET
    onboarding_state = 'DOCUMENTS_REVIEW',
    account_state = 'PENDING';

-- 3. Account Role
INSERT INTO account_role (account_id, role, scope_type, scope_id)
VALUES (
    'e2e00000-0000-4000-8000-00000000b002',
    'RESTAURANT_OWNER',
    'RESTAURANT',
    'e2e00000-0000-4000-8000-0000000000a3'
)
ON CONFLICT DO NOTHING;

-- 4. Restaurant Application
INSERT INTO restaurant_application (
    restaurant_id, submission_count, submitted_at, sla_due_at, decided_at, address_pin_warning
)
VALUES (
    'e2e00000-0000-4000-8000-0000000000a3',
    1,
    now() - interval '2 hours',
    now() + interval '22 hours',
    NULL,
    false
)
ON CONFLICT (restaurant_id) DO UPDATE SET
    submitted_at = now() - interval '2 hours',
    sla_due_at = now() + interval '22 hours',
    decided_at = NULL,
    assigned_admin_id = NULL,
    review_lock_expires_at = NULL;

-- 5. Stored Objects for Restaurant Documents
INSERT INTO stored_object (
    id, bucket, object_key, purpose, content_type, byte_size, sha256, state, confirmed_at, uploaded_by, restaurant_id
)
VALUES
(
    'e2e00000-0000-4000-8000-000000000d01',
    'kyc-documents',
    'restaurant/al-barakah/business-licence.pdf',
    'KYC_DOCUMENT',
    'application/pdf',
    10000,
    decode('0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20', 'hex'),
    'READY',
    now(),
    'e2e00000-0000-4000-8000-00000000b002',
    'e2e00000-0000-4000-8000-0000000000a3'
),
(
    'e2e00000-0000-4000-8000-000000000d02',
    'kyc-documents',
    'restaurant/al-barakah/food-safety.pdf',
    'KYC_DOCUMENT',
    'application/pdf',
    10000,
    decode('0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20', 'hex'),
    'READY',
    now(),
    'e2e00000-0000-4000-8000-00000000b002',
    'e2e00000-0000-4000-8000-0000000000a3'
),
(
    'e2e00000-0000-4000-8000-000000000d03',
    'kyc-documents',
    'restaurant/al-barakah/owner-id.pdf',
    'KYC_DOCUMENT',
    'application/pdf',
    10000,
    decode('0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20', 'hex'),
    'READY',
    now(),
    'e2e00000-0000-4000-8000-00000000b002',
    'e2e00000-0000-4000-8000-0000000000a3'
),
(
    'e2e00000-0000-4000-8000-000000000d04',
    'kyc-documents',
    'restaurant/al-barakah/halal-cert.pdf',
    'KYC_DOCUMENT',
    'application/pdf',
    10000,
    decode('0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20', 'hex'),
    'READY',
    now(),
    'e2e00000-0000-4000-8000-00000000b002',
    'e2e00000-0000-4000-8000-0000000000a3'
)
ON CONFLICT (id) DO NOTHING;

-- 6. KYC Documents for Restaurant
INSERT INTO kyc_document (
    id, subject_type, subject_id, restaurant_doc_type, stored_object_id, state,
    deadline_at, deadline_action
)
VALUES
(
    'e2e00000-0000-4000-8000-00000000dc01',
    'RESTAURANT',
    'e2e00000-0000-4000-8000-0000000000a3',
    'BUSINESS_LICENCE',
    'e2e00000-0000-4000-8000-000000000d01',
    'SUBMITTED',
    now() + interval '24 hours',
    'SLA_BREACH'
),
(
    'e2e00000-0000-4000-8000-00000000dc02',
    'RESTAURANT',
    'e2e00000-0000-4000-8000-0000000000a3',
    'FOOD_SAFETY',
    'e2e00000-0000-4000-8000-000000000d02',
    'SUBMITTED',
    now() + interval '24 hours',
    'SLA_BREACH'
),
(
    'e2e00000-0000-4000-8000-00000000dc03',
    'RESTAURANT',
    'e2e00000-0000-4000-8000-0000000000a3',
    'OWNER_ID',
    'e2e00000-0000-4000-8000-000000000d03',
    'SUBMITTED',
    now() + interval '24 hours',
    'SLA_BREACH'
),
(
    'e2e00000-0000-4000-8000-00000000dc04',
    'RESTAURANT',
    'e2e00000-0000-4000-8000-0000000000a3',
    'HALAL_CERTIFICATE',
    'e2e00000-0000-4000-8000-000000000d04',
    'SUBMITTED',
    now() + interval '24 hours',
    'SLA_BREACH'
)
ON CONFLICT (id) DO UPDATE SET
    state = 'SUBMITTED',
    deadline_at = now() + interval '24 hours',
    deadline_action = 'SLA_BREACH',
    reviewed_by = NULL,
    reviewed_at = NULL,
    rejection_reason_code = NULL,
    review_note = NULL;

-- 7. Halal Certificate
INSERT INTO halal_certificate (
    id, restaurant_id, document_id, certificate_number, issuing_body_id,
    certified_legal_name, certified_address, scope, issued_on, expires_on,
    status, checklist_version
)
VALUES (
    'e2e00000-0000-4000-8000-00000000ce01',
    'e2e00000-0000-4000-8000-0000000000a3',
    'e2e00000-0000-4000-8000-00000000dc04',
    'E2E-HMA-999',
    '01a10a15-8e80-7cef-a2db-a0843cee4b84',
    'Al-Barakah Grill Inc.',
    '123 Danforth Ave, Toronto, ON',
    'SPECIFIC_MENU_ITEMS',
    CURRENT_DATE - 30,
    CURRENT_DATE + 335,
    'PENDING',
    1
)
ON CONFLICT (id) DO UPDATE SET
    status = 'PENDING',
    certificate_number = 'E2E-HMA-999',
    scope = 'SPECIFIC_MENU_ITEMS',
    verified_by = NULL,
    verified_at = NULL,
    rejection_reason_code = NULL,
    rejection_reason_text = NULL;

-- 8. Halal Certificate Checks
INSERT INTO halal_certificate_check (
    halal_certificate_id, check_key, result, computed_result, overridable
)
VALUES
    ('e2e00000-0000-4000-8000-00000000ce01', 'H1_LEGIBLE_COMPLETE', 'NOT_ASSESSED', 'NOT_ASSESSED', true),
    ('e2e00000-0000-4000-8000-00000000ce01', 'H2_ISSUER_ACCEPTED', 'NOT_ASSESSED', 'NOT_ASSESSED', true),
    ('e2e00000-0000-4000-8000-00000000ce01', 'H3_NAME_MATCH', 'NOT_ASSESSED', 'NOT_ASSESSED', true),
    ('e2e00000-0000-4000-8000-00000000ce01', 'H4_ADDRESS_MATCH', 'NOT_ASSESSED', 'NOT_ASSESSED', true),
    ('e2e00000-0000-4000-8000-00000000ce01', 'H5_DATES_VALID', 'NOT_ASSESSED', 'NOT_ASSESSED', false),
    ('e2e00000-0000-4000-8000-00000000ce01', 'H6_SCOPE_SUFFICIENT', 'NOT_ASSESSED', 'NOT_ASSESSED', true),
    ('e2e00000-0000-4000-8000-00000000ce01', 'H7_UNIQUE_NOT_REUSED', 'NOT_ASSESSED', 'NOT_ASSESSED', false)
ON CONFLICT (halal_certificate_id, check_key) DO UPDATE SET
    result = 'NOT_ASSESSED',
    computed_result = 'NOT_ASSESSED',
    checked_by = NULL,
    checked_at = NULL,
    note = NULL;

-- 9. Rider Account
INSERT INTO account (id, phone_e164, email, status)
VALUES (
    'e2e00000-0000-4000-8000-00000000d002',
    '+14165550182',
    'tariq@e2e.halalgoes.test',
    'ACTIVE'
)
ON CONFLICT (id) DO UPDATE SET phone_e164 = '+14165550182', email = 'tariq@e2e.halalgoes.test';

-- 10. Rider Role
INSERT INTO account_role (account_id, role, scope_type)
VALUES (
    'e2e00000-0000-4000-8000-00000000d002',
    'RIDER',
    'GLOBAL'
)
ON CONFLICT DO NOTHING;

-- 11. Rider Profile
INSERT INTO rider_profile (
    account_id, first_name, last_name, date_of_birth, onboarding_state, account_status
)
VALUES (
    'e2e00000-0000-4000-8000-00000000d002',
    'Tariq',
    'Rider',
    '1995-05-15',
    'DOCUMENTS_REVIEW',
    'PENDING'
)
ON CONFLICT (account_id) DO UPDATE SET
    onboarding_state = 'DOCUMENTS_REVIEW',
    account_status = 'PENDING',
    approved_at = NULL,
    approved_by = NULL;

-- 12. Rider Vehicle
INSERT INTO rider_vehicle (account_id, vehicle_type, is_active)
VALUES (
    'e2e00000-0000-4000-8000-00000000d002',
    'BICYCLE',
    true
)
ON CONFLICT DO NOTHING;

-- 13. Rider Application
INSERT INTO rider_application (
    account_id, submission_count, submitted_at, sla_due_at, decided_at
)
VALUES (
    'e2e00000-0000-4000-8000-00000000d002',
    1,
    now() - interval '2 hours',
    now() + interval '22 hours',
    NULL
)
ON CONFLICT (account_id) DO UPDATE SET
    submitted_at = now() - interval '2 hours',
    sla_due_at = now() + interval '22 hours',
    decided_at = NULL,
    assigned_admin_id = NULL,
    review_lock_expires_at = NULL;

-- 14. Rider Stored Object
INSERT INTO stored_object (
    id, bucket, object_key, purpose, content_type, byte_size, sha256, state, confirmed_at, uploaded_by
)
VALUES (
    'e2e00000-0000-4000-8000-000000000d05',
    'kyc-documents',
    'rider/tariq/gov-id.pdf',
    'KYC_DOCUMENT',
    'application/pdf',
    10000,
    decode('0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20', 'hex'),
    'READY',
    now(),
    'e2e00000-0000-4000-8000-00000000d002'
)
ON CONFLICT (id) DO NOTHING;

-- 15. Rider KYC Document
INSERT INTO kyc_document (
    id, subject_type, subject_id, rider_doc_type, stored_object_id, state,
    deadline_at, deadline_action
)
VALUES (
    'e2e00000-0000-4000-8000-00000000dc05',
    'RIDER',
    'e2e00000-0000-4000-8000-00000000d002',
    'GOVERNMENT_ID',
    'e2e00000-0000-4000-8000-000000000d05',
    'SUBMITTED',
    now() + interval '24 hours',
    'SLA_BREACH'
)
ON CONFLICT (id) DO UPDATE SET
    state = 'SUBMITTED',
    deadline_at = now() + interval '24 hours',
    deadline_action = 'SLA_BREACH',
    reviewed_by = NULL,
    reviewed_at = NULL,
    rejection_reason_code = NULL,
    review_note = NULL;

COMMIT;
