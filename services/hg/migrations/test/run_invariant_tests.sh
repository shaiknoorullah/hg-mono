#!/usr/bin/env bash
# Invariant tests for the HalalGoes schema.
#
# Each case asserts that the DATABASE refuses something, or that an invariant
# query returns zero rows. These are the claims the migrations make; this script
# is what makes them checkable rather than asserted.
#
#     DATABASE_URL=postgres://hg:hg@localhost:5432/hg?sslmode=disable \
#       test/run_invariant_tests.sh
set -uo pipefail

DSN="${DATABASE_URL:-postgres://hg:hg@localhost:5432/hg?sslmode=disable}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASS=0
FAIL=0

pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf '  \033[31mFAIL\033[0m  %s\n     %s\n' "$1" "${2:-}"; FAIL=$((FAIL + 1)); }

# Asserts a statement is REJECTED, and that the message mentions $2.
reject() {
  local name="$1" want="$2" sql="$3" out
  out="$(psql "$DSN" -v ON_ERROR_STOP=1 -q -c "BEGIN; $sql COMMIT;" 2>&1)"
  if [ $? -eq 0 ]; then
    fail "$name" "the statement was ACCEPTED; it must be rejected"
  elif ! grep -qi -- "$want" <<<"$out"; then
    fail "$name" "rejected, but not for the expected reason: $(head -2 <<<"$out" | tr '\n' ' ')"
  else
    pass "$name"
  fi
}

# Asserts a statement is ACCEPTED.
accept() {
  local name="$1" sql="$2" out
  out="$(psql "$DSN" -v ON_ERROR_STOP=1 -q -c "BEGIN; $sql COMMIT;" 2>&1)"
  if [ $? -ne 0 ]; then
    fail "$name" "$(head -2 <<<"$out" | tr '\n' ' ')"
  else
    pass "$name"
  fi
}

# Asserts a query returns zero rows.
zero_rows() {
  local name="$1" sql="$2" n
  n="$(psql "$DSN" -At -c "SELECT count(*) FROM ($sql) _q" 2>&1)"
  if [ "$n" = "0" ]; then pass "$name"; else fail "$name" "expected 0 rows, got: $n"; fi
}

# Asserts a query returns exactly $2 rows.
n_rows() {
  local name="$1" want="$2" sql="$3" n
  n="$(psql "$DSN" -At -c "SELECT count(*) FROM ($sql) _q" 2>&1)"
  if [ "$n" = "$want" ]; then pass "$name"; else fail "$name" "expected $want rows, got: $n"; fi
}

echo
echo "Loading fixtures..."
psql "$DSN" -q -v ON_ERROR_STOP=1 -f "$HERE/fixtures.sql" >/dev/null || {
  echo "fixture load failed"; exit 1; }

echo
echo "1. Money is BIGINT, and the lint catches anything else"
reject "a numeric money column fails the lint gate" "money column must be BIGINT" \
  "CREATE TABLE lint_probe (id int, total_cents numeric(10,2)); SELECT assert_schema_lints();"
reject "the Postgres money type fails the lint gate" "banned outright" \
  "CREATE TABLE lint_probe (id int, fee money); SELECT assert_schema_lints();"
reject "double precision money fails the lint gate" "money column must be BIGINT" \
  "CREATE TABLE lint_probe (id int, tip_cents double precision); SELECT assert_schema_lints();"
reject "real money fails the lint gate" "money column must be BIGINT" \
  "CREATE TABLE lint_probe (id int, payout_cents real); SELECT assert_schema_lints();"
zero_rows "the shipped schema has zero money violations" "SELECT * FROM lint_money_columns()"
n_rows "every *_cents column in the schema is bigint" "0" \
  "SELECT 1 FROM information_schema.columns WHERE table_schema='public'
     AND column_name LIKE '%\\_cents' AND data_type <> 'bigint'"

echo
echo "2. One location column per entity, geography(Point,4326)"
reject "a second location column on restaurant fails the lint gate" "more than one location column" \
  "ALTER TABLE restaurant ADD COLUMN coords geography(Point,4326); SELECT assert_schema_lints();"
reject "a legacy POINT column fails the lint gate" "geography(Point,4326)" \
  "ALTER TABLE restaurant ADD COLUMN legacy_loc point; SELECT assert_schema_lints();"
zero_rows "the shipped schema has zero geography violations" "SELECT * FROM lint_location_columns()"
n_rows "restaurant carries exactly one location column" "1" \
  "SELECT 1 FROM information_schema.columns WHERE table_name='restaurant'
     AND udt_name IN ('geography','geometry','point')"
