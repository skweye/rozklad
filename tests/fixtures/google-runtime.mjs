// Test-only Worker: no real Google traffic or credentials. Not part of public assets.
import { createGoogleClient } from '../../server/google-client.mjs';

export default {
    async fetch(request) {
        const mode = new URL(request.url).pathname;
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
