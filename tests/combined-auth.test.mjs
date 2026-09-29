import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthHandler } from '../server/lib/auth.mjs';
import { CLASSROOM_SCOPES } from '../server/lib/classroom.mjs';

const origin = 'https://newrozklad.pp.ua';
const clientId = 'test.apps.googleusercontent.com';
function fixture({ info = {}, profile = {}, profileError = false, tokenError, reporterThrows = false } = {}) {
    const now = Date.now(), jar = {}, diagnostics = [];
    const handle = createAuthHandler({
        env: { AUTH_SITE_ORIGIN: origin, GOOGLE_CLIENT_ID: clientId, AUTH_SESSION_SECRET: 'test-secret-longer-than-32-characters' },
        now: () => now,
        reportAuthFailure: diagnostic => { diagnostics.push(diagnostic); if (reporterThrows) throw new Error('logger unavailable'); },
        verifyAccessToken: async token => {
            assert.equal(token, 'secret-access');
            if (tokenError) throw tokenError;
            return { aud: clientId, sub: 'student', scopes: CLASSROOM_SCOPES, expiry_date: now + 3600000, ...info };
        },
        getGoogleProfile: async token => {
            assert.equal(token, 'secret-access');
            if (profileError) throw profileError === true ? new Error('network') : profileError;
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
    return { request, jar, diagnostics, async login(headers = {}) {
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

test('Google failures expose only safe diagnostic fields and issue no login cookies', async () => {
    const privateError = Object.assign(new Error('secret-access student@example.com'), {
        response: { status: 503, data: { error: 'secret-access', email: 'student@example.com' }, headers: { authorization: 'Bearer secret-access' } },
        config: { url: 'https://example.com/?token=secret-access' }
    });
    for (const stage of ['token', 'profile']) {
        const f = fixture({ [stage === 'token' ? 'tokenError' : 'profileError']: privateError, reporterThrows: true });
        const response = await f.login(), body = await response.json();
        assert.equal(response.status, 502);
        assert.equal(body.error, 'classroom_verification_unavailable');
        assert.equal(body.diagnostic.stage, stage);
        assert.equal(body.diagnostic.category, 'http');
        assert.equal(body.diagnostic.upstreamStatus, 503);
        assert.match(body.diagnostic.id, /^google-[0-9a-f-]{36}$/);
        assert.deepEqual(f.diagnostics, [{ event: 'google_auth_failure', version: 1, ...body.diagnostic }]);
        assert.doesNotMatch(JSON.stringify([body, f.diagnostics]), /secret-access|student@example|authorization|stack|config/);
        assert.equal(f.jar['__Host-study-session'], undefined);
        assert.equal(f.jar['__Host-study-classroom'], undefined);
    }
});

test('expired Google tokens keep their existing response and are not logged as outages', async () => {
    const f = fixture({ tokenError: { response: { status: 400, data: { error: 'invalid_token' } } } });
    const response = await f.login();
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'classroom_expired' });
    assert.deepEqual(f.diagnostics, []);
});
