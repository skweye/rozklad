// Test-only Worker: no real Google traffic or credentials. Not part of public assets.
import { createGoogleClient, loadGoogleProfile } from '../../server/google-client.mjs';

export default {
    async fetch(request) {
        const mode = new URL(request.url).pathname;
        if (mode.startsWith('/profile')) {
            try {
                const profile = await loadGoogleProfile('local-fixture', async (url, options) => {
                    // Use workerd's native Request validation, not just a permissive mock.
                    // This catches redirect: 'error', which Node accepts but Workers rejects.
                    const outgoing = new Request(url, options);
                    if (outgoing.redirect !== 'manual' || outgoing.headers.get('authorization') !== 'Bearer local-fixture') throw new Error('Unexpected profile request');
                    return mode === '/profile-redirect'
                        ? new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/' } })
                        : Response.json({ sub: 'student', email: 'student@example.com', email_verified: true });
                });
                return Response.json(profile);
            } catch (error) {
                return Response.json({ status: error.response?.status }, { status: 502 });
            }
        }
        const google = createGoogleClient(async (url, options) => {
            if (String(url) !== 'https://oauth2.googleapis.com/tokeninfo' || new Headers(options.headers).get('authorization') !== 'Bearer local-fixture') throw new Error('Unexpected request');
            return mode === '/invalid'
                ? Response.json({ error: 'invalid_token' }, { status: 400 })
                : Response.json({ aud: 'test.apps.googleusercontent.com', sub: 'student', expires_in: 3600, scope: 'openid email' });
        });
        try {
            const info = await google.getTokenInfo('local-fixture');
            return Response.json({ audience: info.aud, scopes: info.scopes, expires: info.expiry_date > Date.now() });
        } catch (error) {
            return Response.json({ status: error.response?.status, error: error.response?.data?.error }, { status: 401 });
        }
    }
};
