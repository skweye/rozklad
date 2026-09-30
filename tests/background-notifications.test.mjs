import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../background-notifications.js', import.meta.url), 'utf8');
const workerSource = await readFile(new URL('../schedule-notification-sw.js', import.meta.url), 'utf8');
const item = { id: '2026-09-24/0@a', date: '2026-09-24', index: 0, revision: 'a', lesson: { s: 'Бази даних' } };
function fixture({ permission = 'default', answer = 'granted', supported = true, storage = new Map(), failRegister = false, failShow = false } = {}) {
    class Element { children = []; listeners = {}; attrs = {}; textContent = ''; append(...items) { this.children.push(...items); } setAttribute(k, v) { this.attrs[k] = v; } addEventListener(k, fn) { this.listeners[k] = fn; } }
    const mount = new Element(), document = { hidden: false, querySelector: () => mount, createElement: () => new Element() };
    let permissionCalls = 0, registers = 0;
    const notifications = [];
    const worker = { async showNotification(title, options) { if (failShow) throw Error('failed'); notifications.push({ title, options }); } };
    const Notification = { permission, async requestPermission() { permissionCalls++; this.permission = answer; return answer; } };
    const window = { isSecureContext: supported, Notification, events: [], addEventListener() {}, dispatchEvent(event) { this.events.push(event.type); } };
    const navigator = { serviceWorker: { ready: Promise.resolve(worker), async register(path, options) { registers++; assert.equal(path, '/schedule-notification-sw.js'); assert.equal(options.scope, '/'); if (failRegister) throw Error('failed'); return worker; } }, locks: { request: async (name, callback) => callback() } };
    vm.runInNewContext(source, { window, document, navigator, Notification, Event, setTimeout, clearTimeout,
        localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) } });
    const [legend, button, hint] = mount.children[0].children;
    return { api: window.studyBackgroundNotifications, window, document, Notification, notifications, storage, button, hint,
        get permissionCalls() { return permissionCalls; }, get registers() { return registers; },
        click: () => button.listeners.click() };
}

test('background permission is explicit, opt-in persists, and disabling stops system delivery', async () => {
    const f = fixture();
    assert.equal(f.permissionCalls, 0); assert.equal(f.registers, 0); assert.equal(f.api.enabled(), false);
    await f.click();
    assert.equal(f.permissionCalls, 1); assert.equal(f.api.enabled(), true);
    assert.equal(f.button.attrs['aria-pressed'], 'true');
    assert.equal(f.storage.get('study-background-notifications-v2'), 'true');
    await f.api.show([item]); assert.equal(f.notifications.length, 0);
    f.document.hidden = true; await f.api.show([item]);
    assert.equal(f.notifications.length, 1);
    assert.match(f.notifications[0].options.body, /Бази даних/);
    assert.match(f.notifications[0].options.body, /2026-09-24.*1 пара/);
    await f.click(); assert.equal(f.api.enabled(), false);
    await f.api.show([{ ...item, id: 'b' }]); assert.equal(f.notifications.length, 1);
});

test('background notification explicitly describes a window replacement', async () => {
    const f = fixture(); await f.click(); f.document.hidden = true;
    await f.api.show([{ ...item, lesson: null, source: { kind: 'window' } }]);
    assert.equal(f.notifications.length, 1);
    assert.match(f.notifications[0].options.body, /Вікно — пари немає/);
});

test('old opt-in does not enable the new defaults; system sound follows the shared switch', async () => {
    const f = fixture({ permission: 'granted', storage: new Map([['study-background-notifications-v1', 'true']]) });
    assert.equal(f.api.enabled(), false); assert.equal(f.registers, 0);
    await f.click(); f.document.hidden = true;
    await f.api.show([item]); assert.equal(f.notifications[0].options.silent, true);
    f.window.studyNotifications = { enabled: kind => kind === 'sound' };
    await f.api.show([{ ...item, id: 'b' }]); assert.equal(f.notifications[1].options.silent, false);
});

