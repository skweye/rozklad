import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../site-auth.js', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

function uiFixture({ configured = true, fail = false, light = false, storeClassroom = true, grantClassroom = true, scheduleAdmin = false, mainAdmin = false, permissions, replacementError = null, presenceFailures = 0, googleFailure = null } = {}) {
    class Element {
        children = []; listeners = {}; attributes = {}; textContent = ''; hidden = false; open = false; clientWidth = 320;
        classList = { contains: name => light && name === 'theme-light' };
        append(...children) { this.children.push(...children); }
        setAttribute(name, value) { this.attributes[name] = value; }
        addEventListener(name, handler) { this.listeners[name] = handler; }
        querySelector(name) { return this.elements[name]; }
        replaceChildren() { this.children = []; }
        showModal() { this.open = true; }
        close() { this.open = false; this.listeners.close?.(); }
        remove() {}
        set innerHTML(value) {
            this.markup = value;
            this.elements = Object.fromEntries(['.auth-status', '.auth-profile', '.auth-provider', '.auth-google-button', '.auth-logout', '.auth-retry',
                'h2', '.auth-name', '.auth-email', '.auth-close'].map(selector => [selector, new Element()]));
        }
        get innerHTML() { return this.markup || ''; }
    }
    const navigation = new Element(), body = new Element(), writes = [], requests = [];
    let user = null, googleOptions, popupCount = 0, renderCount = 0, disabledAutoSelect = false, classroomConnected = false;
    const google = { accounts: { id: {
        disableAutoSelect() { disabledAutoSelect = true; }
    }, oauth2: {
        initTokenClient(options) { renderCount++; googleOptions = options; return { requestAccessToken() { popupCount++; } }; }
    } } };
    const document = { body, head: new Element(), querySelector: () => navigation, createElement: () => new Element() };
    const window = { google, addEventListener() {} };
    const fetch = async (url, options) => {
        requests.push({ url, options });
        if (fail) throw new Error('offline');
        if (url.endsWith('/session')) return Response.json({ configured, user, clientId: 'test-client', nonce: 'test-nonce', csrf: 'test-csrf', classroomConnected, scheduleAdmin: Boolean(user && scheduleAdmin), mainAdmin: Boolean(user && mainAdmin), permissions });
        if (url.endsWith('/permissions')) return Response.json({ owner: 'student@example.com', revision: 'rights-revision', users: [] });
        if (url.endsWith('/presence')) {
            if (presenceFailures-- > 0) return Response.json({ error: 'session_expired' }, { status: 403 });
            return Response.json(options.method === 'GET' ? { users: [], guests: 0 } : { ok: true });
        }
        if (url.endsWith('/replacements')) return replacementError ? Response.json({ error: replacementError }, { status: 409 }) : Response.json({ replacement: { revision: 'revision' } });
        if (url.endsWith('/classroom-connect')) {
            classroomConnected = storeClassroom;
            return Response.json({ connected: true });
        }
        if (url.endsWith('/google-connect')) {
            if (googleFailure) return Response.json(googleFailure, { status: 502 });
            user = { id: 'subject', name: '<img src=x onerror=alert(1)>', email: 'student@example.com' };
            classroomConnected = grantClassroom && storeClassroom;
            return Response.json({ user, classroomConnected: grantClassroom });
        }
        user = null;
        return Response.json({ user: null });
    };
    vm.runInNewContext(source, { document, window, google, fetch, AbortSignal, setTimeout, clearTimeout,
        localStorage: { setItem(key, value) { writes.push([key, value]); } } });
    return {
        button: navigation.children[0], dialog: body.children[0], requests, writes,
        auth: window.studyAuth,
        setScheduleAdmin(value) { scheduleAdmin = value; },
        setMainAdmin(value) { mainAdmin = value; },
        label: navigation.children[0].children[1],
        continueGoogle() { body.children[0].querySelector('.auth-google-button').children[0].listeners.click(); },
        get popupCount() { return popupCount; },
        get googleOptions() { return googleOptions; }, get renderCount() { return renderCount; },
        get disabledAutoSelect() { return disabledAutoSelect; }
    };
}

