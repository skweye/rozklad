import { createHmac, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { missingClassroomPermissions } from './classroom.mjs';
import { isMainAdmin, fullPermissions, noPermissions } from './permissions.mjs';

const SESSION_SECONDS = 24 * 60 * 60;
const CHALLENGE_SECONDS = 10 * 60;
const BODY_LIMIT = 16384;
const random = () => randomBytes(32).toString('base64url');
const replacementActor = (user, secret) => typeof user?.id === 'string'
    ? createHmac('sha256', secret).update(`schedule-author-v1:${user.id}`).digest('base64url') : null;
const equal = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const left = Buffer.from(a), right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
};

function sign(data, secret) {
    const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
    return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

function readSigned(token, secret, kind, now) {
    if (!token || token.length > 8192) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const expected = createHmac('sha256', secret).update(parts[0]).digest('base64url');
    if (!equal(parts[1], expected)) return null;
    try {
        const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
        return data.kind === kind && Number.isFinite(data.exp) && data.exp > now ? data : null;
    } catch { return null; }
}

function cookies(request) {
    return Object.fromEntries((request.headers.get('cookie') || '').split(';').map(item => {
        const separator = item.indexOf('=');
        return separator < 0 ? [] : [item.slice(0, separator).trim(), item.slice(separator + 1).trim()];
    }).filter(pair => pair.length === 2));
}

// OAuth tokens must not be stored in a merely signed/readable cookie.
function sealAccess(data, secret) {
    const key = createHmac('sha256', secret).update('classroom-cookie-v1').digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

function readAccess(token, secret, user, now) {
    try {
        if (!token || token.length > 3800 || !user) return null;
        const raw = Buffer.from(token, 'base64url');
        const key = createHmac('sha256', secret).update('classroom-cookie-v1').digest();
        const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(12, 28));
        const data = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString());
        return data.sub === user.id && data.exp > now && typeof data.token === 'string' ? data : null;
    } catch { return null; }
}

function configuration(env) {
    try {
        const origin = new URL(env.AUTH_SITE_ORIGIN);
        const local = origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname);
        if ((!local && origin.protocol !== 'https:') || origin.username || origin.password ||
            origin.pathname !== '/' || origin.search || origin.hash) return null;
        if (!env.GOOGLE_CLIENT_ID?.endsWith('.apps.googleusercontent.com') ||
            env.GOOGLE_CLIENT_ID.startsWith('replace-') ||
            !env.AUTH_SESSION_SECRET || env.AUTH_SESSION_SECRET.length < 32 ||
            env.AUTH_SESSION_SECRET.startsWith('replace-')) return null;
        return { origin: origin.origin, secure: !local, clientId: env.GOOGLE_CLIENT_ID, secret: env.AUTH_SESSION_SECRET };
    } catch { return null; }
}

async function readBody(request) {
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('body');
    if (Number(request.headers.get('content-length')) > BODY_LIMIT) throw new Error('body');
    const reader = request.body?.getReader();
    if (!reader) throw new Error('body');
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > BODY_LIMIT) { await reader.cancel(); throw new Error('body'); }
            chunks.push(Buffer.from(value));
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally { reader.releaseLock(); }
}

