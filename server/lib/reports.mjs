import { randomUUID } from 'node:crypto';

const MAX_REPORT_BYTES = 16 * 1024 * 1024;
const MAX_ACCOUNT_BYTES = 64 * 1024 * 1024;
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const problem = code => { throw new Error(code); };

export function createReportsService({ db, now = () => new Date().toISOString() }) {
    const statement = (query, ...args) => db.prepare(query).bind(...args);
    async function read(owner) {
        if (!db?.prepare) problem('reports_unavailable');
        // A single joined query gives a consistent snapshot of metadata and all parts.
        const { results } = await statement(`SELECT a.revision AS account_revision, a.active_id,
            r.id, r.revision, r.title, r.updated_at, p.part, p.value
            FROM report_accounts a LEFT JOIN account_reports r ON r.owner = a.owner
            LEFT JOIN account_report_parts p ON p.owner = r.owner AND p.report_id = r.id
            WHERE a.owner = ? ORDER BY r.id, p.part`, owner).all();
        const records = new Map();
        for (const row of results) {
            if (!row.id) continue;
            if (!records.has(row.id)) records.set(row.id, { id: row.id, revision: row.revision,
                title: row.title, updatedAt: row.updated_at, parts: [] });
            if (row.value !== null) records.get(row.id).parts.push(row.value);
        }
        const items = [...records.values()].map(({ parts, ...record }) => ({ ...record, state: JSON.parse(parts.join('')) }));
        return { revision: results[0]?.account_revision || 0, activeId: results[0]?.active_id || null, items };
    }
    return {
        async list(owner) { const { items, activeId } = await read(owner); return { items, activeId }; },
        async commit(owner, body) {
            if (!body || typeof body !== 'object' || !Array.isArray(body.writes || []) || (body.writes || []).length > 2) problem('reports_invalid');
            const { writes = [], activateId, loadId, removeId } = body;
            for (const id of [activateId, loadId, removeId]) if (id !== undefined && !validId(id)) problem('reports_invalid');
            const before = await read(owner), records = new Map(before.items.map(item => [item.id, item]));
            if (loadId && !records.has(loadId)) problem('draft_missing');
            if (removeId === before.activeId && removeId) problem('draft_active');
            const serialized = [], seen = new Set();
            for (const entry of writes) {
                const record = entry?.record, expected = entry?.expected;
                if (!record || !validId(record.id) || seen.has(record.id) || !Number.isSafeInteger(expected) || expected < 0
                    || record.revision !== expected + 1 || typeof record.title !== 'string' || record.title.length > 120
                    || !record.state || typeof record.state !== 'object' || Array.isArray(record.state)) problem('reports_invalid');
                seen.add(record.id);
                if ((records.get(record.id)?.revision || 0) !== expected) problem('draft_conflict');
                const value = JSON.stringify(record.state);
                if (Buffer.byteLength(value) > MAX_REPORT_BYTES) problem('reports_limit');
                const next = { id: record.id, revision: record.revision, title: record.title, updatedAt: now(), state: record.state };
                records.set(record.id, next); serialized.push({ record: next, value });
            }
            if (removeId) records.delete(removeId);
            const activeId = activateId || before.activeId;
            if (activeId && !records.has(activeId)) problem('draft_missing');
            if (records.size > 100 || [...records.values()].reduce((size, item) => size + Buffer.byteLength(JSON.stringify(item.state)), 0) > MAX_ACCOUNT_BYTES) problem('reports_limit');
            const token = randomUUID();
            const guard = 'EXISTS (SELECT 1 FROM report_accounts WHERE owner = ? AND commit_token = ?)';
            const batch = [
                statement('INSERT OR IGNORE INTO report_accounts (owner) VALUES (?)', owner),
                statement('UPDATE report_accounts SET revision = revision + 1, active_id = ?, commit_token = ? WHERE owner = ? AND revision = ?', activeId, token, owner, before.revision)
            ];
            for (const { record, value } of serialized) {
                batch.push(statement(`DELETE FROM account_report_parts WHERE owner = ? AND report_id = ? AND ${guard}`, owner, record.id, owner, token));
                batch.push(statement(`INSERT INTO account_reports (owner, id, revision, title, updated_at)
                    SELECT ?, ?, ?, ?, ? WHERE ${guard}
                    ON CONFLICT(owner, id) DO UPDATE SET revision = excluded.revision, title = excluded.title, updated_at = excluded.updated_at`,
                    owner, record.id, record.revision, record.title, record.updatedAt, owner, token));
                for (let offset = 0, part = 0; offset < value.length; part++) {
                    let end = Math.min(offset + 128 * 1024, value.length);
                    if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end--;
                    batch.push(statement(`INSERT INTO account_report_parts (owner, report_id, part, value) SELECT ?, ?, ?, ? WHERE ${guard}`,
                        owner, record.id, part, value.slice(offset, end), owner, token));
                    offset = end;
                }
            }
            if (removeId) {
                batch.push(statement(`DELETE FROM account_report_parts WHERE owner = ? AND report_id = ? AND ${guard}`, owner, removeId, owner, token));
                batch.push(statement(`DELETE FROM account_reports WHERE owner = ? AND id = ? AND ${guard}`, owner, removeId, owner, token));
            }
            // D1 batch is transactional. Every mutation is conditional on winning the
            // account revision, so a racing device cannot partially overwrite a report.
            const results = await db.batch(batch);
            if (results[1].meta.changes !== 1) problem('draft_conflict');
            return { loaded: loadId ? records.get(loadId) : null };
        }
    };
}
