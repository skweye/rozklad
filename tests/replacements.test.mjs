import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthHandler } from '../server/lib/auth.mjs';
import { createReplacementService } from '../server/lib/replacements.mjs';
import { isMainAdmin } from '../server/lib/permissions.mjs';

const owner = 'ym_hryzhenko_081205@dtsepaton.ukr.education';
const origin = 'https://schedule-test.example';
const base = { 1: [{ common: { s: 'Бази даних', t: 'Викладач', r: '205', link: 'https://example.com' } }],
    2: [{ num: [{ s: 'Іноземна мова', g: 'I', t: 'A' }, { s: 'Іноземна мова', g: 'II', t: 'B' }], den: { s: 'ООП' } }] };
const mutation = (extra = {}) => ({ operation: 'set', date: '2026-09-24', index: 0, revision: null, source: { day: 1, index: 0, variant: 'common' }, ...extra });
function memoryStore() {
    const data = new Map(); let version = 0, writes = 0;
    return {
        data, get writes() { return writes; },
        async get(key) { return structuredClone(data.get(key)?.data ?? null); },
        async getWithMetadata(key) { return structuredClone(data.get(key) ?? null); },
        async setJSON(key, value, options) {
            const saved = data.get(key);
            if ((options.onlyIfNew && saved) || (options.onlyIfMatch && saved?.etag !== options.onlyIfMatch)) return { modified: false };
            writes++; const etag = String(++version); data.set(key, { data: structuredClone(value), etag }); return { modified: true, etag };
        }
    };
}
function fixture(email = owner, sharedStore) {
    let timestamp = Date.parse('2026-09-24T07:00:00Z');
    const env = { AUTH_SITE_ORIGIN: origin, GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com', AUTH_SESSION_SECRET: 'secret-only-for-unit-tests-123456789012345678' };
    const store = sharedStore || memoryStore(), jar = new Map();
    const service = createReplacementService({ getStore: () => store, schedule: base, now: () => timestamp });
    const handler = createAuthHandler({ env, replacements: service, now: () => timestamp,
        verifyGoogle: async nonce => ({ sub: `google-subject:${email}`, name: 'Адміністратор', email, email_verified: true, nonce }) });
    const request = async (action, options = {}) => {
        const response = await handler(new Request(`${origin}/api/auth/${action}`, {
            ...options, headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...options.headers }
        }));
        for (const cookie of response.headers.getSetCookie()) {
            const [name, value] = cookie.split(';')[0].split('=');
            if (value) jar.set(name, value); else jar.delete(name);
        }
        return response;
    };
    const session = async () => (await request('session')).json();
    const write = async (body, headers = {}) => {
        const challenge = await session();
        return request('replacements', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-csrf-token': challenge.csrf, ...headers }, body: JSON.stringify(body) });
    };
    return { env, store, service, handler, request, session, write, jar,
        advance(seconds) { timestamp += seconds * 1000; },
        async login() {
            const challenge = await session();
            const response = await request('google', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-csrf-token': challenge.csrf }, body: JSON.stringify({ credential: challenge.nonce }) });
            assert.equal(response.status, 200);
        }
    };
}

test('server main admin defaults to owner, normalizes case and supports revocation', async () => {
    assert.equal(isMainAdmin({ email: owner.toUpperCase() }, {}), true);
    assert.equal(isMainAdmin({ email: owner + '.evil', admin: true }, {}), false);
    assert.equal(isMainAdmin({ email: owner }, { SCHEDULE_ADMIN_EMAILS: '' }), false);
    const f = fixture(); await f.login();
    assert.equal((await f.session()).scheduleAdmin, true);
    f.env.SCHEDULE_ADMIN_EMAILS = 'other@example.com';
    assert.equal((await f.session()).scheduleAdmin, false);
    assert.equal((await f.write(mutation())).status, 403);
    assert.equal(f.store.writes, 0);
});

test('guests, ordinary users, forged roles, tampered and expired sessions cannot write', async () => {
    const guest = fixture();
    assert.equal((await guest.write(mutation({ admin: true, email: owner }))).status, 401);
    const student = fixture('student@example.com'); await student.login();
    assert.equal((await student.session()).scheduleAdmin, false);
    assert.equal((await student.write(mutation({ scheduleAdmin: true, user: { email: owner } }))).status, 403);
    student.jar.set('__Host-study-session', student.jar.get('__Host-study-session') + 'x');
    assert.equal((await student.write(mutation())).status, 401);
    const expired = fixture(); await expired.login(); expired.advance(86401);
    assert.equal((await expired.write(mutation())).status, 401);
    assert.equal(guest.store.writes + student.store.writes + expired.store.writes, 0);
});

test('writes require origin, CSRF, JSON and the configured host even for the owner', async () => {
    const f = fixture(); await f.login();
    for (const headers of [{ origin: 'https://evil.example' }, { origin: '' }, { 'x-csrf-token': 'wrong' }]) {
        assert.equal((await f.write(mutation(), headers)).status, 403);
    }
    assert.equal((await f.write(mutation(), { 'content-type': 'text/plain' })).status, 400);
    assert.equal((await f.handler(new Request('https://preview.example/api/auth/replacements', { method: 'POST' }))).status, 403);
    assert.equal((await f.request('replacements', { method: 'DELETE' })).status, 405);
    assert.equal(f.store.writes, 0);
});

test('owner publishes a trusted date-specific pair; guests see it without Google or private data', async () => {
    const f = fixture(); await f.login();
    const result = await f.write(mutation({ lesson: { s: '<script>attack</script>' }, email: owner }));
    assert.equal(result.status, 200);
    const { replacement } = await result.json();
    assert.equal(replacement.lesson.s, 'Бази даних');
    assert.ok(replacement.revision);
    const anonymous = await f.handler(new Request(`${origin}/api/auth/replacements?from=2026-09-21&to=2026-10-08`));
    assert.equal(anonymous.status, 200);
    assert.match(anonymous.headers.get('cache-control'), /no-store/);
    const data = await anonymous.json();
    assert.equal(data.replacements.length, 1);
    assert.doesNotMatch(JSON.stringify(data), /email|token|script|example\.com/);
    assert.equal(base[1][0].common.s, 'Бази даних');
    f.env.GOOGLE_CLIENT_ID = ''; // public reads do not depend on login configuration
    assert.equal((await f.handler(new Request(`${origin}/api/auth/replacements?from=2026-09-21&to=2026-10-08`))).status, 200);
});

test('a window is a published, revision-protected replacement; it can be edited or cancelled', async () => {
    const f = fixture(); await f.login();
    const response = await f.write(mutation({ source: { kind: 'window' }, lesson: { s: 'forged subject' } }));
    assert.equal(response.status, 200);
    const created = await response.json();
    assert.equal(created.replacement.lesson, null);
    assert.deepEqual(created.replacement.source, { kind: 'window' });
    const publicList = await (await f.handler(new Request(`${origin}/api/auth/replacements?from=2026-09-21&to=2026-10-08`))).json();
    assert.equal(publicList.replacements.length, 1);
    assert.equal(publicList.replacements[0].lesson, null);
    assert.ok(created.notificationId.endsWith(created.replacement.revision));
    assert.equal((await f.write(mutation({ source: { kind: 'window' } }))).status, 409);
    const regular = await (await f.write(mutation({ revision: created.replacement.revision }))).json();
    assert.equal(regular.replacement.lesson.s, 'Бази даних');
    const windowAgain = await (await f.write(mutation({ revision: regular.replacement.revision, source: { kind: 'window' } }))).json();
    const cancelled = await (await f.write(mutation({ operation: 'remove', revision: windowAgain.replacement.revision }))).json();
    assert.equal(cancelled.replacement, null);
    assert.match(cancelled.notificationId, /removed:/);
    assert.equal((await f.service.list('2026-09-21', '2026-10-08')).replacements.length, 0);
    assert.equal(base[1][0].common.s, 'Бази даних');
    const guest = fixture(), student = fixture('student@example.com'); await student.login();
    assert.equal((await guest.write(mutation({ source: { kind: 'window' } }))).status, 401);
    assert.equal((await student.write(mutation({ source: { kind: 'window' } }))).status, 403);
});

test('date, index, source, revision and bounded date range are validated before writes', async () => {
    const f = fixture(); await f.login();
    for (const extra of [
        { date: '2026-09-23' }, { date: '2026-09-26' }, { date: '2026-02-30' }, { date: '../x' }, { date: '2028-01-03' },
        { index: -1 }, { index: 5 }, { index: '0' }, { operation: 'arbitrary' }, { revision: {} },
        { source: { day: 1, index: 0, variant: '__proto__' } }, { source: { day: 1, index: 4, variant: 'common' } }, { source: null },
        { source: { kind: 'window', day: 1 } }, { source: { kind: 'arbitrary' } }
    ]) assert.equal((await f.write(mutation(extra))).status, 400, JSON.stringify(extra));
    for (const query of ['', '?from=2026-09-21&to=2026-12-31', '?from=2026-09-21&to=2026-09-20', '?from=2020-01-01&to=2020-01-02']) {
        assert.equal((await f.request('replacements' + query)).status, 400);
    }
    assert.equal(f.store.writes, 0);
});

test('editing/removal require current revision and preserve adjacent dates and split groups', async () => {
    const f = fixture();
    const first = await f.service.change(mutation());
    const second = await f.service.change(mutation({ date: '2026-09-25', source: { day: 2, index: 0, variant: 'num' } }));
    assert.equal(second.replacement.lesson.length, 2);
    await assert.rejects(f.service.change(mutation()), /replacement_conflict/);
    await assert.rejects(f.service.change(mutation({ operation: 'remove' })), /replacement_conflict/);
    const edited = await f.service.change(mutation({ revision: first.replacement.revision, source: { day: 2, index: 0, variant: 'den' } }));
    assert.equal(edited.replacement.lesson.s, 'ООП');
    await f.service.change(mutation({ operation: 'remove', revision: edited.replacement.revision }));
    const rows = (await f.service.list('2026-09-21', '2026-10-08')).replacements;
    assert.equal(rows.length, 1); assert.equal(rows[0].date, '2026-09-25');
});

test('conditional writes retain simultaneous changes to different pairs and reject the same-pair race', async () => {
    const f = fixture();
    await Promise.all([f.service.change(mutation()), f.service.change(mutation({ index: 1 }))]);
    assert.equal((await f.service.list('2026-09-21', '2026-09-25')).replacements.length, 2);
    const results = await Promise.allSettled([f.service.change(mutation({ index: 2 })), f.service.change(mutation({ index: 2 }))]);
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
    assert.match(results.find(item => item.status === 'rejected').reason.message, /replacement_conflict/);
});

test('storage failures do not report success or expose server details', async () => {
    const f = fixture(); await f.login();
    f.store.getWithMetadata = async () => { throw new Error('private provider credentials'); };
    const response = await f.write(mutation());
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'replacements_unavailable' });
    assert.equal(f.store.writes, 0);
});

