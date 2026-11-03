-- v0.59 LOCAL-ONLY SQLite transaction prototype. Fictional records only.
-- Not a production migration. No API, login, payments or real customer data.
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;

CREATE TABLE IF NOT EXISTS stores (
  store_id TEXT PRIMARY KEY NOT NULL,
  store_name TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0,1))
) STRICT;

CREATE TABLE IF NOT EXISTS store_memberships (
  store_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','receptionist','therapist')),
  staff_id TEXT,
  active INTEGER NOT NULL CHECK (active IN (0,1)),
  PRIMARY KEY (store_id,user_id),
  FOREIGN KEY (store_id) REFERENCES stores(store_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id)
) STRICT;

CREATE TABLE IF NOT EXISTS monthly_closings (
  store_id TEXT NOT NULL,
  closing_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  month TEXT NOT NULL CHECK (length(month)=7),
  original_total INTEGER NOT NULL CHECK (original_total>=0),
  PRIMARY KEY (store_id,closing_id),
  FOREIGN KEY (store_id) REFERENCES stores(store_id)
) STRICT;

CREATE TABLE IF NOT EXISTS closing_projections (
  store_id TEXT NOT NULL,
  closing_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version>=0),
  net_total INTEGER NOT NULL CHECK (net_total>=0),
  PRIMARY KEY (store_id,closing_id),
  FOREIGN KEY (store_id,closing_id) REFERENCES monthly_closings(store_id,closing_id)
) STRICT;

CREATE TABLE IF NOT EXISTS earnings_source_lines (
  store_id TEXT NOT NULL,
  closing_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  original_amount INTEGER NOT NULL CHECK (original_amount>=0),
  contract_version INTEGER NOT NULL CHECK (contract_version>=1),
  PRIMARY KEY (store_id,closing_id,source_id),
  FOREIGN KEY (store_id,closing_id) REFERENCES monthly_closings(store_id,closing_id)
) STRICT;

CREATE TABLE IF NOT EXISTS payment_records (
  store_id TEXT NOT NULL,
  closing_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount>0),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (store_id,payment_id),
  FOREIGN KEY (store_id,closing_id) REFERENCES monthly_closings(store_id,closing_id)
) STRICT;

CREATE TABLE IF NOT EXISTS correction_requests (
  store_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  closing_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('refund','correction')),
  delta INTEGER NOT NULL CHECK (delta<>0 AND delta BETWEEN -1000000 AND 1000000),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 5 AND 200),
  requested_by_user_id TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  expected_version INTEGER NOT NULL CHECK (expected_version>=0),
  source_before INTEGER NOT NULL CHECK (source_before>=0),
  month_before INTEGER NOT NULL CHECK (month_before>=0),
  paid_before INTEGER NOT NULL CHECK (paid_before>=0),
  PRIMARY KEY (store_id,request_id),
  FOREIGN KEY (store_id,closing_id,source_id)
    REFERENCES earnings_source_lines(store_id,closing_id,source_id),
  FOREIGN KEY (requested_by_user_id) REFERENCES users(user_id)
) STRICT;

CREATE TABLE IF NOT EXISTS correction_decisions (
  store_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('APPROVED','REJECTED','STALE')),
  reviewed_by_user_id TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY (store_id,request_id),
  FOREIGN KEY (store_id,request_id)
    REFERENCES correction_requests(store_id,request_id),
  FOREIGN KEY (reviewed_by_user_id) REFERENCES users(user_id)
) STRICT;