n_rows "the GiST indexes dispatch needs exist" "4" \
  "SELECT indexname FROM pg_indexes WHERE schemaname='public'
     AND indexname LIKE '%\\_gix'"

echo
echo "3. deadline_at: an order cannot wait forever"
reject "a non-terminal order with no deadline is rejected" "order_deadline_required" \
  "INSERT INTO \"order\" (code, quote_id, account_id, restaurant_id, delivery_address_id, state,
     subtotal_cents, discount_cents, delivery_fee_cents, service_fee_cents, tax_total_cents,
     tip_cents, total_cents)
   VALUES ('HG-NODL01','77777777-7777-4777-8777-777777777777','11111111-1111-4111-8111-111111111111',
     '33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','PREPARING',
     3000,0,419,0,444,500,4363);"
reject "a non-terminal order with a deadline but no action is rejected" "order_deadline_required" \
  "INSERT INTO \"order\" (code, quote_id, account_id, restaurant_id, delivery_address_id, state,
     deadline_at, subtotal_cents, discount_cents, delivery_fee_cents, service_fee_cents,
     tax_total_cents, tip_cents, total_cents)
   VALUES ('HG-NOAC01','77777777-7777-4777-8777-777777777777','11111111-1111-4111-8111-111111111111',
     '33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','PREPARING',
     now()+interval '10 minutes',3000,0,419,0,444,500,4363);"
reject "a terminal order carrying a deadline is rejected" "order_deadline_required" \
  "INSERT INTO \"order\" (code, quote_id, account_id, restaurant_id, delivery_address_id, state,
     deadline_at, deadline_action, cancel_reason, subtotal_cents, discount_cents, delivery_fee_cents,
     service_fee_cents, tax_total_cents, tip_cents, total_cents)
   VALUES ('HG-TERM01','77777777-7777-4777-8777-777777777777','11111111-1111-4111-8111-111111111111',
     '33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','CANCELLED',
     now()+interval '10 minutes','PREP_OVERDUE','CUSTOMER_CANCELLED',3000,0,419,0,444,500,4363);"
reject "a non-terminal dispatch with no deadline is rejected" "dispatch_deadline_required" \
  "INSERT INTO dispatch (order_id, state) VALUES ('88888888-8888-4888-8888-888888888888','SEARCHING');"
zero_rows "no live order lacks a deadline" "SELECT * FROM order_without_deadline"
zero_rows "no live dispatch lacks a deadline" "SELECT * FROM dispatch_without_deadline"

echo
echo "4. Double-entry ledger"
reject "an unbalanced batch cannot commit" "ledger_batch_unbalanced" \
  "INSERT INTO ledger_batch (id, kind, order_id, idempotency_key, posted_by)
     VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','SETTLE','88888888-8888-4888-8888-888888888888',
             'test:unbalanced','system:test');
   INSERT INTO ledger_entry (batch_id, order_id, account, amount_cents, component)
     VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','88888888-8888-4888-8888-888888888888',
             'PSP_CLEARING',-4363,'SUBTOTAL'),
            ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','88888888-8888-4888-8888-888888888888',
             'RESTAURANT_PAYABLE',3000,'SUBTOTAL');"
accept "a balanced batch commits" \
  "INSERT INTO ledger_batch (id, kind, order_id, idempotency_key, posted_by)
     VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','SETTLE','88888888-8888-4888-8888-888888888888',
             'test:balanced-'||gen_random_uuid(),'system:test');
   INSERT INTO ledger_entry (batch_id, order_id, account, amount_cents, component)
     VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','88888888-8888-4888-8888-888888888888',
             'PSP_CLEARING',-4363,'SUBTOTAL'),
            ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','88888888-8888-4888-8888-888888888888',
             'RESTAURANT_PAYABLE',3000,'SUBTOTAL'),
            ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','88888888-8888-4888-8888-888888888888',
             'RIDER_PAYABLE',919,'TIP'),
            ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','88888888-8888-4888-8888-888888888888',
             'TAX_PAYABLE',444,'TAX');"
reject "a batch with a single entry cannot commit" "ledger_batch_unbalanced" \
  "INSERT INTO ledger_batch (id, kind, order_id, idempotency_key, posted_by)
     VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','ADJUSTMENT','88888888-8888-4888-8888-888888888888',
             'test:single','system:test');
   INSERT INTO ledger_entry (batch_id, order_id, account, amount_cents, component)
     VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','88888888-8888-4888-8888-888888888888',
             'PSP_CLEARING',0,'SUBTOTAL');"