test('Google login displays a safe support code without trusting arbitrary diagnostic content', async () => {
    const diagnostic = { id: 'google-12345678-1234-1234-1234-123456789abc', stage: 'profile', category: 'http', upstreamStatus: 503 };
    const f = uiFixture({ googleFailure: { error: 'classroom_verification_unavailable', diagnostic } });
    await settle(); f.button.listeners.click(); await settle();
    f.continueGoogle();
    await f.googleOptions.callback({ access_token: 'secret-access', expires_in: 3600 });
    await settle();
    const message = f.dialog.querySelector('.auth-status').textContent;
    assert.match(message, /google-12345678-1234-1234-1234-123456789abc/);
    assert.match(message, /profile\/http\/503/);
    assert.doesNotMatch(message, /secret-access/);
    const unsafe = { message: 'classroom_verification_unavailable', diagnostic: { ...diagnostic, stage: '<img src=x onerror=alert(1)>' } };
    assert.doesNotMatch(f.auth.errorMessage(unsafe), /<img|google-12345678/);
});

test('auth snapshots distinguish pending session, confirmed guest and network failure', async () => {
    const f = uiFixture(); assert.equal(f.auth.snapshot().status, 'checking');
    await settle(); assert.equal(f.auth.snapshot().status, 'ready'); assert.equal(f.auth.snapshot().user, null);
    const failed = uiFixture({ fail: true }); await settle(); assert.equal(failed.auth.snapshot().status, 'error');
});

test('shared UI opens Google, displays profile as text, and logs out without deleting drafts', async () => {
    const f = uiFixture();
    await settle();
    assert.equal(f.label.textContent, 'Увійти');
    f.button.listeners.click();
    await settle();
    assert.equal(f.dialog.open, true);
    assert.equal(f.renderCount, 1);
    assert.match(f.googleOptions.scope, /openid email profile/);
    assert.match(f.googleOptions.scope, /classroom\.courses\.readonly/);
    assert.match(f.googleOptions.scope, /classroom\.coursework\.me\.readonly/);
    assert.equal(f.popupCount, 0);
    assert.equal(f.dialog.querySelector('.auth-provider').hidden, false);
    f.continueGoogle();
    assert.equal(f.popupCount, 1);
    await f.googleOptions.callback({ access_token: 'google-access-token' });
    assert.equal(f.auth.snapshot().classroomConnected, true);
    assert.equal(f.label.textContent, '<img src=x onerror=alert(1)>');
    assert.equal(f.button.attributes['aria-label'], `Акаунт: ${f.label.textContent}`);
    assert.equal(f.button.attributes['data-signed-in'], 'true');
    assert.equal(f.dialog.querySelector('.auth-provider').hidden, true);
    assert.equal(f.dialog.querySelector('.auth-name').innerHTML, '');
    assert.equal(f.dialog.querySelector('.auth-name').textContent, '<img src=x onerror=alert(1)>');
    const login = f.requests.find(request => request.url.endsWith('/google-connect'));
    assert.equal(login.options.headers['X-CSRF-Token'], 'test-csrf');
    assert.equal(login.options.credentials, 'same-origin');
    await f.dialog.querySelector('.auth-logout').listeners.click();
    assert.equal(f.label.textContent, 'Увійти');
    assert.equal(f.button.attributes['data-signed-in'], 'false');
    assert.equal(f.dialog.open, false);
    assert.equal(f.disabledAutoSelect, true);
    assert.equal(f.writes.length, 2);
    assert.ok(f.writes.every(([key, value]) => key === 'study-account-changed' && /^\d+$/.test(value)));
});

test('missing configuration and network failure have inline messages and retry', async () => {
    for (const options of [{ configured: false }, { fail: true }]) {
        const f = uiFixture(options);
        await settle();
        f.button.listeners.click();
        await settle();
        assert.equal(f.renderCount, 0);
        assert.equal(f.dialog.querySelector('.auth-provider').hidden, true);
        assert.equal(f.dialog.querySelector('.auth-retry').hidden, false);
        assert.ok(f.dialog.querySelector('.auth-status').textContent.length > 20);
        assert.equal(f.button.disabled, false);
    }
});

