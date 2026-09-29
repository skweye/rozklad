import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { createD1Store } from '../server/d1-store.mjs';
import { collectRecords, toImportSQL } from '../tools/netlify-export/export.mjs';
import worker from '../server/worker.mjs';

const schema = await readFile(new URL('../migrations/0001_site_records.sql', import.meta.url), 'utf8');
function database(t) {
    const sql = new DatabaseSync(':memory:'); sql.exec(schema);
    t.after(() => sql.close());
    return { sql, prepare(query) { return { bind(...args) { return {
        async first() { return sql.prepare(query).get(...args) || null; },
        async run() { return { success: true, meta: { changes: sql.prepare(query).run(...args).changes } }; }
    }; } }; } };
}

test('D1 stores isolate namespaces and reject stale/unguarded writes atomically', async t => {
    const db = database(t), a = createD1Store(db, 'site-permissions'), b = createD1Store(db, 'site-presence');
    assert.equal(await a.get('grants-v1'), null);
    assert.equal((await a.setJSON('grants-v1', { users: [] }, { onlyIfNew: true })).modified, true);
    assert.equal((await a.setJSON('grants-v1', { users: ['wrong'] }, { onlyIfNew: true })).modified, false);
    assert.equal(await b.get('grants-v1'), null);
    const { etag } = await a.getWithMetadata('grants-v1');
    const results = await Promise.all([a.setJSON('grants-v1', { saved: 1 }, { onlyIfMatch: etag }), a.setJSON('grants-v1', { saved: 2 }, { onlyIfMatch: etag })]);
    assert.equal(results.filter(r => r.modified).length, 1);
    assert.deepEqual(await a.get('grants-v1'), { saved: 1 });
    assert.notEqual((await a.getWithMetadata('grants-v1')).etag, etag);
    await assert.rejects(a.setJSON('grants-v1', {}), /conditional_write_required/);
    const key = "x'); DROP TABLE site_records; --";
    await a.setJSON(key, { text: 'Українська' }, { onlyIfNew: true });
    assert.equal((await a.get(key)).text, 'Українська');
    assert.throws(() => createD1Store(db, 'unknown'), /storage_unavailable/);
});

test('one-time export reads every page and preserves private author IDs but not presence', async t => {
    const visited = [];
    const records = await collectRecords(options => {
        visited.push(options.name);
        assert.equal(options.consistency, 'strong');
        return {
            async *list() { yield { blobs: [{ key: options.name === 'site-permissions' ? 'grants-v1' : '2026-09' }] }; if (options.name === 'schedule-replacements') yield { blobs: [{ key: '2026-10' }] }; },
            async get(key) { return { key, text: "П'ять; DROP TABLE site_records; --", _actor: 'private-author', revision: 'original' }; }
        };
    }, { siteID: 'test', token: 'not-real' });
    assert.deepEqual(visited, ['schedule-replacements', 'site-permissions']);
    assert.equal(records.length, 3);
    const db = database(t);
    db.sql.exec(toImportSQL(records));
    const store = createD1Store(db, 'schedule-replacements');
    assert.deepEqual(await store.get('2026-09'), records[0].data);
    const original = await store.getWithMetadata('2026-09');
    await store.setJSON('2026-09', { newer: true }, { onlyIfMatch: original.etag });
    db.sql.exec(toImportSQL(records));
    assert.deepEqual(await store.get('2026-09'), { newer: true }, 'Re-import cannot overwrite newer edits');
});

test('Cloudflare entry routes assets separately and fails closed for missing bindings/config', async () => {
    const response = await worker.fetch(new Request('https://study.example/reports/'), { ASSETS: { fetch: () => new Response('reports') } });
    assert.equal(await response.text(), 'reports');
    const unconfigured = await worker.fetch(new Request('https://study.example/api/auth/session'), {});
    assert.deepEqual(await unconfigured.json(), { configured: false, user: null });
    const unknown = await worker.fetch(new Request('https://study.example/api/not-a-route'), {});
    assert.equal(unknown.status, 404);
    assert.equal(unknown.headers.get('Cache-Control'), 'no-store');
    const unavailable = await worker.fetch(new Request('https://study.example/api/auth/replacements?from=2026-09-29&to=2026-09-30'), {});
    assert.ok(unavailable.status >= 400);
    assert.doesNotMatch(await unavailable.text(), /stack|SQL|DB|secret/);
});
