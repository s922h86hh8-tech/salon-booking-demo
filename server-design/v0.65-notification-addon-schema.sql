-- v0.65: FICTIONAL notification extension for a v0.63 local test-only booking DB.
-- Separate add-on: never alter/drop original booking, move, audit or account tables.
-- No real LINE tokens, addresses, messages, personal data or outside communication.
PRAGMA foreign_keys=ON;

CREATE TABLE notification_consent_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id TEXT NOT NULL,
  customer_subject_id TEXT NOT NULL CHECK(length(customer_subject_id) BETWEEN 1 AND 128),
  purpose TEXT NOT NULL CHECK(purpose IN ('reminder','return','waitlist')),
  allowed INTEGER NOT NULL CHECK(allowed IN (0,1)),
  actor_subject_id TEXT NOT NULL,
  obtained_via TEXT NOT NULL CHECK(obtained_via='FICTIONAL_SELF_SERVICE'),
  recorded_at TEXT NOT NULL,
  FOREIGN KEY(store_id) REFERENCES stores(store_id),
  CHECK(actor_subject_id=customer_subject_id)
) STRICT;
CREATE INDEX idx_notify_consent_latest ON notification_consent_events
(store_id,customer_subject_id,purpose,seq DESC);

CREATE TABLE notification_mock_visits (
  store_id TEXT NOT NULL,
  customer_subject_id TEXT NOT NULL,
  visited_date TEXT NOT NULL CHECK(length(visited_date)=10),
  record_kind TEXT NOT NULL CHECK(record_kind='FICTIONAL'),
  recorded_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(store_id,customer_subject_id,visited_date),
  FOREIGN KEY(store_id) REFERENCES stores(store_id)
) STRICT;

CREATE TABLE notification_waitlist_preferences (
  store_id TEXT NOT NULL,
  customer_subject_id TEXT NOT NULL,
  service_date TEXT NOT NULL,
  menu_id TEXT NOT NULL,
  staff_id TEXT,
  earliest_minute INTEGER NOT NULL CHECK(earliest_minute>=540 AND earliest_minute<=1080),
  latest_minute INTEGER NOT NULL CHECK(latest_minute>=540 AND latest_minute<=1080),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(store_id,customer_subject_id,service_date,menu_id),
  FOREIGN KEY(store_id) REFERENCES stores(store_id),
  CHECK(earliest_minute<=latest_minute)
) STRICT;

CREATE TABLE notification_drafts (
  store_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  customer_subject_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('reminder','return','waitlist')),
  subject_booking_id TEXT,
  idempotency_key TEXT NOT NULL,
  command_fingerprint TEXT NOT NULL,
  period_key TEXT NOT NULL,
  template_code TEXT NOT NULL CHECK(template_code IN ('REMINDER_GENERIC','RETURN_GENERIC','WAITLIST_GENERIC')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(store_id,draft_id),
  UNIQUE(store_id,idempotency_key),
  UNIQUE(store_id,customer_subject_id,purpose,period_key),
  FOREIGN KEY(store_id) REFERENCES stores(store_id),
  FOREIGN KEY(store_id,subject_booking_id) REFERENCES booking_records(store_id,booking_id)
) STRICT;
CREATE INDEX idx_notify_drafts_customer ON notification_drafts(store_id,customer_subject_id,purpose);

-- The only "dispatch" state is SIMULATED_ONLY. There is intentionally no
-- real 'SENT' state or LINE API/network implementation in this trial.
CREATE TABLE notification_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('DRAFT_CREATED','OWNER_APPROVED',
    'SIMULATED_ONLY','SUPPRESSED')),
  actor_subject_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE(store_id,draft_id,action),
  FOREIGN KEY(store_id,draft_id) REFERENCES notification_drafts(store_id,draft_id)
) STRICT;
CREATE INDEX idx_notify_events_date ON notification_events(store_id,recorded_at,action);

CREATE TRIGGER deny_notify_consent_update BEFORE UPDATE ON notification_consent_events
BEGIN SELECT RAISE(ABORT,'notify consent immutable'); END;
CREATE TRIGGER deny_notify_consent_delete BEFORE DELETE ON notification_consent_events
BEGIN SELECT RAISE(ABORT,'notify consent immutable'); END;
CREATE TRIGGER deny_notify_visit_update BEFORE UPDATE ON notification_mock_visits
BEGIN SELECT RAISE(ABORT,'notify visits immutable'); END;
CREATE TRIGGER deny_notify_visit_delete BEFORE DELETE ON notification_mock_visits
BEGIN SELECT RAISE(ABORT,'notify visits immutable'); END;
CREATE TRIGGER deny_notify_draft_update BEFORE UPDATE ON notification_drafts
BEGIN SELECT RAISE(ABORT,'notify drafts immutable'); END;
CREATE TRIGGER deny_notify_draft_delete BEFORE DELETE ON notification_drafts
BEGIN SELECT RAISE(ABORT,'notify drafts immutable'); END;
CREATE TRIGGER deny_notify_event_update BEFORE UPDATE ON notification_events
BEGIN SELECT RAISE(ABORT,'notify events immutable'); END;
CREATE TRIGGER deny_notify_event_delete BEFORE DELETE ON notification_events
BEGIN SELECT RAISE(ABORT,'notify events immutable'); END;
CREATE TRIGGER deny_notify_preference_delete BEFORE DELETE ON notification_waitlist_preferences
BEGIN SELECT RAISE(ABORT,'notify preference deletion not allowed in demo'); END;