reject "a batch with no entries cannot commit" "ledger_batch_empty" \
  "INSERT INTO ledger_batch (kind, order_id, idempotency_key, posted_by)
     VALUES ('ADJUSTMENT','88888888-8888-4888-8888-888888888888','test:empty','system:test');"
reject "UPDATE on ledger_entry is refused" "ledger_is_append_only" \
  "UPDATE ledger_entry SET amount_cents = 1 WHERE order_id = '88888888-8888-4888-8888-888888888888';"
reject "DELETE on ledger_entry is refused" "ledger_is_append_only" \
  "DELETE FROM ledger_entry WHERE order_id = '88888888-8888-4888-8888-888888888888';"
reject "TRUNCATE on ledger_entry is refused" "ledger_is_append_only" \
  "TRUNCATE ledger_entry;"
n_rows "hg_app holds no UPDATE/DELETE grant on ledger_entry" "0" \
  "SELECT 1 FROM information_schema.table_privileges
     WHERE grantee='hg_app' AND table_name='ledger_entry' AND privilege_type IN ('DELETE','TRUNCATE')"
zero_rows "I-13.1 every batch balances" "SELECT * FROM ledger_batch_imbalance"
zero_rows "I-13.2 the decomposition invariant: one query, zero rows" \
  "SELECT * FROM ledger_order_residual"
zero_rows "I-13.7 the ledger balances globally" "SELECT * FROM ledger_global_residual"

echo
echo "5. Audit log: append-only and hash-chained"
accept "audit rows insert and chain themselves" \
  "INSERT INTO audit_event (actor_kind, actor_account_id, action, subject_type, subject_id, outcome, before, after)
   VALUES ('ACCOUNT','11111111-1111-4111-8111-111111111111','restaurant.verify','RESTAURANT',
           '33333333-3333-4333-8333-333333333333','SUCCESS','{\"status\":\"DOCUMENTS_REVIEW\"}','{\"status\":\"ACTIVE\"}'),
          ('ACCOUNT','11111111-1111-4111-8111-111111111111','refund.issue','ORDER',
           '88888888-8888-4888-8888-888888888888','SUCCESS',NULL,NULL);"
reject "UPDATE on audit_event is refused" "audit_is_append_only" \
  "UPDATE audit_event SET action='tampered' WHERE action='refund.issue';"
reject "DELETE on audit_event is refused" "audit_is_append_only" \
  "DELETE FROM audit_event WHERE action='refund.issue';"
n_rows "hg_app holds no DELETE grant on audit_event" "0" \
  "SELECT 1 FROM information_schema.table_privileges
     WHERE grantee='hg_app' AND table_name='audit_event' AND privilege_type IN ('DELETE','TRUNCATE')"
n_rows "every audit row carries a prev_hash and a hash" "0" \
  "SELECT 1 FROM audit_event WHERE prev_hash IS NULL OR hash IS NULL"
n_rows "the per-day sequence is dense" "0" \
  "SELECT day FROM audit_event GROUP BY day HAVING max(seq) <> count(*)"
zero_rows "verify_audit_chain finds no broken link today" \
  "SELECT * FROM verify_audit_chain(current_date)"

# Tamper detection needs the append-only trigger out of the way, which is
# exactly the superuser-edit scenario the chain exists to catch.
psql "$DSN" -q -c "ALTER TABLE audit_event DISABLE TRIGGER audit_event_append_only;
                   UPDATE audit_event SET action = 'tampered'
                    WHERE seq = (SELECT min(seq) FROM audit_event WHERE day = current_date)
                      AND day = current_date;
                   ALTER TABLE audit_event ENABLE TRIGGER audit_event_append_only;" >/dev/null 2>&1
n_rows "a tampered row is detected by verify_audit_chain" "1" \
  "SELECT * FROM verify_audit_chain(current_date)"
psql "$DSN" -q -c "DELETE FROM audit_event_default; TRUNCATE audit_event_p$(date -u +%Y%m);" >/dev/null 2>&1 || true
psql "$DSN" -q -c "ALTER TABLE audit_event DISABLE TRIGGER audit_event_append_only;
                   DELETE FROM audit_event;
                   ALTER TABLE audit_event ENABLE TRIGGER audit_event_append_only;" >/dev/null 2>&1

