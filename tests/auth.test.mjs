import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthHandler } from '../server/lib/auth.mjs';

const origin = 'https://study-test.example';
const env = {
    AUTH_SITE_ORIGIN: origin,
    GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
    AUTH_SESSION_SECRET: 'unit-test-secret-not-for-production-0123456789'
};
const cookieValue = (response, name) => response.headers.getSetCookie()
    .find(value => value.startsWith(name + '='))?.split(';')[0];

function fixture(overrides = {}) {
    let timestamp = Date.now();
    let claims = {};
    let calls = 0;
    const handle = createAuthHandler({
        env: { ...env, ...overrides }, now: () => timestamp,
        verifyGoogle: async (credential, clientId) => {
            calls++;
            assert.equal(credential, 'verified-by-test-double');
            assert.equal(clientId, env.GOOGLE_CLIENT_ID);
            if (claims instanceof Error) throw claims;
            return claims;
        }
    });
    const request = (action, options) => handle(new Request(`${overrides.AUTH_SITE_ORIGIN || origin}/api/auth/${action}`, options));
    return {
        request, handle, get calls() { return calls; },
        advance(seconds) { timestamp += seconds * 1000; },
        setClaims(value) { claims = value; }
    };
}

async function challenge(f) {
    const response = await f.request('session');
    const data = await response.json();
    return { response, data, cookie: cookieValue(response, '__Host-study-challenge') };
}
function post(c, extra = {}) {
    return {
        method: 'POST',
        headers: { origin, cookie: c.cookie, 'x-csrf-token': c.data.csrf, 'content-type': 'application/json', ...extra },
        body: JSON.stringify({ credential: 'verified-by-test-double' })
    };
}
function goodClaims(c) {
    return { sub: 'stable-google-subject', name: 'Тестовий користувач', email: 'student@example.com', email_verified: true, nonce: c.data.nonce };
}

test('configuration is optional and never leaks secrets', async () => {
    const f = fixture({ AUTH_SESSION_SECRET: '' });
    assert.deepEqual(await (await f.request('session')).json(), { configured: false, user: null });
    assert.equal((await f.request('google', { method: 'POST' })).status, 503);
    const c = await challenge(fixture());
    assert.equal(c.data.configured, true);
    assert.equal(c.data.user, null);
    assert.ok(!JSON.stringify(c.data).includes(env.AUTH_SESSION_SECRET));
    assert.match(c.response.headers.get('cache-control'), /no-store/);
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(c.response.headers.get('set-cookie').includes(flag));
});

test('valid login, persistent session across both pages, and logout', async () => {
    const f = fixture(), c = await challenge(f);
    f.setClaims(goodClaims(c));
    const response = await f.request('google', post(c));
    assert.equal(response.status, 200);
    const user = (await response.json()).user;
    assert.equal(user.id, 'stable-google-subject');
    const sessionCookie = cookieValue(response, '__Host-study-session');
    assert.match(sessionCookie, /^__Host-study-session=/);
    assert.ok(response.headers.getSetCookie().some(value => value.includes('Max-Age=86400')));
    assert.ok(!JSON.stringify(user).includes('verified-by-test-double'));
    const next = await f.request('session', { headers: { cookie: sessionCookie } });
    const nextData = await next.json();
    assert.deepEqual(nextData.user, user);
    const nextCookie = cookieValue(next, '__Host-study-challenge');
    const result = await f.request('logout', post({ data: nextData, cookie: `${sessionCookie}; ${nextCookie}` }));
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { user: null });
    assert.equal(result.headers.getSetCookie().filter(value => value.includes('Max-Age=0')).length, 3);
});

test('cross-origin and missing or tampered CSRF are rejected before Google verification', async () => {
    const f = fixture(), c = await challenge(f);
    for (const headers of [
        { origin: 'https://attacker.example' }, { origin: '' },
        { 'x-csrf-token': '' }, { 'x-csrf-token': 'tampered' },
        { cookie: '' }, { cookie: c.cookie + 'tampered' }
    ]) {
        assert.equal((await f.request('google', post(c, headers))).status, 403);
        assert.equal((await f.request('logout', post(c, headers))).status, 403);
    }
    assert.equal(f.calls, 0);
});

test('wrong host, methods and unknown endpoints are rejected', async () => {
    const f = fixture();
    assert.equal((await f.handle(new Request('https://preview.example/api/auth/session'))).status, 403);
    assert.equal((await f.request('google')).status, 405);
    assert.equal((await f.request('session', { method: 'POST' })).status, 405);
    assert.equal((await f.request('missing')).status, 404);
});

test('nonce, verified email and subject are required; rejected Google tokens never create a session', async () => {
    const f = fixture(), c = await challenge(f);
    const cases = [new Error('bad Google signature'), {},
        { ...goodClaims(c), nonce: 'wrong' }, { ...goodClaims(c), email_verified: false },
        { ...goodClaims(c), sub: '' }, { ...goodClaims(c), email: null }];
    for (const claims of cases) {
        f.setClaims(claims);
        const response = await f.request('google', post(c));
        assert.equal(response.status, 401);
        assert.equal(cookieValue(response, '__Host-study-session'), undefined);
    }
});

test('malformed and oversized bodies are rejected', async () => {
    const f = fixture(), c = await challenge(f);
    for (const body of ['{', 'null', '{}', JSON.stringify({ credential: 4 }), 'x'.repeat(17000)]) {
        assert.equal((await f.request('google', { ...post(c), body })).status, 400);
    }
    assert.equal((await f.request('google', post(c, { 'content-type': 'text/plain' }))).status, 400);
    assert.equal(f.calls, 0);
});

test('expired challenges cannot be used and valid challenges are reused', async () => {
    const f = fixture(), c = await challenge(f);
    const same = await f.request('session', { headers: { cookie: c.cookie } });
    assert.equal((await same.json()).csrf, c.data.csrf);
    assert.equal(same.headers.getSetCookie().length, 0);
    f.advance(601);
    assert.equal((await f.request('google', post(c))).status, 403);
    const renewed = await f.request('session', { headers: { cookie: c.cookie } });
    assert.notEqual((await renewed.json()).csrf, c.data.csrf);
});

test('modified or expired session cookies are not authenticated', async () => {
    const f = fixture(), c = await challenge(f);
    f.setClaims(goodClaims(c));
    const response = await f.request('google', post(c));
    const cookie = cookieValue(response, '__Host-study-session');
    const tampered = await f.request('session', { headers: { cookie: cookie + 'tampered' } });
    assert.equal((await tampered.json()).user, null);
    f.advance(86401);
    const expired = await f.request('session', { headers: { cookie } });
    assert.equal((await expired.json()).user, null);
});

test('localhost uses host-only HttpOnly cookies without the HTTPS prefix', async () => {
    const response = await fixture({ AUTH_SITE_ORIGIN: 'http://localhost:8888' }).request('session');
    assert.equal(response.status, 200);
    assert.ok(cookieValue(response, 'study-challenge'));
    assert.ok(!response.headers.get('set-cookie').includes('Secure'));
    assert.ok(response.headers.get('set-cookie').includes('HttpOnly'));
});