test('date validation uses Kyiv midnight, not the server UTC date', async () => {
    const store = memoryStore();
    const service = createReplacementService({ schedule: base, getStore: () => store, now: () => Date.parse('2026-09-24T21:30:00Z') });
    await assert.rejects(service.change(mutation()), /replacement_invalid/);
    await service.change(mutation({ date: '2026-09-25' }));
});

test('only the authenticated author suppresses their revision across devices; identity metadata stays private', async () => {
    const author = fixture(); await author.login();
    const result = await (await author.write(mutation({ _actor: 'forged-client-value' }))).json();
    const id = result.notificationId;
    assert.equal(id, `2026-09-24/0@${result.replacement.revision}`);
    const query = 'replacements?from=2026-09-21&to=2026-10-08';
    const own = await (await author.request(query)).json();
    assert.deepEqual(own.suppressedNotificationIds, [id]);
    const otherDevice = fixture(owner, author.store); await otherDevice.login();
    assert.deepEqual((await (await otherDevice.request(query)).json()).suppressedNotificationIds, [id]);
    const anonymous = await (await author.handler(new Request(`${origin}/api/auth/${query}`))).json();
    assert.deepEqual(anonymous.suppressedNotificationIds, []);
    const other = fixture('other@example.com', author.store); await other.login();
    assert.deepEqual((await (await other.request(query)).json()).suppressedNotificationIds, []);
    assert.deepEqual(own.replacements, anonymous.replacements);
    const internal = (await author.store.get('2026-09'))['2026-09-24/0'];
    assert.ok(internal._actor); assert.notEqual(internal._actor, 'forged-client-value');
    for (const response of [own, anonymous, result]) {
        assert.doesNotMatch(JSON.stringify(response), /_actor|google-subject|ukr\.education/);
        assert.ok(!JSON.stringify(response).includes(internal._actor));
    }
    author.jar.set('__Host-study-session', author.jar.get('__Host-study-session') + 'bad');
    assert.deepEqual((await (await author.request(query)).json()).suppressedNotificationIds, []);
});