echo
echo "6. Halal certification"
reject "a certificate cannot be APPROVED without all seven checks at PASS" "halal_checklist_incomplete" \
  "INSERT INTO stored_object (id, bucket, object_key, purpose, content_type, byte_size, sha256,
       state, uploaded_by, confirmed_at)
     VALUES ('ee000000-0000-4000-8000-000000000001','hg-kyc','kyc/test/cert.pdf','KYC_DOCUMENT',
             'application/pdf',1024,digest('x','sha256'),'READY',
             '11111111-1111-4111-8111-111111111111',now());
   INSERT INTO kyc_document (id, subject_type, subject_id, restaurant_doc_type, stored_object_id,
       state, reviewed_by, reviewed_at)
     VALUES ('ee000000-0000-4000-8000-000000000002','RESTAURANT','33333333-3333-4333-8333-333333333333',
             'HALAL_CERTIFICATE','ee000000-0000-4000-8000-000000000001','APPROVED',
             '11111111-1111-4111-8111-111111111111',now());
   INSERT INTO halal_certificate (restaurant_id, document_id, certificate_number, issuing_body_id,
       certified_legal_name, certified_address, scope, issued_on, expires_on, status,
       checklist_version, verified_by, verified_at)
     SELECT '33333333-3333-4333-8333-333333333333','ee000000-0000-4000-8000-000000000002',
            'HMA-ON-40182', b.id, 'Karachi Kitchen Inc.','1245 Danforth Avenue, Toronto, ON M4J 1M4',
            'WHOLE_ESTABLISHMENT', DATE '2026-03-09', DATE '2027-03-09','APPROVED',3,
            '11111111-1111-4111-8111-111111111111', now()
       FROM halal_issuing_body b WHERE b.name LIKE 'Halal Monitoring%';"
reject "H5 and H7 are not overridable" "halal_check_hard_computed_flags" \
  "INSERT INTO stored_object (id, bucket, object_key, purpose, content_type, byte_size, sha256,
       state, uploaded_by, confirmed_at)
     VALUES ('ee000000-0000-4000-8000-000000000011','hg-kyc','kyc/test/cert2.pdf','KYC_DOCUMENT',
             'application/pdf',1024,digest('x2','sha256'),'READY',
             '11111111-1111-4111-8111-111111111111',now());
   INSERT INTO kyc_document (id, subject_type, subject_id, restaurant_doc_type, stored_object_id,
       state, reviewed_by, reviewed_at)
     VALUES ('ee000000-0000-4000-8000-000000000012','RESTAURANT','33333333-3333-4333-8333-333333333333',
             'HALAL_CERTIFICATE','ee000000-0000-4000-8000-000000000011','APPROVED',
             '11111111-1111-4111-8111-111111111111',now());
   INSERT INTO halal_certificate (id, restaurant_id, document_id, certificate_number, issuing_body_id,
       certified_legal_name, certified_address, scope, issued_on, expires_on, status, checklist_version)
     SELECT 'ee000000-0000-4000-8000-000000000013','33333333-3333-4333-8333-333333333333',
            'ee000000-0000-4000-8000-000000000012','X-1', b.id, 'n','a','WHOLE_ESTABLISHMENT',
            DATE '2026-03-09', DATE '2027-03-09','PENDING',3
       FROM halal_issuing_body b LIMIT 1;
   INSERT INTO halal_certificate_check (halal_certificate_id, check_key, result, computed_result,
       overridable, checked_by, checked_at)
     VALUES ('ee000000-0000-4000-8000-000000000013','H5_DATES_VALID','PASS','FAIL',true,
             '11111111-1111-4111-8111-111111111111',now());"
n_rows "the three accepted issuing bodies are seeded" "3" \
  "SELECT 1 FROM halal_issuing_body WHERE status='ACCEPTED'"
zero_rows "no restaurant claims CERTIFIED without a live certificate" \
  "SELECT * FROM halal_status_inconsistency"

echo
echo "7. Quote and order money identities"
reject "a quote whose components do not sum to the total is rejected" "quote_total_identity" \
  "INSERT INTO quote (account_id, cart_id, restaurant_id, delivery_address_id, fulfilment,
     pricing_config_id, tax_jurisdiction_code, subtotal_cents, delivery_fee_cents, tax_total_cents,
     tip_cents, total_cents, input_hash, state_hash, expires_at)
   SELECT '11111111-1111-4111-8111-111111111111','66666666-6666-4666-8666-666666666666',
     '33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','DELIVERY',
     pc.id,'CA-ON',3000,419,444,500,9999,digest('a','sha256'),digest('b','sha256'),now()+interval '10 min'
     FROM pricing_config pc WHERE pc.version=1;"
