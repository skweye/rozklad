-- Namespace isolation and atomic etag checks preserve the existing service contracts.
CREATE TABLE IF NOT EXISTS site_records (
    namespace TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL CHECK (json_valid(value)),
    etag TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (namespace, key)
);
