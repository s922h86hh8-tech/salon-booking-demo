-- v0.63: isolated local-only SQLite prototype with atomic reservation moves for shared reservation finalization.
-- Fictional data exclusively; no live customer booking, payment or identity service.
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=3000;
PRAGMA journal_mode=WAL;

CREATE TABLE stores (
  store_id TEXT PRIMARY KEY CHECK(length(store_id) BETWEEN 1 AND 100)
) STRICT;

CREATE TABLE staff_memberships (
  store_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','manager','receptionist')),
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  PRIMARY KEY(store_id,subject_id),
  FOREIGN KEY(store_id) REFERENCES stores(store_id)
) STRICT;

-- Future configuration versioning must be designed before any real changes.
CREATE TABLE day_configurations (
  store_id TEXT NOT NULL,
  service_date TEXT NOT NULL CHECK(length(service_date)=10),
  config_json TEXT NOT NULL CHECK(json_valid(config_json)),
  PRIMARY KEY(store_id,service_date),
  FOREIGN KEY(store_id) REFERENCES stores(store_id)
) STRICT;

-- Original reservation rows are immutable, including the identity, course,
-- resource, date, confirmed time and source. Cancellation is a separate event.
CREATE TABLE booking_records (
  store_id TEXT NOT NULL,
  service_date TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  owner_subject_id TEXT NOT NULL,
  menu_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  bed_id TEXT NOT NULL,
  start_minute INTEGER NOT NULL CHECK(start_minute BETWEEN 540 AND 1080 AND start_minute%15=0),
  prep_minutes INTEGER NOT NULL CHECK(prep_minutes>=0),
  source TEXT NOT NULL CHECK(source IN ('website','phone','instore','hpb','line','google','other','unknown')),
  discovery TEXT NOT NULL CHECK(discovery IN ('google','sns','referral','hpb','line','storefront','other','unknown')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(store_id,booking_id),
  FOREIGN KEY(store_id,service_date) REFERENCES day_configurations(store_id,service_date)
) STRICT;

CREATE TABLE booking_cancellations (
  store_id TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  canceled_by_subject_id TEXT NOT NULL,
  canceled_at TEXT NOT NULL,
  cancellation_reason TEXT NOT NULL DEFAULT 'CANCEL' CHECK(cancellation_reason IN ('CANCEL','MOVE')),
  PRIMARY KEY(store_id,booking_id),
  FOREIGN KEY(store_id,booking_id) REFERENCES booking_records(store_id,booking_id)
) STRICT;

-- Uniqueness for each actor/operation/key; fingerprint detects changed retries.
CREATE TABLE booking_commands (
  store_id TEXT NOT NULL,
  actor_subject_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('RESERVE','CANCEL','MOVE')),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 128),
  fingerprint TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(store_id,actor_subject_id,operation,idempotency_key),
  FOREIGN KEY(store_id,booking_id) REFERENCES booking_records(store_id,booking_id)
) STRICT;

CREATE TABLE booking_audit_events (
  event_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('BOOKING_CONFIRMED','BOOKING_CANCELLED','BOOKING_MOVED_FROM','BOOKING_MOVED_TO')),
  actor_subject_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('customer','staff')),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY(store_id,booking_id) REFERENCES booking_records(store_id,booking_id)
) STRICT;


-- Each move links an immutable original to its new booking. Chained moves are
-- supported by moving the resulting reservation in a later transaction.
CREATE TABLE booking_moves (
  store_id TEXT NOT NULL,
  from_booking_id TEXT NOT NULL,
  to_booking_id TEXT NOT NULL,
  moved_by_subject_id TEXT NOT NULL,
  moved_at TEXT NOT NULL,
  PRIMARY KEY(store_id,from_booking_id),
  UNIQUE(store_id,to_booking_id),
  CHECK(from_booking_id<>to_booking_id),
  FOREIGN KEY(store_id,from_booking_id) REFERENCES booking_records(store_id,booking_id),
  FOREIGN KEY(store_id,to_booking_id) REFERENCES booking_records(store_id,booking_id)
) STRICT;

CREATE TRIGGER booking_move_must_match_owner_and_cancellation
BEFORE INSERT ON booking_moves
WHEN
  NOT EXISTS(
    SELECT 1 FROM booking_cancellations c WHERE c.store_id=NEW.store_id
     AND c.booking_id=NEW.from_booking_id AND c.cancellation_reason='MOVE'
  ) OR
  EXISTS(
    SELECT 1 FROM booking_cancellations c WHERE c.store_id=NEW.store_id
     AND c.booking_id=NEW.to_booking_id
  ) OR
  (SELECT owner_subject_id FROM booking_records WHERE store_id=NEW.store_id
   AND booking_id=NEW.from_booking_id) IS NOT
  (SELECT owner_subject_id FROM booking_records WHERE store_id=NEW.store_id
   AND booking_id=NEW.to_booking_id)
BEGIN SELECT RAISE(ABORT,'invalid booking move lineage'); END;

CREATE INDEX idx_moves_to_booking ON booking_moves(store_id,to_booking_id);

CREATE INDEX idx_bookings_calendar ON booking_records(store_id,service_date,start_minute);
CREATE INDEX idx_audit_booking ON booking_audit_events(store_id,booking_id,event_seq);

CREATE TRIGGER deny_day_config_update BEFORE UPDATE ON day_configurations
BEGIN SELECT RAISE(ABORT,'demo day configuration immutable'); END;
CREATE TRIGGER deny_day_config_delete BEFORE DELETE ON day_configurations
BEGIN SELECT RAISE(ABORT,'demo day configuration immutable'); END;
CREATE TRIGGER deny_booking_update BEFORE UPDATE ON booking_records
BEGIN SELECT RAISE(ABORT,'booking original immutable'); END;
CREATE TRIGGER deny_booking_delete BEFORE DELETE ON booking_records
BEGIN SELECT RAISE(ABORT,'booking original immutable'); END;
CREATE TRIGGER deny_cancellation_update BEFORE UPDATE ON booking_cancellations
BEGIN SELECT RAISE(ABORT,'cancellation immutable'); END;
CREATE TRIGGER deny_cancellation_delete BEFORE DELETE ON booking_cancellations
BEGIN SELECT RAISE(ABORT,'cancellation immutable'); END;
CREATE TRIGGER deny_command_update BEFORE UPDATE ON booking_commands
BEGIN SELECT RAISE(ABORT,'booking command immutable'); END;
CREATE TRIGGER deny_command_delete BEFORE DELETE ON booking_commands
BEGIN SELECT RAISE(ABORT,'booking command immutable'); END;
CREATE TRIGGER deny_booking_audit_update BEFORE UPDATE ON booking_audit_events
BEGIN SELECT RAISE(ABORT,'booking audit immutable'); END;
CREATE TRIGGER deny_booking_audit_delete BEFORE DELETE ON booking_audit_events
BEGIN SELECT RAISE(ABORT,'booking audit immutable'); END;

CREATE TRIGGER deny_move_update BEFORE UPDATE ON booking_moves
BEGIN SELECT RAISE(ABORT,'booking move immutable'); END;
CREATE TRIGGER deny_move_delete BEFORE DELETE ON booking_moves
BEGIN SELECT RAISE(ABORT,'booking move immutable'); END;