reject "a quote whose tax lines disagree with its total is rejected" "quote_tax_total_mismatch" \
  "INSERT INTO quote (id, account_id, cart_id, restaurant_id, delivery_address_id, fulfilment,
     pricing_config_id, tax_jurisdiction_code, subtotal_cents, delivery_fee_cents, tax_total_cents,
     tip_cents, total_cents, input_hash, state_hash, expires_at)
   SELECT 'ff000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
     '66666666-6666-4666-8666-666666666666','33333333-3333-4333-8333-333333333333',
     '22222222-2222-4222-8222-222222222222','DELIVERY',
     pc.id,'CA-ON',3000,419,444,500,4363,digest('a','sha256'),digest('b','sha256'),now()+interval '10 min'
     FROM pricing_config pc WHERE pc.version=1;
   INSERT INTO quote_tax_line (quote_id, seq, jurisdiction_code, tax_kind, statutory_label, rate,
     base_cents, amount_cents, remittable_by)
   VALUES ('ff000000-0000-4000-8000-000000000001',1,'CA-ON','HST','HST',0.13,3419,999,'PLATFORM');"
reject "an order whose total diverges from its quote is rejected" "order_total_diverges_from_quote" \
  "UPDATE \"order\" SET total_cents = 9999 WHERE id = '88888888-8888-4888-8888-888888888888';"
reject "a line total that is not unit x quantity is rejected" "order_line_identity" \
  "INSERT INTO order_line (order_id, line_no, menu_item_id, name_snapshot, quantity,
     base_price_cents, variant_part_cents, addons_part_cents, line_unit_cents, line_total_cents, tax_category)
   VALUES ('88888888-8888-4888-8888-888888888888',9,'55555555-5555-4555-8555-555555555555',
     'Bad Line',2,1500,1500,0,1500,1,'PREPARED_FOOD');"
reject "a receipt snapshot cannot be rewritten" "receipt_snapshot_is_immutable" \
  "UPDATE \"order\" SET receipt_snapshot = '{\"v\":1}' WHERE id='88888888-8888-4888-8888-888888888888';
   UPDATE \"order\" SET receipt_snapshot = '{\"v\":2}' WHERE id='88888888-8888-4888-8888-888888888888';"
zero_rows "no quote taxes the tip" "SELECT * FROM quote_tip_taxed"

echo
echo "8. Dispatch: exactly one rider"
accept "a rider can be assigned" \
  "INSERT INTO account (id, phone_e164, status) VALUES
     ('12000000-0000-4000-8000-000000000001','+14165550199','ACTIVE') ON CONFLICT DO NOTHING;
   INSERT INTO rider_profile (account_id, first_name, last_name, date_of_birth, approved_at,
     account_status, availability_state, is_online)
     VALUES ('12000000-0000-4000-8000-000000000001','Test','Rider',DATE '1995-01-01',now(),
             'ACTIVE','ON_DELIVERY',true) ON CONFLICT DO NOTHING;
   INSERT INTO dispatch (order_id, state, deadline_at, deadline_action, rider_account_id, assigned_at)
     VALUES ('88888888-8888-4888-8888-888888888888','ASSIGNED',now()+interval '20 minutes',
             'RIDER_NOT_ARRIVING','12000000-0000-4000-8000-000000000001',now());"
reject "an assigned dispatch state with no rider is rejected" "dispatch_rider_when_assigned" \
  "INSERT INTO dispatch (order_id, state, deadline_at, deadline_action)
     VALUES ('13000000-0000-4000-8000-000000000001','CARRYING',now()+interval '60 min','IN_TRANSIT_STALLED');"
reject "a rider cannot hold two live dispatches" "dispatch_one_live_per_rider" \
  "INSERT INTO dispatch (order_id, state, deadline_at, deadline_action, rider_account_id, assigned_at)
     VALUES ('13000000-0000-4000-8000-000000000002','ASSIGNED',now()+interval '20 min',
             'RIDER_NOT_ARRIVING','12000000-0000-4000-8000-000000000001',now());"

echo
echo "9. Identity, riders and documents"
reject "a rider under 18 cannot be onboarded" "rider_is_adult" \
  "INSERT INTO account (id, phone_e164, status) VALUES
     ('14000000-0000-4000-8000-000000000001','+14165550198','ACTIVE');
   INSERT INTO rider_profile (account_id, first_name, last_name, date_of_birth)
     VALUES ('14000000-0000-4000-8000-000000000001','Too','Young', current_date - interval '17 years');"
reject "a phone without a country code is rejected" "account_phone_e164_shape" \
  "INSERT INTO account (phone_e164) VALUES ('9876543210');"
reject "an account with neither phone nor email is rejected" "account_has_identifier" \
  "INSERT INTO account (locale) VALUES ('en-CA');"
