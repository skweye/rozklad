import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, access } from 'node:fs/promises';
const source = await readFile(new URL('../site-admin.js', import.meta.url), 'utf8');
function fixture(adminPage = true) {
    class Element {
        children = []; listeners = {}; attributes = {}; hidden = false;
        append(node) { this.children.push(node); }
        setAttribute(key, value) { this.attributes[key] = value; }
        addEventListener(name, callback) { this.listeners[name] = callback; }
    }
    const navigation = new Element(), content = new Element(), gate = new Element(), message = new Element(), login = new Element();
    const nodes = { '.site-switcher-panel': navigation, '[data-admin-content]': adminPage ? content : null, '[data-admin-gate]': gate, '[data-admin-message]': message, '[data-admin-login]': login };
    let subscriber, opened = 0, session = { status: 'checking', user: null, mainAdmin: false };
    const redirects = [];
    const window = { location: { replace(url) { redirects.push(url); } }, listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; }, studyAuth: {
        subscribe(fn) { subscriber = fn; }, snapshot: () => session, open() { opened++; }
    } };
    vm.runInNewContext(source, { window, document: { body: { dataset: { app: adminPage ? 'admin' : 'schedule' } }, querySelector: name => nodes[name], createElement: () => new Element() } });
    return { content, gate, message, login, redirects, link: navigation.children[0], get opened() { return opened; },
        update(value) { session = { status: 'ready', ...value }; subscriber(session); }, event(name) { window.listeners[name](); } };
}

test('admin page and navigation default to closed, ordinary and delegated accounts cannot unlock them', () => {
    const f = fixture();
    assert.equal(f.content.hidden, true); assert.equal(f.gate.hidden, false); assert.equal(f.link.hidden, true);
    f.login.listeners.click(); assert.equal(f.opened, 1);
    f.update({ user: { id: 'student' }, scheduleAdmin: true, mainAdmin: false });
    assert.equal(f.content.hidden, true); assert.match(f.message.textContent, /Немає доступу/);
    f.update({ user: { id: 'owner' }, mainAdmin: true });
    assert.equal(f.content.hidden, false); assert.equal(f.gate.hidden, true); assert.equal(f.link.hidden, false);
    assert.equal(f.link.href, '/admin/'); assert.equal(f.link.attributes['aria-current'], 'page');
    f.event('pagehide'); assert.equal(f.content.hidden, true);
    f.update({ user: null, mainAdmin: false }); assert.equal(f.link.hidden, true);
});

test('public navigation adds one owner link without changing the public page', () => {
    const f = fixture(false);
    assert.equal(f.link.hidden, true);
    f.update({ user: { id: 'owner' }, mainAdmin: true });
    assert.equal(f.link.hidden, false); assert.equal(f.link.attributes['aria-current'], undefined);
    f.update({ user: null }); assert.equal(f.link.hidden, true);
    assert.deepEqual(f.redirects, []);
});

test('admin waits for verified session then redirects guests and nonowners exactly once', () => {
    for (const user of [null, { id: 'student' }]) {
        const f = fixture();
        assert.deepEqual(f.redirects, []);
        f.event('pageshow'); assert.deepEqual(f.redirects, []);
        f.update({ user, mainAdmin: false, scheduleAdmin: true });
        assert.deepEqual(f.redirects, ['/']); assert.equal(f.content.hidden, true);
        f.event('pageshow'); f.update({ user, mainAdmin: false });
        assert.deepEqual(f.redirects, ['/']);
    }
});

test('main admin is not redirected while loading or after validation; logout redirects', () => {
    const f = fixture();
    f.update({ status: 'checking', user: null }); assert.deepEqual(f.redirects, []);
    f.update({ user: { id: 'owner' }, mainAdmin: true });
    assert.equal(f.content.hidden, false); assert.deepEqual(f.redirects, []);
    f.update({ user: null, mainAdmin: false }); assert.deepEqual(f.redirects, ['/']);
});

test('network error is not treated as denial and offers retry without exposing content', () => {
    const f = fixture();
    f.update({ status: 'error', user: { id: 'owner' }, mainAdmin: true });
    assert.deepEqual(f.redirects, []); assert.equal(f.content.hidden, true); assert.equal(f.login.hidden, false);
    assert.match(f.message.textContent, /Не вдалося перевірити/);
    f.login.listeners.click(); assert.equal(f.opened, 1);
});

test('admin HTML defaults to a gated shell with correct public assets and responsive inline panels', async () => {
    const html = await readFile(new URL('../admin/index.html', import.meta.url), 'utf8');
    assert.match(html, /data-admin-content hidden/);
    assert.match(html, /noindex, nofollow/);
    assert.match(html, /data-admin-permissions/); assert.match(html, /data-admin-presence/);
    assert.doesNotMatch(html, /@dtsepaton|showModal|localStorage/);
    for (const match of html.matchAll(/(?:src|href)="(\/[^"#]+\.(?:js|css|svg))"/g)) await access(new URL(`..${match[1]}`, import.meta.url));
    const css = await readFile(new URL('../admin/style.css', import.meta.url), 'utf8');
    assert.match(css, /position: static/); assert.match(css, /max-width: 850px/); assert.match(css, /\[hidden\].*display: none !important/);
    const build = await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
    for (const asset of ['admin/index.html', 'admin/style.css', 'admin/online.js', 'site-admin.js']) assert.ok(build.includes(asset));
});
