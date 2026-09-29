import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresenceService } from '../server/lib/presence.mjs';
import { createAuthHandler } from '../server/lib/auth.mjs';

const origin = 'https://test.example', owner = 'owner@example.com';
function fixture() {
    let timestamp = Date.parse('2026-09-25T08:00:00Z'), stored = null, version = 0, offline = false;
    const store = {
        async getWithMetadata() { if (offline) throw new Error('private token'); return structuredClone(stored); },
        async setJSON(key, data, options) {
            if (options.onlyIfNew && stored || options.onlyIfMatch && options.onlyIfMatch !== stored?.etag) return { modified: false };
            stored = { data: structuredClone(data), etag: String(++version) }; return { modified: true };
        }
    };
    const presence = createPresenceService({ getStore: () => store, now: () => timestamp });
    const env = { MAIN_ADMIN_EMAIL: owner, AUTH_SITE_ORIGIN: origin, GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com', AUTH_SESSION_SECRET: 'unit-test-secret-at-least-32-characters' };
    const client = (email = 'student@example.com') => {
        const jar = new Map();
        const handler = createAuthHandler({ env, presence, now: () => timestamp,
            permissions: { resolve: async () => ({ mainAdmin: false, permissions: { createReplacements: true } }) },
            verifyGoogle: async nonce => ({ sub: email, email, name: '<img src=x>', email_verified: true, nonce }) });
        const request = async (action, options = {}) => {
            const response = await handler(new Request(`${origin}/api/auth/${action}`, { ...options, headers: { cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; '), ...options.headers } }));
            for (const cookie of response.headers.getSetCookie()) { const [key, value] = cookie.split(';')[0].split('='); if (value) jar.set(key, value); else jar.delete(key); }
            return response;
        };
        const session = async () => (await request('session')).json();
        const post = async (action, body, headers = {}) => {
            const challenge = await session();
            return request(action, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-csrf-token': challenge.csrf, ...headers }, body: JSON.stringify(body) });
        };
        return { jar, request, session, post, async login() { const challenge = await session(); assert.equal((await post('google', { credential: challenge.nonce })).status, 200); } };
    };
    return { client, presence, env, get data() { return stored?.data; }, advance(ms) { timestamp += ms; }, offline() { offline = true; } };
}

test('presence is owner-only; signed-in delegated admins and guests cannot read identities', async () => {
    const f = fixture(), guest = f.client(), admin = f.client(owner), delegate = f.client();
    assert.equal((await guest.request('presence')).status, 401);
    await delegate.login(); assert.equal((await delegate.session()).scheduleAdmin, true);
    assert.equal((await delegate.request('presence')).status, 403);
    await admin.login();
    const response = await admin.request('presence');
    assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
    f.env.MAIN_ADMIN_EMAIL = 'other@example.com';
    assert.equal((await admin.request('presence')).status, 403);
});

test('heartbeat trusts server identity, not body fields; guests get only a count and signed cookie', async () => {
    const f = fixture(), visitor = f.client();
    const ping = await visitor.post('presence', { page: 'schedule', user: { id: owner, email: owner }, seenAt: '2099-01-01', mainAdmin: true });
    assert.equal(ping.status, 200); assert.deepEqual(await ping.json(), { ok: true });
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax']) assert.match(ping.headers.get('set-cookie'), new RegExp(flag));
    let list = await f.presence.list(); assert.equal(list.guests, 1); assert.equal(list.users.length, 0);
    await visitor.login(); await visitor.post('presence', { page: 'reports' });
    list = await f.presence.list(); assert.equal(list.guests, 0); assert.equal(list.users.length, 1);
    assert.equal(list.users[0].email, 'student@example.com'); assert.equal(list.users[0].page, 'reports');
    assert.doesNotMatch(JSON.stringify(list), /google-subject|presence-v1|csrf|2099|"id"/);
    assert.match(Object.keys(f.data)[0], /^[a-f0-9]{64}$/);
    assert.equal((await visitor.post('presence', { page: 'admin' })).status, 200);
    assert.equal((await f.presence.list()).users[0].page, 'admin');
    assert.equal((await visitor.request('presence')).status, 403); // visiting the public shell grants no access
});

test('repeat tabs and devices deduplicate accounts, expiry prunes records, logout removes current browser', async () => {
    const f = fixture(), first = f.client(), second = f.client();
    await first.login(); await second.login();
    await first.post('presence', { page: 'schedule' });
    f.advance(1000); await first.post('presence', { page: 'reports' }); await second.post('presence', { page: 'reports' });
    assert.equal((await f.presence.list()).users.length, 1);
    await first.post('logout', {}); assert.equal(Object.keys(f.data).length, 1);
    f.advance(120000); assert.equal((await f.presence.list()).users.length, 0); assert.deepEqual(f.data, {});
});

test('heartbeat rejects forged CSRF/origin/page, malformed JSON and unsupported methods', async () => {
    const f = fixture(), visitor = f.client();
    for (const headers of [{ origin: 'https://evil.example' }, { 'x-csrf-token': 'forged' }]) assert.equal((await visitor.post('presence', { page: 'schedule' }, headers)).status, 403);
    assert.equal((await visitor.post('presence', { page: '/private/report?text=secret' })).status, 400);
    assert.equal((await visitor.post('presence', { page: 'schedule' }, { 'content-type': 'text/plain' })).status, 400);
    assert.equal((await visitor.request('presence', { method: 'DELETE' })).status, 405);
    assert.equal(f.data, undefined);
});

test('simultaneous heartbeats preserve different visitors; store errors do not expose secrets or block logout', async () => {
    const f = fixture();
    await Promise.all(['a', 'b', 'c'].map(key => f.presence.ping({ key, page: 'schedule', user: null })));
    assert.equal((await f.presence.list()).guests, 3);
    const admin = f.client(owner); await admin.login(); await admin.post('presence', { page: 'schedule' }); f.offline();
    const response = await admin.request('presence'); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private token/);
    assert.equal((await admin.post('presence', { page: 'schedule' })).status, 503);
    assert.equal((await admin.post('logout', {})).status, 200);
    assert.equal((await admin.session()).user, null);
});