reject "a document decision with no reviewer is rejected" "kyc_document_decision_attributed" \
  "INSERT INTO stored_object (id, bucket, object_key, purpose, content_type, byte_size, sha256,
       state, uploaded_by, confirmed_at)
     VALUES ('15000000-0000-4000-8000-000000000001','hg-kyc','kyc/t/d.pdf','KYC_DOCUMENT',
             'application/pdf',10,digest('y','sha256'),'READY','11111111-1111-4111-8111-111111111111',now());
   INSERT INTO kyc_document (subject_type, subject_id, restaurant_doc_type, stored_object_id, state)
     VALUES ('RESTAURANT','33333333-3333-4333-8333-333333333333','BUSINESS_LICENCE',
             '15000000-0000-4000-8000-000000000001','APPROVED');"
reject "a document under review must carry its 72h SLA deadline" "kyc_document_deadline_required" \
  "INSERT INTO stored_object (id, bucket, object_key, purpose, content_type, byte_size, sha256,
       state, uploaded_by, confirmed_at)
     VALUES ('15000000-0000-4000-8000-000000000002','hg-kyc','kyc/t/e.pdf','KYC_DOCUMENT',
             'application/pdf',10,digest('z','sha256'),'READY','11111111-1111-4111-8111-111111111111',now());
   INSERT INTO kyc_document (subject_type, subject_id, restaurant_doc_type, stored_object_id, state)
     VALUES ('RESTAURANT','33333333-3333-4333-8333-333333333333','BUSINESS_LICENCE',
             '15000000-0000-4000-8000-000000000002','IN_REVIEW');"
reject "a live restaurant with no location is rejected" "restaurant_live_needs_location" \
  "INSERT INTO restaurant (slug, legal_name, display_name, onboarding_state, account_state)
     VALUES ('no-location','No Location Inc.','No Location','ACTIVE','LIVE');"

echo
echo "10. Realtime and idempotency"
accept "channel seq is allocated monotonically" \
  "SELECT next_channel_seq('order:88888888-8888-4888-8888-888888888888') FROM generate_series(1,3);"
n_rows "the channel cursor advanced to 3" "1" \
  "SELECT 1 FROM channel_cursor WHERE channel='order:88888888-8888-4888-8888-888888888888' AND last_seq=3"
reject "two idempotency records with the same key collide" "idempotency_unique" \
  "INSERT INTO idempotency_record (account_id, method, path_template, key, request_hash, state, expires_at)
   VALUES ('11111111-1111-4111-8111-111111111111','POST','/v1/orders','01K4S9ZC0F8V7Q2R3T5Y6M8N9P',
           digest('r','sha256'),'IN_PROGRESS',now()+interval '24 hours'),
          ('11111111-1111-4111-8111-111111111111','POST','/v1/orders','01K4S9ZC0F8V7Q2R3T5Y6M8N9P',
           digest('r2','sha256'),'IN_PROGRESS',now()+interval '24 hours');"

echo
echo "11. Account actions (https://github.com/shaiknoorullah/hg-mono/issues/253)"
# History rows name a staff actor who may take the transition (migration 00045):
# an admin and a super admin to act.
INV_ADMIN='13000000-0000-4000-8000-000000000001'
INV_SUPER='13000000-0000-4000-8000-000000000002'
psql "$DSN" -q -v ON_ERROR_STOP=1 -c "
  INSERT INTO account (id, email, status) VALUES
    ('$INV_ADMIN', 'inv-admin@hg.test', 'ACTIVE'), ('$INV_SUPER', 'inv-super@hg.test', 'ACTIVE')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO account_role (account_id, role, scope_type)
  SELECT v.a::uuid, v.r::role_name, 'GLOBAL'
    FROM (VALUES ('$INV_ADMIN', 'ADMIN'), ('$INV_SUPER', 'SUPER_ADMIN')) AS v(a, r)
   WHERE NOT EXISTS (SELECT 1 FROM account_role x WHERE x.account_id = v.a::uuid AND x.role = v.r::role_name);" >/dev/null
# The admin's live two-step session and the access token signed for it: a staff
# action presents the token, and the database finds the session by its hash
# (migration 00045). The token's signature is not the database's to check.
INV_ADMIN_SESSION='13000000-0000-4000-8000-0000000000e1'
INV_ADMIN_TOKEN="$(psql "$DSN" -At -c "
  SELECT 'eyJhbGciOiJFZERTQSJ9.' || rtrim(translate(replace(encode(convert_to(json_build_object(
           'sub', '$INV_ADMIN', 'sid', '$INV_ADMIN_SESSION', 'roles', json_build_array('ADMIN'),
           'amr', json_build_array('pwd+totp'), 'exp', extract(epoch FROM now() + interval '1 hour')::bigint)::text,
           'UTF8'), 'base64'), E'\n', ''), '+/', '-_'), '=') || '.c2ln'")"
