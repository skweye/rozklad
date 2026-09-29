import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../site-presence.js', import.meta.url), 'utf8');
const onlineSource = await readFile(new URL('../admin/online.js', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture({ mainAdmin = true, hidden = false, page = 'admin' } = {}) {
    class Element {
        children = []; listeners = {}; textContent = ''; hidden = false; open = false;
        append(...items) { this.children.push(...items); }
        replaceChildren() { this.children = []; }
        setAttribute() {}
        addEventListener(name, fn) { this.listeners[name] = fn; }
        showModal() { this.open = true; }
        close() { this.open = false; this.listeners.close?.(); }
    }
    const body = new Element(); body.dataset = { app: page };
    const mount = new Element(), document = { body, hidden, listeners: {}, createElement: () => new Element(), querySelector: () => page === 'admin' ? mount : null, addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); } };
    let subscribers = [], listCalls = 0, pingCalls = [], pending, fail = false;
    let session = { user: { id: 'owner' }, mainAdmin: false };
    const data = { users: [{ name: '<img src=x>', email: 'student@example.com', page: 'reports', lastSeen: '2026-09-25T08:00:00Z' }], guests: 2, updatedAt: '2026-09-25T08:00:00Z' };
    const window = { listeners: {}, addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }, studyAuth: {
        snapshot: () => session, subscribe(fn) { subscribers.push(fn); }, errorMessage: error => error.message,
        async sendPresence(value) { pingCalls.push(value); },
        async readPresence() { listCalls++; if (fail) throw new Error('presence_unavailable'); return pending || data; }
    } };
    const timers = new Map(); let serial = 0;
    vm.runInNewContext(source + '\n' + onlineSource, { document, window, setInterval(fn, ms) { timers.set(++serial, { fn, ms }); return serial; }, clearInterval(id) { timers.delete(id); } });
    const section = mount.children[0], dialog = section;
    const [header, hint, summary, reload, status, list] = dialog?.children || [];
    return { section, dialog, summary, status, list, timers, pingCalls, get listCalls() { return listCalls; },
        async open() { session = { ...session, mainAdmin }; subscribers.forEach(fn => fn(session)); await settle(); },
        async reload() { await reload.listeners.click(); },
        tick(ms) { [...timers.values()].filter(timer => timer.ms === ms).forEach(timer => timer.fn()); },
        visible(value) { document.hidden = !value; document.listeners.visibilitychange.forEach(fn => fn()); },
        logout() { session = { user: null, mainAdmin: false }; subscribers.forEach(fn => fn(session)); },
        event(name) { window.listeners[name].forEach(fn => fn()); },
        pending(value) { pending = value; }, fail() { fail = true; }
    };
}

test('online panel is owner-only, renders profile text safely and stops polling on logout', async () => {
    const f = fixture(); await settle(); assert.equal(f.listCalls, 0);
    await f.open(); assert.equal(f.dialog.hidden, false); assert.match(f.summary.textContent, /1.*2/);
    assert.equal(f.list.children[0].children[0].textContent, '<img src=x>');
    assert.equal(f.list.children[0].children[0].children.length, 0);
    assert.match(f.list.children[0].children[2].textContent, /Звіти/);
    const count = f.listCalls; f.tick(30000); await settle(); assert.equal(f.listCalls, count + 1);
    f.logout(); f.tick(30000); await settle(); assert.equal(f.listCalls, count + 1);
    const user = fixture({ mainAdmin: false }); await user.open();
    assert.equal(user.section.hidden, true); assert.equal(user.listCalls, 0);
});

test('visible pages send bounded heartbeats, hidden/pagehide stop them and pageshow resumes', async () => {
    const f = fixture({ page: 'reports' }); await settle(); assert.deepEqual(f.pingCalls, ['reports']);
    f.tick(45000); await settle(); assert.equal(f.pingCalls.length, 2);
    f.visible(false); f.tick(45000); await settle(); assert.equal(f.timers.size, 0); assert.equal(f.pingCalls.length, 2);
    f.visible(true); await settle(); assert.equal(f.pingCalls.length, 3);
    f.event('pagehide'); assert.equal(f.timers.size, 0);
    f.event('pageshow'); await settle(); assert.equal(f.pingCalls.length, 4);
    const background = fixture({ hidden: true }); await settle(); assert.equal(background.pingCalls.length, 0);
});

test('logout invalidates late private responses and failed refresh never presents stale users as online', async () => {
    const f = fixture(); let resolve;
    f.pending(new Promise(done => { resolve = done; })); await f.open();
    f.logout(); assert.equal(f.section.hidden, true);
    resolve({ users: [{ name: 'private' }], guests: 0 }); await settle(); assert.equal(f.list.children.length, 0); assert.equal(f.summary.textContent, '');
    const failed = fixture(); await failed.open(); failed.fail(); await failed.reload();
    assert.equal(failed.list.children.length, 0); assert.equal(failed.summary.textContent, ''); assert.match(failed.status.textContent, /presence_unavailable/);
});

test('both pages and public build include the presence module', async () => {
    for (const path of ['index.html', 'reports/index.html']) {
        const html = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
        assert.ok(html.indexOf('site-presence.js') > html.indexOf('site-auth.js'));
        assert.doesNotMatch(html, /admin\/online\.js|data-admin-presence/);
    }
    assert.match(await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8'), /site-presence\.js/);
});
