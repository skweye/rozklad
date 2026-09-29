import test from 'node:test';
import assert from 'node:assert/strict';
import { createPermissionsService, mainAdminEmail, isMainAdmin, fullPermissions, noPermissions } from '../server/lib/permissions.mjs';
import { createAuthHandler } from '../server/lib/auth.mjs';
import { createReplacementService } from '../server/lib/replacements.mjs';

const origin = 'https://test.example', owner = 'owner@example.com', student = 'student@example.com';
function store() {
    const data = new Map(); let serial = 0;
    return {
        async get(key) { return structuredClone(data.get(key)?.data ?? null); },
        async getWithMetadata(key) { return structuredClone(data.get(key) ?? null); },
        async setJSON(key, value, options) {
            const previous = data.get(key);
            if (options.onlyIfNew && previous || options.onlyIfMatch && options.onlyIfMatch !== previous?.etag) return { modified: false };
            data.set(key, { data: structuredClone(value), etag: String(++serial) }); return { modified: true };
        }
    };
}
function fixture() {
    const env = { MAIN_ADMIN_EMAIL: owner, AUTH_SITE_ORIGIN: origin, GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com', AUTH_SESSION_SECRET: 'test-secret-at-least-thirty-two-characters' };
    const storage = store(), permissions = createPermissionsService({ getStore: () => storage, env });
    const replacements = createReplacementService({ getStore: () => storeForReplacements, schedule: { 1: [{ common: { s: 'Test' } }] }, now: () => Date.parse('2026-09-24T08:00:00Z') });
    const storeForReplacements = store();
    const client = email => {
        const jar = new Map();
        const handler = createAuthHandler({ env, permissions, replacements,
            verifyGoogle: async nonce => ({ sub: email, email, email_verified: true, name: email, nonce }) });
        const request = async (action, options = {}) => {
            const response = await handler(new Request(`${origin}/api/auth/${action}`, { ...options, headers: { cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; '), ...options.headers } }));
            response.headers.getSetCookie().forEach(cookie => { const [key, value] = cookie.split(';')[0].split('='); if (value) jar.set(key, value); else jar.delete(key); });
            return response;
        };
        const session = async () => (await request('session')).json();
        const post = async (action, body, headers = {}) => {
            const challenge = await session();
            return request(action, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-csrf-token': challenge.csrf, ...headers }, body: JSON.stringify(body) });
        };
        return { request, session, post, async login() { const challenge = await session(); assert.equal((await post('google', { credential: challenge.nonce })).status, 200); } };
    };
    const grant = async (email, rights) => permissions.change({ operation: 'save', email, permissions: { ...noPermissions(), ...rights }, revision: (await permissions.list()).revision });
    return { env, permissions, storage, client, grant };
}
const mutation = extra => ({ operation: 'set', date: '2026-09-24', index: 0, revision: null, source: { day: 1, index: 0, variant: 'common' }, ...extra });

test('exactly one main admin: explicit configuration wins; only first legacy email migrates', () => {
    assert.equal(mainAdminEmail({ MAIN_ADMIN_EMAIL: ' OWNER@example.com ', SCHEDULE_ADMIN_EMAILS: 'old@example.com' }), owner);
    assert.equal(mainAdminEmail({ SCHEDULE_ADMIN_EMAILS: 'first@example.com,second@example.com' }), 'first@example.com');
    assert.equal(isMainAdmin({ email: 'second@example.com' }, { SCHEDULE_ADMIN_EMAILS: 'first@example.com,second@example.com' }), false);
    assert.equal(isMainAdmin({ email: owner.toUpperCase() }, { MAIN_ADMIN_EMAIL: owner }), true);
    assert.equal(isMainAdmin({ email: owner }, { MAIN_ADMIN_EMAIL: '' }), false);
});

test('grants normalize email, protect owner and reject unknown/non-boolean permissions', async () => {
    const f = fixture();
    await f.grant(' STUDENT@EXAMPLE.COM ', { createReplacements: true });
    assert.deepEqual((await f.permissions.resolve({ email: student })).permissions, { ...noPermissions(), createReplacements: true });
    const data = await f.permissions.list();
    for (const extra of [{ email: owner }, { email: 'bad' }, { permissions: { ...fullPermissions(), mainAdmin: true } }, { permissions: { createReplacements: 'true' } }]) {
        await assert.rejects(f.permissions.change({ operation: 'save', email: student, revision: data.revision, permissions: fullPermissions(), ...extra }), /owner_protected|permissions_invalid/);
    }
    await f.grant(student, {});
    assert.equal((await f.permissions.list()).users.length, 0);
    assert.deepEqual((await f.permissions.resolve({ email: student })).permissions, noPermissions());
});

test('stale and simultaneous grants cannot overwrite each other', async () => {
    const f = fixture();
    const writes = await Promise.allSettled(['a@example.com', 'b@example.com'].map(email => f.permissions.change({ operation: 'save', email, revision: null, permissions: fullPermissions() })));
    assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(writes.find(result => result.status === 'rejected').reason.message, /permissions_conflict/);
    await assert.rejects(f.permissions.change({ operation: 'remove', email: 'a@example.com', revision: null }), /permissions_conflict/);
    assert.equal((await f.permissions.list()).users.length, 1);
});

test('only owner can read and manage rights; writes require CSRF and same origin', async () => {
    const f = fixture(), admin = f.client(owner), ordinary = f.client(student), guest = f.client('guest@example.com');
    await admin.login(); await ordinary.login(); await f.grant(student, fullPermissions());
    assert.equal((await guest.request('permissions')).status, 401);
    assert.equal((await ordinary.request('permissions')).status, 403);
    assert.equal((await ordinary.post('permissions', { mainAdmin: true })).status, 403);
    const data = await (await admin.request('permissions')).json();
    assert.equal(data.users[0].email, student);
    const body = { operation: 'remove', email: student, revision: data.revision };
    for (const headers of [{ origin: 'https://evil.example' }, { 'x-csrf-token': 'wrong' }]) assert.equal((await admin.post('permissions', body, headers)).status, 403);
    assert.equal((await admin.post('permissions', body)).status, 200);
    assert.equal((await ordinary.session()).scheduleAdmin, false);
    assert.equal((await admin.request('permissions', { method: 'DELETE' })).status, 405);
});

test('create/edit/cancel are separately enforced and revision spoofing cannot bypass them', async () => {
    const f = fixture(), user = f.client(student); await user.login();
    await f.grant(student, { createReplacements: true });
    const first = await user.post('replacements', mutation()); assert.equal(first.status, 200);
    const revision = (await first.json()).replacement.revision;
    assert.equal((await user.post('replacements', mutation({ revision }))).status, 403);
    assert.equal((await user.post('replacements', mutation({ operation: 'remove', revision }))).status, 403);
    assert.equal((await user.post('replacements', mutation())).status, 409); // cannot pretend existing record is new
    await f.grant(student, { editReplacements: true });
    assert.equal((await user.post('replacements', mutation({ index: 1 }))).status, 403);
    assert.equal((await user.post('replacements', mutation({ index: 1, revision }))).status, 409); // cannot pretend missing record exists
    const edited = await user.post('replacements', mutation({ revision })); assert.equal(edited.status, 200);
    const editedRevision = (await edited.json()).replacement.revision;
    await f.grant(student, { cancelReplacements: true });
    assert.equal((await user.post('replacements', mutation({ revision: editedRevision }))).status, 403);
    assert.equal((await user.post('replacements', mutation({ operation: 'remove', revision: editedRevision }))).status, 200);
    await f.grant(student, {});
    assert.equal((await user.post('replacements', mutation())).status, 403); // same valid login cookie, revoked access
    const session = await user.session();
    assert.equal(session.mainAdmin, false); assert.equal(session.scheduleAdmin, false);
    assert.equal('users' in session, false);
});

test('permissions storage outage fails closed for delegates, preserves login and main admin recovery', async () => {
    const f = fixture(), user = f.client(student), admin = f.client(owner);
    await user.login(); await admin.login(); await f.grant(student, fullPermissions());
    f.storage.get = async () => { throw new Error('private storage token'); };
    const session = await user.session();
    assert.equal(session.user.email, student); assert.equal(session.permissionsUnavailable, true); assert.equal(session.scheduleAdmin, false);
    const response = await user.post('replacements', mutation());
    assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private storage token/);
    assert.equal((await admin.session()).mainAdmin, true);
    assert.equal((await admin.post('replacements', mutation())).status, 200);
    const failedList = await admin.request('permissions'); assert.equal(failedList.status, 503);
    assert.doesNotMatch(await failedList.text(), /private storage token/);
});