psql "$DSN" -q -v ON_ERROR_STOP=1 -c "
  INSERT INTO session (id, family_id, account_id, amr, roles_snapshot, client, refresh_hash, access_hash,
                       idle_expires_at, absolute_expires_at)
  VALUES ('$INV_ADMIN_SESSION', gen_random_uuid(), '$INV_ADMIN', 'pwd+totp', '[]', 'admin-web',
          sha256(convert_to('inv-admin-refresh', 'UTF8')), sha256(convert_to('$INV_ADMIN_TOKEN', 'UTF8')),
          now() + interval '30 minutes', now() + interval '12 hours')
  ON CONFLICT (id) DO UPDATE SET access_hash = EXCLUDED.access_hash, revoked_at = NULL,
    idle_expires_at = EXCLUDED.idle_expires_at, absolute_expires_at = EXCLUDED.absolute_expires_at;" >/dev/null
ASE_COLS="subject_type, subject_id, action, from_state, to_state, reason_code, reason_text, actor_account_id, idempotency_key, request_hash"
reject "a ban needs a proposal to confirm" "account_ban_needs_proposal" \
  "INSERT INTO account_state_event ($ASE_COLS) VALUES
   ('RIDER','22222222-2222-4222-8222-222222222222','CONFIRM_BAN','SUSPENDED','BANNED','SAFETY_RISK',
    'nobody proposed this ban','$INV_SUPER','inv-ban-without-proposal', '\x00');"
reject "the person who proposed a ban cannot confirm it" "account_ban_two_person" \
  "INSERT INTO account_state_event ($ASE_COLS) VALUES
   ('RIDER','22222222-2222-4222-8222-222222222222','PROPOSE_BAN','SUSPENDED','SUSPENDED','SAFETY_RISK',
    'proposing a ban for a test','$INV_SUPER','inv-two-person-propose', '\x00');
   INSERT INTO account_state_event ($ASE_COLS) VALUES
   ('RIDER','22222222-2222-4222-8222-222222222222','CONFIRM_BAN','SUSPENDED','BANNED','SAFETY_RISK',
    'confirming my own proposal','$INV_SUPER','inv-two-person-confirm', '\x00');"
# The transition guard (00045) runs before the CHECK (00044); either refuses it.
reject "a ban is reached only by confirming one" "account_state_illegal_transition\\|account_state_event_ban_shape" \
  "INSERT INTO account_state_event ($ASE_COLS) VALUES
   ('CUSTOMER','11111111-1111-4111-8111-111111111111','SUSPEND','ACTIVE','BANNED','OTHER',
    'a suspension that bans','$INV_ADMIN','inv-suspend-to-banned', '\x00');"
reject "a reason from another subject's vocabulary is refused" "account_state_event_reason_code" \
  "INSERT INTO account_state_event ($ASE_COLS) VALUES
   ('RIDER','22222222-2222-4222-8222-222222222222','SUSPEND','ACTIVE','SUSPENDED','HALAL_INTEGRITY',
    'a restaurant reason on a rider','$INV_ADMIN','inv-wrong-vocabulary', '\x00');"
reject "the account history is append-only" "account_state_event_is_append_only" \
  "INSERT INTO account_state_event ($ASE_COLS) VALUES
   ('CUSTOMER','11111111-1111-4111-8111-111111111111','SUSPEND','ACTIVE','SUSPENDED','OTHER',
    'suspended, then rewritten','$INV_ADMIN','inv-append-only-history', '\x00');
   UPDATE account_state_event SET to_state = 'ACTIVE' WHERE idempotency_key = 'inv-append-only-history';"

echo
echo "12. Only the database's writers change an account's state (migration 00045)"
RIDER_FX='019ffe57-fbd0-7355-ade8-b03ea7943578'
APPLY="SELECT * FROM account_state_apply"
reject "the application role cannot change a restaurant's state" "permission denied" \
  "SET LOCAL ROLE hg_app;
   UPDATE restaurant SET account_state = 'SUSPENDED' WHERE id = '33333333-3333-4333-8333-333333333333';"
