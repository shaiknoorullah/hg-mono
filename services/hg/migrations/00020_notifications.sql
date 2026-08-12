-- P-24..P-26 — notifications, devices, delivery attempts.
--
-- A notification is a row first and a delivery attempt second. Reading the
-- inbox is non-destructive: there is no code path that deletes a notification
-- on read, which is the direct replacement for the old Redis queue that
-- destroyed messages when anyone (including an impersonating socket) read them.

-- +goose Up

CREATE TABLE notification (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id     uuid NOT NULL REFERENCES account(id),
  role_context   text NOT NULL CHECK (role_context IN ('CUSTOMER', 'RESTAURANT', 'RIDER', 'ADMIN')),
  kind           text NOT NULL,
  dedupe_key     text,
  group_key      text,
  title          text NOT NULL,
  body           text NOT NULL,
  deep_link      text,
  data           jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority       notification_priority NOT NULL DEFAULT 'NORMAL',
  must_reach     boolean NOT NULL DEFAULT false,
  ack_window_s   int NOT NULL DEFAULT 60,
  order_id       uuid REFERENCES "order"(id),
  restaurant_id  uuid REFERENCES restaurant(id),
  read_at        timestamptz,
  dismissed_at   timestamptz,
  deadline_at    timestamptz,
  deadline_action text,
  escalation_step int NOT NULL DEFAULT 0,
  lease_until    timestamptz,
  lease_owner    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- must_reach notifications escalate on a clock until they land or alert.
  CONSTRAINT notification_must_reach_has_deadline CHECK (
    NOT must_reach OR deadline_at IS NOT NULL OR dismissed_at IS NOT NULL
  )
);
SELECT attach_updated_at('notification');
CREATE UNIQUE INDEX notification_dedupe ON notification (account_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
CREATE INDEX notification_inbox ON notification (account_id, created_at DESC)
  WHERE dismissed_at IS NULL;
CREATE INDEX notification_group ON notification (group_key) WHERE group_key IS NOT NULL;
CREATE INDEX notification_due ON notification (deadline_at) WHERE deadline_at IS NOT NULL;

CREATE TABLE notification_delivery (
  id                  bigserial PRIMARY KEY,
  notification_id     uuid NOT NULL REFERENCES notification(id) ON DELETE CASCADE,
  channel             notification_channel NOT NULL,
  target              text NOT NULL,                 -- device token id / phone / email (hashed in logs)
  provider            text,
  provider_message_id text,
  state               text NOT NULL DEFAULT 'QUEUED'
                      CHECK (state IN ('QUEUED', 'SENT', 'DELIVERED', 'ACKED', 'FAILED', 'SUPPRESSED')),
  suppress_reason     text,
  attempts            int NOT NULL DEFAULT 0,
  error_code          text,
  error_message       text,
  cost_cents          bigint,
  queued_at           timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz,
  settled_at          timestamptz
);
CREATE INDEX notification_delivery_pending ON notification_delivery (state, queued_at)
  WHERE state = 'QUEUED';
CREATE INDEX notification_delivery_notification ON notification_delivery (notification_id);
CREATE INDEX notification_delivery_cost ON notification_delivery (channel, queued_at)
  WHERE cost_cents IS NOT NULL;

CREATE TABLE device (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id      uuid NOT NULL REFERENCES account(id),
  device_id       text NOT NULL,
  role_context    text NOT NULL CHECK (role_context IN ('CUSTOMER', 'RESTAURANT', 'RIDER', 'ADMIN')),
  expo_push_token text NOT NULL,
  platform        device_platform NOT NULL,
  app_version     text,
  os_version      text,
  locale          locale_code NOT NULL DEFAULT 'en-CA',
  push_enabled    boolean NOT NULL DEFAULT true,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz
);
SELECT attach_updated_at('device');
CREATE UNIQUE INDEX device_unique ON device (account_id, device_id) WHERE revoked_at IS NULL;
CREATE INDEX device_token ON device (expo_push_token) WHERE revoked_at IS NULL;
-- I-25.1: a push token is never live against two accounts at once. A shared
-- phone must not receive the previous user's orders.
CREATE UNIQUE INDEX device_token_one_account ON device (expo_push_token) WHERE revoked_at IS NULL;

CREATE TABLE email_suppression (
  email      citext PRIMARY KEY,
  reason     text NOT NULL,
  source     text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS email_suppression;
DROP TABLE IF EXISTS device;
DROP TABLE IF EXISTS notification_delivery;
DROP TABLE IF EXISTS notification;