export function createAuthHandler({ verifyGoogle, verifyAccessToken, getGoogleProfile, getClassroom, replacements, permissions, presence, env = process.env, now = () => Date.now() }) {
    const accessFor = async user => {
        if (isMainAdmin(user, env)) return { mainAdmin: true, permissions: fullPermissions() };
        if (!user || !permissions) return { mainAdmin: false, permissions: noPermissions() };
        return permissions.resolve(user);
    };
    return async request => {
        const headers = new Headers({ 'Cache-Control': 'no-store', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff' });
        const reply = (data, status = 200) => Response.json(data, { status, headers });
        const fail = (error, status) => reply({ error }, status);
        const url = new URL(request.url);
        const action = url.pathname.match(/^\/api\/auth\/(session|google|google-connect|logout|classroom|classroom-connect|replacements|permissions|presence)$/)?.[1];
        if (!action) return fail('not_found', 404);
        const method = ['session', 'classroom'].includes(action) || (['replacements', 'permissions', 'presence'].includes(action) && request.method === 'GET') ? 'GET' : 'POST';
        if (request.method !== method) {
            headers.set('Allow', method);
            return fail('method_not_allowed', 405);
        }
        const replacementError = error => fail(
            ['replacement_invalid', 'replacement_conflict'].includes(error.message) ? error.message : 'replacements_unavailable',
            error.message === 'replacement_invalid' ? 400 : error.message === 'replacement_conflict' ? 409 : 503);
        // Public schedule changes can be read without signing in or granting Classroom access.
        if (action === 'replacements' && method === 'GET') {
            const viewerSettings = configuration(env);
            let viewerKey = null;
            if (viewerSettings && url.origin === viewerSettings.origin) {
                const viewer = readSigned(cookies(request)[`${viewerSettings.secure ? '__Host-' : ''}study-session`], viewerSettings.secret, 'session', Math.floor(now() / 1000));
                viewerKey = replacementActor(viewer?.user, viewerSettings.secret);
            }
            try { return reply(await replacements.list(url.searchParams.get('from'), url.searchParams.get('to'), viewerKey)); }
            catch (error) { return replacementError(error); }
        }
        const settings = configuration(env);
        if (!settings) return action === 'session' ? reply({ configured: false, user: null }) : fail('not_configured', 503);
        const { origin, secure, clientId, secret } = settings;
        // A production session must never be issued to a preview or an untrusted origin.
        if (url.origin !== origin) return fail('wrong_origin', 403);
        const seconds = Math.floor(now() / 1000);
        const prefix = secure ? '__Host-' : '';
        const sessionName = `${prefix}study-session`;
        const challengeName = `${prefix}study-challenge`;
        const accessName = `${prefix}study-classroom`;
        const presenceName = `${prefix}study-presence`;
        const jar = cookies(request);
        const setCookie = (name, value, age) => headers.append('Set-Cookie',
            `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`);
        let challenge = readSigned(jar[challengeName], secret, 'challenge', seconds);
        const session = readSigned(jar[sessionName], secret, 'session', seconds);
        const access = readAccess(jar[accessName], secret, session?.user, seconds);
        let visitor = readSigned(jar[presenceName], secret, 'presence', seconds);
        const visitorKey = () => createHmac('sha256', secret).update(`presence-v1:${visitor.id}`).digest('hex');
        if (action === 'presence' && method === 'GET') {
            if (!session?.user) return fail('login_required', 401);
            if (!isMainAdmin(session.user, env)) return fail('owner_required', 403);
            try { return reply(await presence.list()); } catch { return fail('presence_unavailable', 503); }
        }
        const permissionError = error => fail(
            ['permissions_invalid', 'permissions_conflict', 'owner_protected', 'permissions_limit'].includes(error.message) ? error.message : 'permissions_unavailable',
            error.message === 'permissions_conflict' ? 409 : ['permissions_invalid', 'owner_protected', 'permissions_limit'].includes(error.message) ? 400 : 503);
        if (action === 'permissions') {
            if (!session?.user) return fail('login_required', 401);
            if (!isMainAdmin(session.user, env)) return fail('owner_required', 403);
            if (method === 'GET') {
                try { return reply(await permissions.list()); } catch (error) { return permissionError(error); }
            }
        }
        if (action === 'classroom') {
            if (!session?.user) return fail('login_required', 401);
            if (!access) return fail('classroom_expired', 401);
            try { return reply(await getClassroom(access.token)); }
            catch (error) {
                const known = ['classroom_expired', 'classroom_api_disabled', 'classroom_forbidden', 'classroom_quota'];
                const code = known.includes(error.message) ? error.message : 'classroom_unavailable';
                if (code === 'classroom_expired') setCookie(accessName, '', 0);
                return fail(code, code === 'classroom_expired' ? 401 : 502);
            }
        }
        if (action === 'session') {
            if (!challenge || challenge.exp - seconds < 60) {
                challenge = { kind: 'challenge', csrf: random(), nonce: random(), exp: seconds + CHALLENGE_SECONDS };
                setCookie(challengeName, sign(challenge, secret), CHALLENGE_SECONDS);
            }
            let rights;
            try { rights = await accessFor(session?.user); }
            catch { rights = { mainAdmin: false, permissions: noPermissions(), permissionsUnavailable: true }; }
            return reply({ configured: true, clientId, user: session?.user || null, csrf: challenge.csrf, nonce: challenge.nonce, classroomConnected: Boolean(access), ...rights, scheduleAdmin: Object.values(rights.permissions).some(Boolean) });
        }
        if (request.headers.get('origin') !== origin ||
            !challenge || !equal(request.headers.get('x-csrf-token'), challenge.csrf)) return fail('session_expired', 403);
        if (action === 'presence') {
            let body;
            try { body = await readBody(request); } catch { return fail('invalid_request', 400); }
            if (!['schedule', 'reports', 'admin'].includes(body?.page)) return fail('invalid_request', 400);
            if (!visitor) {
                visitor = { kind: 'presence', id: random(), exp: seconds + SESSION_SECONDS };
                setCookie(presenceName, sign(visitor, secret), SESSION_SECONDS);
            }
            try {
                await presence.ping({ key: visitorKey(), user: session?.user || null, page: body.page });
                return reply({ ok: true });
            } catch { return fail('presence_unavailable', 503); }
        }
        if (action === 'permissions') {
            let body;
            try { body = await readBody(request); } catch { return fail('invalid_request', 400); }
            try { return reply(await permissions.change(body)); } catch (error) { return permissionError(error); }
        }
        if (action === 'replacements') {
            if (!session?.user) return fail('login_required', 401);
            let body;
            try { body = await readBody(request); } catch { return fail('invalid_request', 400); }
            let rights;
            try { rights = await accessFor(session.user); } catch (error) { return permissionError(error); }
            const needed = body?.operation === 'remove' ? 'cancelReplacements' : body?.revision === null ? 'createReplacements' : 'editReplacements';
            if (!rights.permissions[needed]) return fail('permission_required', 403);
            try { return reply(await replacements.change(body, replacementActor(session.user, secret))); }
            catch (error) { return replacementError(error); }
        }
        if (action === 'logout') {
            // Logging out must remain possible even when the presence store is unavailable.
            if (visitor && presence) { try { await presence.remove(visitorKey()); } catch { /* expires from the online list in two minutes */ } }
            setCookie(sessionName, '', 0);
            setCookie(challengeName, '', 0);
            setCookie(accessName, '', 0);
            return reply({ user: null });
        }
        let body;
        try { body = await readBody(request); } catch { return fail('invalid_request', 400); }
        if (action === 'classroom-connect' || action === 'google-connect') {
            const signingIn = action === 'google-connect';
            if (!signingIn && !session?.user) return fail('login_required', 401);
            if (typeof body?.accessToken !== 'string' || !body.accessToken || body.accessToken.length > 2048) return fail('invalid_request', 400);
            let info;
            try { info = await verifyAccessToken(body.accessToken); }
            catch (error) {
                const status = error.response?.status;
                const reason = error.response?.data?.error;
                if (status === 401 || (status === 400 && ['invalid_token', 'invalid_value'].includes(reason))) {
                    return fail('classroom_expired', 401);
                }
                return fail('classroom_verification_unavailable', 502);
            }
            const subject = info?.sub ?? info?.user_id;
            if (info?.aud !== clientId || typeof subject !== 'string' || !subject || subject.length > 255 ||
                (!signingIn && subject !== session.user.id)) return fail('classroom_wrong_account', 403);
            const missingPermissions = missingClassroomPermissions(info.scopes);
            if (!signingIn && missingPermissions.length) return reply({ error: 'classroom_scope_required', missingPermissions }, 403);
            const age = Math.min(3600, Math.floor(info.expiry_date / 1000) - seconds - 30);
            if (!Number.isFinite(age) || age <= 0) return fail('classroom_expired', 401);
            if (signingIn) {
                // Profile is fetched server-side with the verified token, never supplied by the browser.
                let payload;
                try { payload = await getGoogleProfile(body.accessToken); }
                catch { return fail('classroom_verification_unavailable', 502); }
                if (!payload || payload.sub !== subject || payload.email_verified !== true ||
                    typeof payload.email !== 'string' || !payload.email) return fail('invalid_google_token', 401);
                const user = { id: subject, name: String(payload.name || payload.email).slice(0, 160), email: payload.email.slice(0, 254) };
                const classroomConnected = missingPermissions.length === 0;
                setCookie(sessionName, sign({ kind: 'session', user, exp: seconds + SESSION_SECONDS }, secret), SESSION_SECONDS);
                setCookie(challengeName, '', 0);
                if (classroomConnected) setCookie(accessName, sealAccess({ sub: subject, token: body.accessToken, exp: seconds + age }, secret), age);
                else setCookie(accessName, '', 0);
                // Denying an optional Classroom scope does not deny access to the public site/account.
                return reply({ user, classroomConnected, missingPermissions });
            }
            setCookie(accessName, sealAccess({ sub: subject, token: body.accessToken, exp: seconds + age }, secret), age);
            return reply({ connected: true });
        }
        if (!body || typeof body.credential !== 'string' || !body.credential || body.credential.length > 12000) {
            return fail('invalid_request', 400);
        }
        let payload;
        try {
            // The official library validates signature, issuer, expiry and audience.
            payload = await verifyGoogle(body.credential, clientId);
        } catch { return fail('invalid_google_token', 401); }
        if (!payload || typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255 ||
            payload.email_verified !== true || typeof payload.email !== 'string' ||
            !equal(payload.nonce, challenge.nonce)) return fail('invalid_google_token', 401);
        const user = { id: payload.sub, name: String(payload.name || payload.email).slice(0, 160), email: payload.email.slice(0, 254) };
        setCookie(sessionName, sign({ kind: 'session', user, exp: seconds + SESSION_SECONDS }, secret), SESSION_SECONDS);
        setCookie(challengeName, '', 0);
        const classroomConnected = user.id === session?.user?.id && Boolean(access);
        if (!classroomConnected) setCookie(accessName, '', 0);
        return reply({ user, classroomConnected });
    };
}
