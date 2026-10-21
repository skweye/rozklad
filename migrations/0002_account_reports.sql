-- Reports are private to the verified Google subject, never an email supplied by a client.
CREATE TABLE IF NOT EXISTS report_accounts (
    owner TEXT PRIMARY KEY,
    revision INTEGER NOT NULL DEFAULT 0,
    active_id TEXT,
    commit_token TEXT
);
CREATE TABLE IF NOT EXISTS account_reports (
    owner TEXT NOT NULL,
    id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    title TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (owner, id)
);
-- Small chunks allow reports with multiple images to exceed D1's per-row size limit.
CREATE TABLE IF NOT EXISTS account_report_parts (
    owner TEXT NOT NULL,
    report_id TEXT NOT NULL,
    part INTEGER NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (owner, report_id, part)
);