test('denied, dismissed and unsupported permissions leave usable settings and never register automatically', async () => {
    for (const answer of ['denied', 'default']) {
        const f = fixture({ answer }); await f.click();
        assert.equal(f.api.enabled(), false); assert.equal(f.button.disabled, false); assert.equal(f.registers, 0);
        assert.equal(f.storage.get('study-background-notifications-v2'), 'false');
    }
    const f = fixture({ supported: false }); assert.equal(f.button.disabled, true);
    await f.click(); assert.equal(f.permissionCalls, 0);
});

test('read receipts prevent re-alerting on polls, reload and other tabs; newer versions still notify', async () => {
    const storage = new Map([['study-background-notifications-v2', 'true']]);
    const first = fixture({ storage, permission: 'granted' }); first.document.hidden = true;
    await first.api.show([item]); await first.api.show([item]); assert.equal(first.notifications.length, 1);
    const second = fixture({ storage, permission: 'granted' }); second.document.hidden = true;
    await second.api.show([item]); assert.equal(second.notifications.length, 0);
    await second.api.show([{ ...item, id: 'new-revision' }]); assert.equal(second.notifications.length, 1);
    assert.equal(second.notifications[0].options.renotify, false);
    assert.doesNotMatch(storage.get('study-background-notifications-delivered-v1'), /Бази даних|email|token/);
});

test('worker failures are visible and never mark failed delivery as read; revoked permission stops delivery', async () => {
    const failed = fixture({ failRegister: true }); await failed.click();
    assert.equal(failed.api.enabled(), false); assert.match(failed.hint.textContent, /Не вдалося/);
    const f = fixture({ failShow: true }); await f.click(); f.document.hidden = true; await f.api.show([item]);
    assert.equal(f.storage.has('study-background-notifications-delivered-v1'), false);
    assert.match(f.hint.textContent, /Не вдалося показати/);
    f.Notification.permission = 'denied'; await f.api.show([item]); assert.equal(f.notifications.length, 0);
});

test('worker click opens only the site timetable and does not navigate away from a report draft', async () => {
    for (const path of ['/reports/index.html', '/index.html']) {
        const listeners = {}, opened = [], navigated = []; let closed = false, focused = false;
        const client = { url: `https://example.test${path}`, async focus() { focused = true; return this; }, async navigate(url) { navigated.push(url); } };
        const self = { location: { origin: 'https://example.test' }, addEventListener(name, handler) { listeners[name] = handler; }, clients: { matchAll: async () => [client], openWindow: async url => opened.push(url) } };
        vm.runInNewContext(workerSource, { self, URL });
        let task;
        listeners.notificationclick({ notification: { data: { url: 'https://evil.test' }, close() { closed = true; } }, waitUntil(promise) { task = promise; } });
        await task;
        assert.equal(closed, true); assert.equal(focused, true);
        if (path.startsWith('/reports')) { assert.equal(navigated.length, 0); assert.deepEqual(opened, ['https://example.test/index.html#weeklySchedule']); }
        else { assert.equal(opened.length, 0); assert.deepEqual(navigated, ['https://example.test/index.html#weeklySchedule']); }
    }
    assert.doesNotMatch(workerSource, /addEventListener\(['"](?:push|sync|periodicsync|fetch)['"]|setInterval/);
});

test('both settings pages load background controls and the worker is in the build', async () => {
    for (const file of ['index.html', 'reports/index.html']) {
        const html = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
        assert.ok(html.indexOf('background-notifications.js') < html.indexOf('schedule-notices.js'));
    }
    const build = await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
    assert.match(build, /'schedule-notification-sw.js'/);
});

test('system delivery skips own changes without creating a shared delivery receipt', async () => {
    const f = fixture(); await f.click(); f.document.hidden = true;
    f.window.studyScheduleNotices = { shouldNotify: id => id !== item.id };
    await f.api.show([item]);
    assert.equal(f.notifications.length, 0);
    assert.equal(f.storage.has('study-background-notifications-delivered-v1'), false);
    await f.api.show([{ ...item, id: 'another-admin-revision' }]);
    assert.equal(f.notifications.length, 1);
});
