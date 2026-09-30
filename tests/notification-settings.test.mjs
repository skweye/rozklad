import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../site-notifications.js', import.meta.url), 'utf8');
const kinds = ['replacements', 'lessonStart', 'lessonEnd', 'nextLesson', 'announcements', 'success', 'sound'];
const key = kind => `study-notification-${kind}-v1`;
function fixture({ storage = new Map(), blocked = false, loading = false } = {}) {
    class Element {
        children = []; attrs = {}; listeners = {}; textContent = '';
        append(...children) { this.children.push(...children); }
        setAttribute(k, v) { this.attrs[k] = v; }
        addEventListener(k, fn) { this.listeners[k] = fn; }
        insertAdjacentElement(position, el) { assert.equal(position, 'afterend'); this.after = el; }
    }
    const appearance = new Element(), events = {}, domEvents = {}, emitted = [];
    const document = { readyState: loading ? 'loading' : 'complete', querySelector: () => appearance,
        createElement: () => new Element(), addEventListener(name, fn) { domEvents[name] = fn; } };
    const window = { addEventListener(name, fn) { events[name] = fn; }, dispatchEvent(event) { emitted.push(event.type); } };
    vm.runInNewContext(source, { window, document, Event,
        localStorage: { getItem(k) { if (blocked) throw Error('blocked'); return storage.get(k) ?? null; }, setItem(k, v) { if (blocked) throw Error('blocked'); storage.set(k, v); } } });
    return { api: window.studyNotifications, window, appearance, storage, events, domEvents, emitted,
        input(kind) { return appearance.after.children.find(el => el.children?.[1]?.attrs['data-notification-kind'] === kind).children[1]; },
        change(kind, value) { const input = this.input(kind); input.checked = value; input.listeners.change(); } };
}

test('every type starts off even with legacy preferences, mounting after appearance initialization', () => {
    const f = fixture({ loading: true, storage: new Map([['nextLessonRemindersEnabled', 'true'], ['study-background-notifications-v1', 'true']]) });
    for (const kind of kinds) assert.equal(f.api.enabled(kind), false);
    assert.equal(f.appearance.after, undefined);
    f.domEvents.DOMContentLoaded();
    assert.equal(f.appearance.after.attrs['data-notification-settings'], '');
    for (const kind of kinds) assert.equal(f.input(kind).checked, false);
});

test('every independent toggle persists and restores across pages, and can be switched off', () => {
    const f = fixture();
    for (const kind of kinds) {
        f.change(kind, true); assert.equal(f.api.enabled(kind), true);
        assert.equal(f.storage.get(key(kind)), 'true');
        const other = fixture({ storage: f.storage }); assert.equal(other.input(kind).checked, true);
        f.change(kind, false); assert.equal(f.api.enabled(kind), false);
    }
    assert.ok(f.emitted.every(name => name === 'study-notifications-change'));
    f.api.set('unknown', true); assert.equal(f.api.enabled('unknown'), false);
});

test('storage updates, clearing settings and back-forward restoration keep controls synchronized', () => {
    const f = fixture();
    f.storage.set(key('sound'), 'true'); f.events.storage({ key: key('sound') });
    assert.equal(f.input('sound').checked, true);
    f.storage.clear(); f.events.storage({ key: null });
    for (const kind of kinds) assert.equal(f.api.enabled(kind), false);
    f.storage.set(key('lessonEnd'), 'true'); f.events.pageshow();
    assert.equal(f.input('lessonEnd').checked, true);
    f.storage.set(key('lessonEnd'), 'invalid'); f.events.storage({ key: key('lessonEnd') });
    assert.equal(f.input('lessonEnd').checked, false);
});

test('blocked storage defaults off but remains usable for the current tab', () => {
    const f = fixture({ blocked: true });
    f.change('replacements', true); assert.equal(f.api.enabled('replacements'), true);
    assert.match(f.appearance.after.children.at(-1).textContent, /лише в цій вкладці/);
    f.change('replacements', false); assert.equal(f.api.enabled('replacements'), false);
});

test('disable-all clears every preference and also disables the background channel', () => {
    const f = fixture(); let disabled = 0;
    f.window.studyBackgroundNotifications = { disable() { disabled++; } };
    for (const kind of kinds) f.change(kind, true);
    f.appearance.after.children.find(el => el.textContent === 'Вимкнути всі сповіщення').listeners.click();
    for (const kind of kinds) { assert.equal(f.api.enabled(kind), false); assert.equal(f.input(kind).checked, false); }
    assert.equal(disabled, 1);
});

test('all app pages share settings and build publishes the script', async () => {
    for (const file of ['index.html', 'reports/index.html', 'admin/index.html']) {
        const html = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
        assert.match(html, /<script src="(?:\.\.\/|\/)?site-notifications\.js(?:\?v=\d+)?"><\/script>/);
        assert.ok(html.indexOf('site-notifications.js') < html.indexOf('background-notifications.js'));
    }
    const build = await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
    assert.match(build, /'site-notifications.js'/);
});

test('toast categories suppress optional messages while preserving errors, and default clicks never play sound', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const inline = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(item => item[1]).find(item => item.includes('let schedule ='));
    let enabled = new Set(), created = 0, sounds = 0, fetches = 0;
    const element = () => ({ appendChild() {}, addEventListener() {}, style: {}, remove() {} });
    const context = vm.createContext({ window: { studyNotifications: { enabled: kind => enabled.has(kind) } },
        document: { addEventListener() {}, getElementById: element, createElement() { created++; return element(); } },
        localStorage: { getItem() { return null; } }, setTimeout() {}, clearTimeout() {},
        Audio: class { play() { sounds++; return Promise.resolve(); } }, fetch() { fetches++; return Promise.resolve({ ok: false }); } });
    vm.runInContext(inline, context);
    vm.runInContext("showToast('Збережено', ''); showToast('Оголошення', '', 'warning', 6000, 'announcements'); playNotifySound(); fetchAnnouncement();", context);
    assert.equal(created, 0); assert.equal(sounds, 0); assert.equal(fetches, 0);
    vm.runInContext("showToast('Помилка', '', 'error');", context); assert.ok(created > 0); assert.equal(sounds, 0);
    const count = created; enabled.add('success');
    vm.runInContext("showToast('Збережено', '');", context); assert.ok(created > count); assert.equal(sounds, 0);
    enabled.add('sound'); vm.runInContext("playNotifySound();", context); assert.equal(sounds, 1);
    enabled.clear(); vm.runInContext("playNotifySound(true);", context); assert.equal(sounds, 2);
    assert.doesNotMatch(inline.slice(inline.indexOf('const enableAudio =')), /notifyAudio\.play/);
});
