import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { createReportsService } from '../server/lib/reports.mjs';
import { createAuthHandler } from '../server/lib/auth.mjs';
import vm from 'node:vm';

const schema = await readFile(new URL('../migrations/0002_account_reports.sql', import.meta.url), 'utf8');
function fixture(t) {
    const sql = new DatabaseSync(':memory:'); sql.exec(schema); t.after(() => sql.close());
    let failBatch = false;
    const db = { prepare(query) { return { bind(...args) { return { query, args,
        async all() { return { results: sql.prepare(query).all(...args) }; }
    }; } }; }, async batch(statements) {
        sql.exec('BEGIN');
        try {
            const results = statements.map(({ query, args }, index) => {
                if (failBatch && index === 3) throw new Error('storage');
                return { success: true, meta: { changes: sql.prepare(query).run(...args).changes } };
            }); sql.exec('COMMIT'); return results;
        } catch (error) { sql.exec('ROLLBACK'); throw error; }
    } };
    return { sql, db, service: createReportsService({ db }), fail() { failBatch = true; } };
}
const record = (id = 'report-1', revision = 1, text = 'Текст') => ({ id, revision, title: 'Лабораторна №5', state: { studentName: 'Студент', tasks: [{ kind: 'text', text }] } });
const save = (service, owner, item, expected = item.revision - 1) => service.commit(owner, { writes: [{ record: item, expected }], activateId: item.id });

test('account reports persist text and images across devices and isolate identical report IDs by owner', async t => {
    const { service, db } = fixture(t);
    const a = record(); a.state.tasks.push({ kind: 'image', dataUrl: 'data:image/png;base64,' + 'a'.repeat(700000) });
    await save(service, 'google-a', a);
    await save(service, 'google-b', record('report-1', 1, 'Інший акаунт'));
    const otherDevice = createReportsService({ db });
    assert.deepEqual((await otherDevice.list('google-a')).items[0].state, a.state);
    assert.equal((await otherDevice.list('google-b')).items[0].state.tasks[0].text, 'Інший акаунт');
    assert.equal((await service.list('google-c')).items.length, 0);
});

test('browser repository restores the same account on a fresh device and preserves conflicts', async t => {
    const { service } = fixture(t);
    const source = await readFile(new URL('../reports/drafts-store.js', import.meta.url), 'utf8');
    const window = { crypto: { randomUUID: () => 'browser-report' }, studyAuth: {
        reportsRequest: (owner, data) => data ? service.commit(owner, data) : service.list(owner)
    } };
    vm.runInNewContext(source, { window });
    const store = window.ReportDraftStore;
    const device = async owner => store.createLibrary(await store.openAccountRepository(owner));
    const first = await device('a'); await first.save(record().state, 'Моя робота');
    const second = await device('a'); await second.restore();
    assert.equal(second.current().title, 'Моя робота');
    const other = await device('b'); assert.equal(await other.restore(), null);
    await first.save({ ...record().state, labTheme: 'Нова версія' });
    await assert.rejects(second.save(record().state), /draft_conflict/);
    assert.equal((await service.list('a')).items[0].state.labTheme, 'Нова версія');
});

test('stale devices cannot overwrite newer revisions; a failing batch preserves every part', async t => {
    const f = fixture(t);
    await save(f.service, 'a', record());
    const competing = await Promise.allSettled([save(f.service, 'a', record('report-1', 2, 'Device one')), save(f.service, 'a', record('report-1', 2, 'Device two'))]);
    assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
    await assert.rejects(save(f.service, 'a', record('report-1', 2)), /draft_conflict/);
    const previous = await f.service.list('a'); f.fail();
    await assert.rejects(save(f.service, 'a', record('report-1', 3, 'Failed update')), /storage/);
    assert.deepEqual(await f.service.list('a'), previous);
});

test('delete and switching are atomic, with no leftover image chunks and no cross-account deletion', async t => {
    const { service, sql } = fixture(t);
    await save(service, 'a', record());
    await save(service, 'b', record());
    await assert.rejects(service.commit('a', { removeId: 'report-1' }), /draft_active/);
    await save(service, 'a', record('report-2'));
    await service.commit('a', { removeId: 'report-1' });
    assert.equal((await service.list('a')).items.length, 1);
    assert.equal((await service.list('b')).items.length, 1);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM account_report_parts WHERE owner = ? AND report_id = ?').get('a', 'report-1').n, 0);
    await assert.rejects(save(service, 'a', { ...record('bad id'), title: 'bad' }), /reports_invalid/);
});

test('report endpoints require signed-in owner, pinned account and CSRF; owner comes only from session', async t => {
    const { service } = fixture(t);
    const origin = 'https://test.example';
    const handler = createAuthHandler({ reports: service, env: { AUTH_SITE_ORIGIN: origin,
        GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com', AUTH_SESSION_SECRET: 'test-secret-at-least-32-characters-long' },
        verifyGoogle: async nonce => ({ sub: 'verified-owner', email: 'student@example.com', name: 'Студент', email_verified: true, nonce }) });
    const jar = new Map();
    async function request(action, options = {}) {
        const response = await handler(new Request(`${origin}/api/auth/${action}`, { ...options, headers: {
            cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; '), ...options.headers } }));
        for (const cookie of response.headers.getSetCookie()) { const [key, value] = cookie.split(';')[0].split('='); if (value) jar.set(key, value); else jar.delete(key); }
        return response;
    }
    assert.equal((await request('reports')).status, 401);
    let session = await (await request('session')).json();
    assert.equal((await request('google', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-csrf-token': session.csrf }, body: JSON.stringify({ credential: session.nonce }) })).status, 200);
    session = await (await request('session')).json();
    const headers = { origin, 'content-type': 'application/json', 'x-report-account': 'verified-owner' };
    const body = JSON.stringify({ owner: 'victim', writes: [{ record: record(), expected: 0 }], activateId: 'report-1' });
    assert.equal((await request('reports', { method: 'POST', headers, body })).status, 403);
    assert.equal((await request('reports', { headers: { 'x-report-account': 'victim' } })).status, 409);
    const saved = await request('reports', { method: 'POST', headers: { ...headers, 'x-csrf-token': session.csrf }, body });
    assert.equal(saved.status, 200);
    assert.equal((await service.list('victim')).items.length, 0);
    assert.equal((await service.list('verified-owner')).items.length, 1);
    const read = await request('reports', { headers });
    assert.equal(read.status, 200); assert.match(read.headers.get('cache-control'), /no-store/);
    assert.equal((await read.json()).items.length, 1);
});
