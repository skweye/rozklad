import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGoogleProfile } from '../server/google-client.mjs';

test('Google profile uses a fixed HTTPS endpoint, bounded request and manual redirects', async () => {
    const profile = { sub: 'student', email: 'student@example.com', email_verified: true };
    let calls = 0;
    const result = await loadGoogleProfile('fixture-token', async (url, options) => {
        calls++;
        assert.equal(url, 'https://openidconnect.googleapis.com/v1/userinfo');
        assert.equal(options.redirect, 'manual');
        assert.equal(options.headers.Authorization, 'Bearer fixture-token');
        assert.ok(options.signal instanceof AbortSignal);
        assert.equal(options.signal.aborted, false);
        return Response.json(profile);
    });
    assert.equal(calls, 1);
    assert.deepEqual(result, profile);
});

test('profile redirects and failed HTTP responses are rejected without following or leaking data', async () => {
    for (const status of [301, 302, 303, 307, 308, 400, 401, 403, 429, 500, 503]) {
        let calls = 0;
        await assert.rejects(loadGoogleProfile('fixture-token', async () => {
            calls++;
            return new Response('private response', { status, headers: { Location: 'https://untrusted.example/?private' } });
        }), error => {
            assert.equal(error.message, 'google_profile_unavailable');
            assert.deepEqual(error.response, { status });
            assert.doesNotMatch(JSON.stringify(error), /private|fixture-token|untrusted/);
            return true;
        });
        assert.equal(calls, 1);
    }
});
