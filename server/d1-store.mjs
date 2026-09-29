import { randomUUID } from 'node:crypto';

const namespaces = new Set(['schedule-replacements', 'site-permissions', 'site-presence']);

// D1 queries without the Sessions API use the primary, not an eventually consistent replica.
// Every write checks its revision in ONE SQL statement; there is no read-then-write race.
export function createD1Store(db, namespace) {
    if (!db?.prepare || !namespaces.has(namespace)) throw new Error('storage_unavailable');
    const getWithMetadata = async key => {
        const row = await db.prepare('SELECT value, etag FROM site_records WHERE namespace = ? AND key = ?').bind(namespace, key).first();
        return row ? { data: JSON.parse(row.value), etag: row.etag } : null;
    };
    return {
        getWithMetadata,
        async get(key) { return (await getWithMetadata(key))?.data ?? null; },
        async setJSON(key, data, options = {}) {
            const etag = randomUUID(), value = JSON.stringify(data), timestamp = Date.now();
            let statement;
            if (options.onlyIfNew === true && options.onlyIfMatch === undefined) {
                statement = db.prepare('INSERT INTO site_records (namespace, key, value, etag, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(namespace, key) DO NOTHING')
                    .bind(namespace, key, value, etag, timestamp);
            } else if (typeof options.onlyIfMatch === 'string' && !options.onlyIfNew) {
                statement = db.prepare('UPDATE site_records SET value = ?, etag = ?, updated_at = ? WHERE namespace = ? AND key = ? AND etag = ?')
                    .bind(value, etag, timestamp, namespace, key, options.onlyIfMatch);
            } else {
                throw new Error('conditional_write_required');
            }
            const result = await statement.run();
            if (!result.success) throw new Error('storage_unavailable');
            return { modified: result.meta.changes === 1, etag };
        }
    };
}
