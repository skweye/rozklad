import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthHandler } from '../server/lib/auth.mjs';
import { CLASSROOM_SCOPES } from '../server/lib/classroom.mjs';

const origin = 'https://newrozklad.pp.ua';
const clientId = 'test.apps.googleusercontent.com';
function fixture({ info = {}, profile = {}, profileError = false } = {}) {
    const now = Date.now(), jar = {};
    const handle = createAuthHandler({
        env: { AUTH_SITE_ORIGIN: origin, GOOGLE_CLIENT_ID: clientId, AUTH_SESSION_SECRET: 'test-secret-longer-than-32-characters' },
        now: () => now,
        verifyAccessToken: async token => {
            assert.equal(token, 'secret-access');
            return { aud: clientId, sub: 'student', scopes: CLASSROOM_SCOPES, expiry_date: now + 3600000, ...info };
        },
        getGoogleProfile: async token => {
            assert.equal(token, 'secret-access');
            if (profileError) throw new Error('network');
            return { sub: 'student', name: 'Student', email: 'student@example.com', email_verified: true, ...profile };
        }
    });
    const request = async (action, data, headers = {}) => {
        const response = await handle(new Request(`${origin}/api/auth/${action}`, {
            method: data === undefined ? 'GET' : 'POST',
            headers: { origin, 'Content-Type': 'application/json', cookie: Object.values(jar).join('; '), ...headers },
            body: data === undefined ? undefined : JSON.stringify(data)
        }));
        for (const cookie of response.headers.getSetCookie()) {
            const pair = cookie.split(';')[0], name = pair.split('=')[0];
            if (cookie.includes('Max-Age=0')) delete jar[name]; else jar[name] = pair;
        }
        return response;
    };
    return { request, jar, async login(headers = {}) {
        const session = await (await request('session')).json();
        return request('google-connect', { accessToken: 'secret-access', user: { sub: 'attacker' } }, { 'x-csrf-token': session.csrf, ...headers });
    } };
}

test('one verified token establishes both login and encrypted Classroom access', async () => {
    const f = fixture(), response = await f.login();
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.user.id, 'student');
    assert.equal(result.classroomConnected, true);
    assert.deepEqual(result.missingPermissions, []);
    assert.ok(f.jar['__Host-study-session']);
    const access = f.jar['__Host-study-classroom'];
    assert.ok(access);
    assert.ok(!Buffer.from(access.split('=')[1], 'base64url').toString().includes('secret-access'));
    assert.ok(response.headers.getSetCookie().every(cookie => cookie.includes('HttpOnly; SameSite=Lax;')));
    assert.equal((await (await f.request('session')).json()).classroomConnected, true);
    assert.equal(f.jar['__Host-study-challenge']?.length > 0, true);
});

test('partial consent creates only a site session and reports missing permissions', async () => {
    const f = fixture({ info: { scopes: ['openid', 'email', 'profile', CLASSROOM_SCOPES[0]] } });
    const response = await f.login(), result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.classroomConnected, false);
    assert.deepEqual(result.missingPermissions, ['coursework']);
    assert.ok(f.jar['__Host-study-session']);
    assert.equal(f.jar['__Host-study-classroom'], undefined);
});

test('combined login rejects wrong audience, missing subject, expiration and mismatched/unverified profiles', async () => {
    for (const options of [
        { info: { aud: 'other-client' } }, { info: { sub: undefined } },
        { info: { expiry_date: 1 } }, { profile: { sub: 'other-person' } },
        { profile: { email_verified: false } }, { profile: { email: '' } }, { profileError: true }
    ]) {
        const f = fixture(options), response = await f.login();
        assert.ok(response.status >= 400);
        assert.equal(f.jar['__Host-study-session'], undefined);
        assert.equal(f.jar['__Host-study-classroom'], undefined);
        assert.ok(!(await response.text()).includes('secret-access'));
    }
});

test('combined login enforces same-origin and CSRF before validating Google access', async () => {
    for (const headers of [{ origin: 'https://evil.example' }, { 'x-csrf-token': 'invalid' }]) {
        const f = fixture(), response = await f.login(headers);
        assert.equal(response.status, 403);
        assert.equal(f.jar['__Host-study-session'], undefined);
    }
});
