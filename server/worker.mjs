import { createGoogleClient, loadGoogleProfile } from './google-client.mjs';
import { createAuthHandler } from './lib/auth.mjs';
import { loadClassroom } from './lib/classroom.mjs';
import { createReplacementService } from './lib/replacements.mjs';
import { createPermissionsService } from './lib/permissions.mjs';
import { createPresenceService } from './lib/presence.mjs';
import { createD1Store } from './d1-store.mjs';
import schedule from '../schedule.json' with { type: 'json' };

const google = createGoogleClient();
export function createWorkerHandler(env) {
    const store = name => () => createD1Store(env.DB, name);
    return createAuthHandler({
        env,
        reportAuthFailure: diagnostic => console.warn(JSON.stringify(diagnostic)),
        presence: createPresenceService({ getStore: store('site-presence') }),
        permissions: createPermissionsService({ getStore: store('site-permissions'), env }),
        replacements: createReplacementService({ schedule, getStore: store('schedule-replacements') }),
        verifyAccessToken: token => google.getTokenInfo(token),
        getGoogleProfile: loadGoogleProfile,
        getClassroom: token => loadClassroom(token),
        verifyGoogle: async (credential, clientId) => {
            const ticket = await google.verifyIdToken({ idToken: credential, audience: clientId });
            return ticket.getPayload();
        }
    });
}

export default {
    async fetch(request, env) {
        if (!new URL(request.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
        try {
            // Request-local dependencies prevent bindings or admin settings leaking across environments.
            const response = await createWorkerHandler(env)(request);
            response.headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
            response.headers.set('Referrer-Policy', 'no-referrer-when-downgrade');
            return response;
        } catch {
            // Never log OAuth tokens, cookie contents, user data or raw provider exceptions.
            return Response.json({ error: 'unavailable' }, { status: 503, headers: {
                'Cache-Control': 'no-store', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff'
            } });
        }
    }
};