test('popup cancellation restores the button and legal links are visible before signing in', async () => {
    const f = uiFixture();
    await settle();
    f.button.listeners.click();
    await settle();
    assert.match(f.dialog.innerHTML, /href="\/privacy.html"/);
    assert.match(f.dialog.innerHTML, /href="\/terms.html"/);
    f.continueGoogle();
    assert.equal(f.button.disabled, true);
    f.googleOptions.error_callback({ type: 'popup_closed' });
    assert.equal(f.button.disabled, false);
    assert.equal(f.auth.snapshot().user, null);
    f.continueGoogle();
    assert.equal(f.popupCount, 2);
});

test('Classroom is connected only after the server confirms the browser saved its cookie', async () => {
    for (const storeClassroom of [true, false]) {
        const f = uiFixture({ storeClassroom, grantClassroom: false });
        await settle();
        f.button.listeners.click();
        await settle();
        f.continueGoogle();
        await f.googleOptions.callback({ access_token: 'access-token' });
        if (storeClassroom) {
            await f.auth.connectClassroom('access');
            assert.equal(f.auth.snapshot().classroomConnected, true);
        } else {
            await assert.rejects(f.auth.connectClassroom('access'), /classroom_storage_failed/);
            assert.equal(f.auth.snapshot().classroomConnected, false);
        }
        assert.ok(f.requests.at(-1).url.endsWith('/session'));
    }
});

test('combined sign-in verifies saved cookies and does not announce an unsaved connection', async () => {
    const f = uiFixture({ storeClassroom: false });
    await settle();
    f.button.listeners.click();
    await settle();
    f.continueGoogle();
    await f.googleOptions.callback({ access_token: 'access-token' });
    assert.equal(f.auth.snapshot().classroomConnected, false);
    assert.equal(f.auth.snapshot().user, null);
    assert.match(f.dialog.querySelector('.auth-status').textContent, /не зберіг/);
    assert.equal(f.writes.length, 0);
});

test('declining Classroom still signs in, without claiming to have Classroom access', async () => {
    const f = uiFixture({ grantClassroom: false });
    await settle();
    f.button.listeners.click();
    await settle();
    f.continueGoogle();
    await f.googleOptions.callback({ access_token: 'profile-only' });
    assert.equal(f.auth.snapshot().user.id, 'subject');
    assert.equal(f.auth.snapshot().classroomConnected, false);
    assert.match(f.dialog.querySelector('.auth-status').textContent, /Classroom не підключено/);
});

test('closing the account dialog invalidates a pending OAuth callback', async () => {
    const f = uiFixture();
    await settle();
    f.button.listeners.click();
    await settle();
    f.continueGoogle();
    f.dialog.close();
    await f.googleOptions.callback({ access_token: 'late-token' });
    assert.equal(f.auth.snapshot().user, null);
    assert.ok(!f.requests.some(request => request.url.endsWith('/google-connect')));
    assert.equal(f.button.disabled, false);
});

test('replacement writes refresh server role and CSRF without requiring Classroom', async () => {
    const f = uiFixture({ scheduleAdmin: true, grantClassroom: false }); await settle();
    f.button.listeners.click(); await settle(); f.continueGoogle();
    await f.googleOptions.callback({ access_token: 'profile-only' });
    assert.equal(f.auth.snapshot().scheduleAdmin, true);
    assert.equal(f.auth.snapshot().classroomConnected, false);
    await f.auth.changeReplacement({ operation: 'set', date: '2026-09-24', index: 0, revision: null });
    assert.match(f.requests.at(-2).url, /\/session$/);
    assert.match(f.requests.at(-1).url, /\/replacements$/);
    assert.equal(f.requests.at(-1).options.headers['X-CSRF-Token'], 'test-csrf');
    f.setScheduleAdmin(false);
    await assert.rejects(f.auth.changeReplacement({ operation: 'remove' }), /admin_required/);
    assert.equal(f.auth.snapshot().scheduleAdmin, false);
    assert.match(f.requests.at(-1).url, /\/session$/);
});