test('a second administrator edit belongs only to its actual author; cancellation and recreation preserve revision checks', async () => {
    const first = fixture(); await first.login();
    const created = await (await first.write(mutation())).json();
    const second = fixture('second@example.com', first.store);
    second.env.SCHEDULE_ADMIN_EMAILS = 'second@example.com'; await second.login();
    const edited = await (await second.write(mutation({ revision: created.replacement.revision }))).json();
    const query = 'replacements?from=2026-09-21&to=2026-10-08';
    assert.deepEqual((await (await first.request(query)).json()).suppressedNotificationIds, []);
    assert.deepEqual((await (await second.request(query)).json()).suppressedNotificationIds, [edited.notificationId]);
    const removed = await (await second.write(mutation({ operation: 'remove', revision: edited.replacement.revision }))).json();
    const after = await (await second.request(query)).json();
    assert.deepEqual(after.replacements, []);
    assert.deepEqual(after.suppressedNotificationIds, [`2026-09-24/0@removed:${edited.replacement.revision}`]);
    assert.equal(removed.notificationId, after.suppressedNotificationIds[0]);
    assert.deepEqual((await (await first.request(query)).json()).suppressedNotificationIds, []);
    assert.equal((await first.write(mutation({ revision: created.replacement.revision }))).status, 409);
    const recreated = await first.write(mutation()); assert.equal(recreated.status, 200);
    assert.equal((await (await second.request(query)).json()).replacements.length, 1);
});