reject "the application role cannot clear a restaurant's delisting reasons" "permission denied" \
  "SET LOCAL ROLE hg_app;
   UPDATE restaurant SET delist_reasons = '{}' WHERE id = '33333333-3333-4333-8333-333333333333';"
reject "the application role cannot change a rider's status" "permission denied" \
  "SET LOCAL ROLE hg_app; UPDATE rider_profile SET account_status = 'BANNED' WHERE account_id = '$RIDER_FX';"
reject "the application role cannot change a customer's status" "permission denied" \
  "SET LOCAL ROLE hg_app; UPDATE account SET status = 'BANNED' WHERE id = '11111111-1111-4111-8111-111111111111';"
reject "the application role cannot delete a rider to create them again" "permission denied" \
  "SET LOCAL ROLE hg_app; DELETE FROM rider_profile WHERE account_id = '$RIDER_FX';"
reject "the application role cannot create an account in another state" "permission denied" \
  "SET LOCAL ROLE hg_app; INSERT INTO account (phone_e164, status) VALUES ('+16475550142', 'BANNED');"
reject "the application role cannot write the history" "permission denied" \
  "SET LOCAL ROLE hg_app;
   INSERT INTO account_state_event (subject_type, subject_id, action, from_state, to_state, reason_code,
                                    reason_text, actor_kind, system_actor)
   VALUES ('RESTAURANT','33333333-3333-4333-8333-333333333333','DELIST','LIVE','DELISTED',
           'HALAL_CERTIFICATE_EXPIRED','posing as the expiry','SYSTEM','HALAL_EXPIRY');"
reject "the application role cannot change who may take a transition" "permission denied" \
  "SET LOCAL ROLE hg_app;
   INSERT INTO account_state_rule VALUES ('RIDER','REINSTATE','BANNED','ACTIVE','ADMIN','rider.reinstate',NULL);"
reject "a staff action needs the access token of a live two-step session" "account_state_session_required" \
  "SET LOCAL ROLE hg_app;
   $APPLY('RIDER','$RIDER_FX','SUSPEND','$INV_ADMIN','OTHER','an account id is not a token','inv-no-session-01','\x00','{}','{}');"
reject "the application role cannot rewrite a session" "permission denied" \
  "SET LOCAL ROLE hg_app; UPDATE session SET account_id = '$INV_SUPER' WHERE id = '$INV_ADMIN_SESSION';"
reject "only a super admin lifts a ban" "account_state_actor_not_permitted" \
  "UPDATE rider_profile SET account_status = 'BANNED' WHERE account_id = '$RIDER_FX';
   SET LOCAL ROLE hg_app;
   $APPLY('RIDER','$RIDER_FX','REINSTATE','$INV_ADMIN_TOKEN','APPEAL_UPHELD','an admin lifts a ban','inv-admin-unban-01','\x00','{}','{}');"
reject "listing a restaurant needs a current halal certificate" "account_state_halal_certificate_required" \
  "INSERT INTO restaurant (id, slug, legal_name, display_name, line1, city, province, postal_code, location,
                           onboarding_state, account_state)
   VALUES ('13000000-0000-4000-8000-0000000000a1', 'inv-uncertified', 'Uncertified Inc.', 'Uncertified',
           '1 King St', 'Toronto', 'ON', 'M5J0C3', ST_SetSRID(ST_MakePoint(-79.38, 43.65), 4326)::geography,
           'ACTIVE', 'DELISTED');
   SET LOCAL ROLE hg_app;
   $APPLY('RESTAURANT','13000000-0000-4000-8000-0000000000a1','REINSTATE','$INV_ADMIN_TOKEN','ISSUE_RESOLVED',
          'relisting with no certificate','inv-relist-uncert-1','\x00','{}','{}');"
reject "a system principal's function takes no rider" "account_state_subject_not_found" \
  "SET LOCAL ROLE hg_app; SELECT * FROM account_state_halal_expiry('$RIDER_FX');"
reject "a listed restaurant carries no delisting reason" "restaurant_live_has_no_delist_reasons" \
  "UPDATE restaurant SET delist_reasons = '{OTHER}' WHERE id = '33333333-3333-4333-8333-333333333333';"

echo
echo "13. Contract enums"
if python3 "$HERE/../tools/check_enums.py" >/tmp/hg_enum_check.txt 2>&1; then
  pass "every contract enum matches a pg type or is an explained exclusion"
  tail -2 /tmp/hg_enum_check.txt | head -1 | sed 's/^/     /'
else
  fail "contract enum check" "$(tail -5 /tmp/hg_enum_check.txt | tr '\n' ' ')"
fi

echo
printf 'passed %d, failed %d\n\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