test('owner management API refreshes session/CSRF and refuses a revoked owner', async () => {
    const f = uiFixture({ mainAdmin: true }); await settle();
    f.button.listeners.click(); await settle(); f.continueGoogle(); await f.googleOptions.callback({ access_token: 'token' });
    assert.equal(f.auth.snapshot().mainAdmin, true);
    await f.auth.readPermissions();
    assert.equal(f.requests.at(-1).options.method, 'GET');
    await f.auth.changePermissions({ operation: 'remove', email: 'other@example.com', revision: 'v1' });
    assert.match(f.requests.at(-2).url, /\/session$/);
    assert.match(f.requests.at(-1).url, /\/permissions$/);
    assert.equal(f.requests.at(-1).options.headers['X-CSRF-Token'], 'test-csrf');
    f.setMainAdmin(false);
    await assert.rejects(f.auth.readPermissions(), /owner_required/);
    assert.equal(f.auth.snapshot().mainAdmin, false);
    assert.match(f.requests.at(-1).url, /\/session$/);
});

test('presence reuses CSRF, refreshes an expired challenge once and never changes auth state', async () => {
    const f = uiFixture({ presenceFailures: 1 }); await settle();
    let updates = 0; f.auth.subscribe(() => { updates++; });
    await f.auth.sendPresence('schedule');
    assert.deepEqual(f.requests.slice(-3).map(item => item.url.split('/').at(-1)), ['presence', 'session', 'presence']);
    assert.equal(f.requests.at(-1).options.headers['X-CSRF-Token'], 'test-csrf');
    const count = f.requests.length; await f.auth.sendPresence('reports'); assert.equal(f.requests.length, count + 1);
    assert.equal(updates, 0); assert.equal(f.auth.snapshot().user, null); assert.equal(f.popupCount, 0);
});

test('presence list client verifies the current owner before requesting private rows', async () => {
    const f = uiFixture({ mainAdmin: true }); await settle();
    await assert.rejects(f.auth.readPresence(), /login_required/);
    f.button.listeners.click(); await settle(); f.continueGoogle(); await f.googleOptions.callback({ access_token: 'token' });
    await f.auth.readPresence(); assert.match(f.requests.at(-1).url, /\/presence$/); assert.equal(f.requests.at(-1).options.method, 'GET');
    f.setMainAdmin(false); await assert.rejects(f.auth.readPresence(), /owner_required/);
    assert.match(f.requests.at(-1).url, /\/session$/);
});

test('replacement client respects individual server permissions before sending writes', async () => {
    const f = uiFixture({ scheduleAdmin: true, permissions: { createReplacements: true, editReplacements: false, cancelReplacements: false } }); await settle();
    f.button.listeners.click(); await settle(); f.continueGoogle(); await f.googleOptions.callback({ access_token: 'token' });
    await assert.rejects(f.auth.changeReplacement({ operation: 'set', revision: 'exists' }), /permission_required/);
    await assert.rejects(f.auth.changeReplacement({ operation: 'remove', revision: 'exists' }), /permission_required/);
    assert.ok(!f.requests.some(item => item.url.endsWith('/replacements')));
    await f.auth.changeReplacement({ operation: 'set', revision: null });
    assert.match(f.requests.at(-1).url, /\/replacements$/);
});

test('replacement conflicts retain their specific message and guests never send a write', async () => {
    const guest = uiFixture(); await settle();
    await assert.rejects(guest.auth.changeReplacement({}), /login_required/);
    assert.ok(!guest.requests.some(item => item.url.endsWith('/replacements')));
    const f = uiFixture({ scheduleAdmin: true, replacementError: 'replacement_conflict' }); await settle();
    f.button.listeners.click(); await settle(); f.continueGoogle(); await f.googleOptions.callback({ access_token: 'token' });
    await assert.rejects(f.auth.changeReplacement({}), /replacement_conflict/);
    assert.match(f.auth.errorMessage(new Error('replacement_conflict')), /іншій вкладці/);
});
