-- v0.66 — LOCAL FICTIONAL delivery-queue rehearsal only, with NO network sends.
-- Independent add-on for v0.63 booking + v0.65 notification tables.
-- Job state can change; all transition events are append-only.
PRAGMA foreign_keys=ON;

CREATE TABLE notification_queue_jobs (
 store_id TEXT NOT NULL,
 draft_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('WAITING','CLAIMED','RETRY','SIMULATED','SUPPRESSED','DEAD')),
 run_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 100),
 lease_owner TEXT,
 lease_token TEXT,
 lease_until TEXT,
 last_failure TEXT,
 finished_at TEXT,
 PRIMARY KEY(store_id,draft_id),
 FOREIGN KEY(store_id,draft_id) REFERENCES notification_drafts(store_id,draft_id),
 CHECK(expires_at > created_at),
 CHECK((state='CLAIMED' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
   OR (state<>'CLAIMED' AND lease_owner IS NULL AND lease_token IS NULL AND lease_until IS NULL))
) STRICT;

CREATE TABLE notification_queue_events (
 event_seq INTEGER PRIMARY KEY AUTOINCREMENT,
 store_id TEXT NOT NULL,
 draft_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('ENQUEUED','CLAIMED','RETRY_SCHEDULED','SIMULATED_ONLY','SUPPRESSED','DEAD')),
 attempt INTEGER NOT NULL CHECK(attempt>=0),
 event_at TEXT NOT NULL,
 worker_id TEXT,
 reason_code TEXT,
 FOREIGN KEY(store_id,draft_id) REFERENCES notification_queue_jobs(store_id,draft_id)
) STRICT;
CREATE INDEX idx_notification_queue_claim ON notification_queue_jobs(store_id,state,run_at,lease_until);
CREATE INDEX idx_notification_queue_audit ON notification_queue_events(store_id,draft_id,event_seq);
CREATE TRIGGER deny_notification_queue_event_update BEFORE UPDATE ON notification_queue_events
 BEGIN SELECT RAISE(ABORT,'queue event immutable'); END;
CREATE TRIGGER deny_notification_queue_event_delete BEFORE DELETE ON notification_queue_events
 BEGIN SELECT RAISE(ABORT,'queue event immutable'); END;