CREATE TABLE IF NOT EXISTS correction_adjustments (
  store_id TEXT NOT NULL,
  adjustment_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  closing_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  delta INTEGER NOT NULL CHECK (delta<>0),
  source_before INTEGER NOT NULL CHECK (source_before>=0),
  source_after INTEGER NOT NULL CHECK (source_after>=0),
  month_before INTEGER NOT NULL CHECK (month_before>=0),
  month_after INTEGER NOT NULL CHECK (month_after>=0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (store_id,adjustment_id),
  UNIQUE (store_id,request_id),
  FOREIGN KEY (store_id,request_id)
    REFERENCES correction_decisions(store_id,request_id),
  FOREIGN KEY (store_id,closing_id,source_id)
    REFERENCES earnings_source_lines(store_id,closing_id,source_id)
) STRICT;

CREATE TABLE IF NOT EXISTS audit_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  before_amount INTEGER NOT NULL,
  after_amount INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 5 AND 200),
  FOREIGN KEY (store_id,request_id)
    REFERENCES correction_requests(store_id,request_id),
  FOREIGN KEY (actor_user_id) REFERENCES users(user_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_requests_by_closing ON
 correction_requests(store_id,closing_id,requested_at);
CREATE INDEX IF NOT EXISTS idx_adjustments_by_source ON
 correction_adjustments(store_id,closing_id,source_id);
CREATE INDEX IF NOT EXISTS idx_payments_by_closing ON
 payment_records(store_id,closing_id);
CREATE INDEX IF NOT EXISTS idx_closing_by_staff ON
 monthly_closings(store_id,staff_id,month);
CREATE INDEX IF NOT EXISTS idx_audit_by_request ON
 audit_events(store_id,request_id,occurred_at);

-- A mistake or a direct SQL call cannot apply a rejected or pending proposal.
CREATE TRIGGER IF NOT EXISTS adjustments_only_after_approval
BEFORE INSERT ON correction_adjustments
WHEN COALESCE((
  SELECT status FROM correction_decisions
  WHERE store_id=NEW.store_id AND request_id=NEW.request_id
), '') <> 'APPROVED'
BEGIN
  SELECT RAISE(ABORT,'adjustment requires approved decision');
END;

-- Test prototype: originals, decisions, movements and audit events are append-only.
CREATE TRIGGER IF NOT EXISTS protect_closings_update BEFORE UPDATE ON monthly_closings
BEGIN SELECT RAISE(ABORT,'closing original is immutable'); END;
CREATE TRIGGER IF NOT EXISTS protect_closings_delete BEFORE DELETE ON monthly_closings
BEGIN SELECT RAISE(ABORT,'closing original is immutable'); END;
CREATE TRIGGER IF NOT EXISTS protect_sources_update BEFORE UPDATE ON earnings_source_lines
BEGIN SELECT RAISE(ABORT,'source original is immutable'); END;
CREATE TRIGGER IF NOT EXISTS protect_sources_delete BEFORE DELETE ON earnings_source_lines
BEGIN SELECT RAISE(ABORT,'source original is immutable'); END;
CREATE TRIGGER IF NOT EXISTS protect_payments_update BEFORE UPDATE ON payment_records
BEGIN SELECT RAISE(ABORT,'payment record is immutable'); END;
CREATE TRIGGER IF NOT EXISTS protect_payments_delete BEFORE DELETE ON payment_records
BEGIN SELECT RAISE(ABORT,'payment record is immutable'); END;
CREATE TRIGGER IF NOT EXISTS protect_requests_update BEFORE UPDATE ON correction_requests
BEGIN SELECT RAISE(ABORT,'request is immutable'); END;
CREATE TRIGGER IF NOT EXISTS protect_requests_delete BEFORE DELETE ON correction_requests
BEGIN SELECT RAISE(ABORT,'request is immutable'); END;
CREATE TRIGGER IF NOT EXISTS protect_decisions_update BEFORE UPDATE ON correction_decisions
BEGIN SELECT RAISE(ABORT,'decision is immutable'); END;
CREATE TRIGGER IF NOT EXISTS protect_decisions_delete BEFORE DELETE ON correction_decisions
BEGIN SELECT RAISE(ABORT,'decision is immutable'); END;
CREATE TRIGGER IF NOT EXISTS protect_adjustments_update BEFORE UPDATE ON correction_adjustments
BEGIN SELECT RAISE(ABORT,'adjustment is immutable'); END;
CREATE TRIGGER IF NOT EXISTS protect_adjustments_delete BEFORE DELETE ON correction_adjustments
BEGIN SELECT RAISE(ABORT,'adjustment is immutable'); END;
CREATE TRIGGER IF NOT EXISTS protect_audit_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT,'audit event is immutable'); END;
CREATE TRIGGER IF NOT EXISTS protect_audit_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT,'audit event is immutable'); END;
