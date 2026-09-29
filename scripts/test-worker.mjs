// Local workerd + D1 integration. No account, real OAuth token or remote database required.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createTestHarness } from 'wrangler';
import { createD1Store } from '../server/d1-store.mjs';
import './build.mjs';

const origin = 'https://newrozklad.pp.ua';
const secret = 'local-test-secret-not-for-deployment-123456789';
const owner = 'test-owner@example.com';
const harness = createTestHarness({ workers: [{ configPath: './wrangler.jsonc',
    vars: { AUTH_SITE_ORIGIN: origin, MAIN_ADMIN_EMAIL: owner },
    secrets: { GOOGLE_CLIENT_ID: 'local-test.apps.googleusercontent.com', AUTH_SESSION_SECRET: secret }
}, { config: { name: 'google-runtime-test', main: './tests/fixtures/google-runtime.mjs', compatibility_date: '2026-09-29', compatibility_flags: ['nodejs_compat'] } }] });
try {
    await harness.listen();
    const handle = harness.getWorker();
    const googleRuntime = harness.getWorker('google-runtime-test');
    const info = await (await googleRuntime.fetch('https://fixture.example/valid')).json();
    assert.deepEqual(info, { audience: 'test.apps.googleusercontent.com', scopes: ['openid', 'email'], expires: true });
    const invalid = await googleRuntime.fetch('https://fixture.example/invalid');
    assert.equal(invalid.status, 401);
    assert.deepEqual(await invalid.json(), { status: 400, error: 'invalid_token' });
    const profile = await googleRuntime.fetch('https://fixture.example/profile');
    assert.equal(profile.status, 200, 'Google profile request must use a Workers-supported redirect mode');
    assert.deepEqual(await profile.json(), { sub: 'student', email: 'student@example.com', email_verified: true });
    const redirect = await googleRuntime.fetch('https://fixture.example/profile-redirect');
    assert.equal(redirect.status, 502);
    assert.deepEqual(await redirect.json(), { status: 302 });
    await handle.applyD1Migrations('DB');
    const env = await handle.getEnv();
    const store = createD1Store(env.DB, 'site-permissions');
    assert.equal((await store.setJSON('grants-v1', { revision: null, users: [] }, { onlyIfNew: true })).modified, true);
    const row = await store.getWithMetadata('grants-v1');
    const concurrent = await Promise.all([1, 2].map(() => store.setJSON('grants-v1', { revision: null, users: [] }, { onlyIfMatch: row.etag })));
    assert.equal(concurrent.filter(result => result.modified).length, 1);

    for (const path of ['/', '/reports/', '/admin/', '/privacy.html', '/terms.html', '/ui-icons.svg']) {
        const response = await handle.fetch(origin + path);
        assert.equal(response.status, 200, path);
        assert.equal(response.headers.get('Cross-Origin-Opener-Policy'), 'same-origin-allow-popups');
        assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    }
    for (const path of ['/server/worker.mjs', '/.dev.vars', '/migrations/0001_site_records.sql', '/private-backups/records.json', '/not-found', '/api/not-found']) {
        assert.equal((await handle.fetch(origin + path)).status, 404, path);
    }
    const jar = new Map();
    async function request(path, data, extraHeaders = {}) {
        const response = await handle.fetch(origin + path, { method: data === undefined ? 'GET' : 'POST',
            headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: [...jar.values()].join('; '), ...extraHeaders },
            body: data === undefined ? undefined : JSON.stringify(data) });
        for (const cookie of response.headers.getSetCookie()) {
            const pair = cookie.split(';')[0], name = pair.split('=')[0];
            if (cookie.includes('Max-Age=0')) jar.delete(name); else jar.set(name, pair);
        }
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        return response;
    }
    const guestResponse = await request('/api/auth/session');
    const guest = await guestResponse.json();
    assert.equal(guestResponse.status, 200, JSON.stringify(guest));
    assert.equal(guest.configured, true, JSON.stringify(guest));
    assert.equal(guest.user, null);
    assert.ok(guest.csrf);
    assert.equal((await request('/api/auth/permissions')).status, 401);
    assert.equal((await handle.fetch('https://untrusted.example/api/auth/session')).status, 403);
    assert.equal((await request('/api/auth/presence', { page: 'schedule' })).status, 403);
    assert.equal((await request('/api/auth/presence', { page: 'schedule' }, { 'x-csrf-token': guest.csrf })).status, 200);

    // A test-only, locally signed fixture exercises the deployed session verifier and crypto.
    const payload = Buffer.from(JSON.stringify({ kind: 'session', exp: Math.floor(Date.now() / 1000) + 600, user: { id: 'test-owner', name: 'Owner', email: owner } })).toString('base64url');
    jar.set('__Host-study-session', `__Host-study-session=${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`);
    const session = await (await request('/api/auth/session')).json();
    assert.equal(session.user.email, owner);
    const headers = { 'x-csrf-token': session.csrf };
    const permission = { operation: 'save', revision: null, email: 'student@example.com', permissions: { createReplacements: true, editReplacements: false, cancelReplacements: false } };
    assert.equal((await request('/api/auth/permissions', permission, headers)).status, 200);
    assert.equal((await request('/api/auth/permissions', permission, headers)).status, 409);
    assert.equal((await (await request('/api/auth/permissions')).json()).users.length, 1);
    assert.equal((await request('/api/auth/presence', { page: 'admin' }, headers)).status, 200);
    assert.equal((await (await request('/api/auth/presence')).json()).users[0].email, owner);

    const future = new Date(Date.now() + 2 * 86400000);
    while ([0, 6].includes(future.getUTCDay())) future.setUTCDate(future.getUTCDate() + 1);
    const date = future.toISOString().slice(0, 10);
    const replacement = { operation: 'set', date, index: 0, source: { kind: 'window' }, revision: null };
    const createdResponse = await request('/api/auth/replacements', replacement, headers);
    assert.equal(createdResponse.status, 200);
    const created = await createdResponse.json();
    assert.equal(created.replacement.lesson, null);
    assert.equal((await request('/api/auth/replacements', replacement, headers)).status, 409);
    const listed = await (await request(`/api/auth/replacements?from=${date}&to=${date}`)).json();
    assert.equal(listed.replacements.length, 1);
    assert.equal(listed.suppressedNotificationIds.length, 1);
    assert.ok(!JSON.stringify(listed).includes('_actor'));
    const publicList = await (await handle.fetch(`${origin}/api/auth/replacements?from=${date}&to=${date}`)).json();
    assert.equal(publicList.suppressedNotificationIds.length, 0);
    assert.equal((await request('/api/auth/replacements', { operation: 'remove', date, index: 0, revision: created.replacement.revision }, headers)).status, 200);
    assert.equal((await request('/api/auth/logout', {}, headers)).status, 200);
    assert.equal((await (await request('/api/auth/session')).json()).user, null);
    console.log('Workers integration passed: Google transport (offline fixtures), pages, headers, private file isolation, D1 CAS, cookies, CSRF, owner permissions, presence, replacements and logout.');
} finally {
    await harness.close();
}
