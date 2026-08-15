-- Restaurant-scoped staff profile.
--
-- Deliberately NOT `staff_profile` (00005_staff_rbac.sql): that table backs
-- admin's platform-role-only /v1/admin/staff (listStaff), whose query joins
-- `staff_profile` unconditionally and derives `role` from a GLOBAL-scope
-- account_role subquery. Reusing it here would (and, in a first pass, did)
-- leak RESTAURANT_STAFF accounts into the platform staff list with role=NULL
-- — the schema requires a non-null Role, so listStaff started 500ing/failing
-- validation as soon as a restaurant staff account existed. Same "one account
-- per human, roles as grants" model, deliberately separate table so the two
-- audiences (platform staff vs. a restaurant's own roster) can never bleed
-- into each other's list query by construction.

-- +goose Up

CREATE TABLE restaurant_staff_profile (
  account_id   uuid PRIMARY KEY REFERENCES account(id),
  full_name    text NOT NULL,
  status       staff_status NOT NULL DEFAULT 'INVITED',
  last_login_at timestamptz,
  created_by   uuid REFERENCES account(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
SELECT attach_updated_at('restaurant_staff_profile');

-- +goose Down
DROP TABLE IF EXISTS restaurant_staff_profile;
