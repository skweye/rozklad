import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const source = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(item => item[1]).find(item => item.includes('let schedule ='));
function fixture({ saved = null, blocked = false, windowReplacement = false } = {}) {
    const nodes = new Map(), events = {}, writes = [], toasts = [], autoOpens = [];
    const document = { addEventListener() {}, getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, { checked: false, textContent: '', listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; } });
        return nodes.get(id);
    } };
    const window = { addEventListener(name, callback) { events[name] = callback; }, studyScheduleTime: { schoolNow: () => new Date(2026, 8, 24, 8, 55) } };
    const context = vm.createContext({ document, window, Date, toasts, autoOpens, mockStatus: { type: 'before_start', diff: 5 },
        localStorage: { getItem(key) { if (key !== 'nextLessonRemindersEnabled') return null; if (blocked) throw Error('blocked'); return saved; }, setItem(key, value) { if (blocked) throw Error('blocked'); writes.push([key, value]); } } });
    vm.runInContext(source, context);
    vm.runInContext(`getCurrentStatus = () => mockStatus; getLesson = () => ({s:'Тестова пара'}); checkAutoOpen = status => autoOpens.push(status.type); showToast = (...args) => toasts.push(args); hasInteracted = true; prevStatus = {type:'before_start'}; initLessonReminderSettings();`, context);
    if (windowReplacement) vm.runInContext('getLesson = () => null;', context);
    const toggle = nodes.get('nextLessonRemindersToggle');
    return { nodes, events, writes, toasts, autoOpens, toggle,
        change(enabled) { toggle.checked = enabled; toggle.listeners.change(); },
        tick(status) { if (status) context.mockStatus = status; vm.runInContext('checkNotifications()', context); } };
}

test('upcoming reminders are off by default without disabling automatic opening or lesson status messages', () => {
    const f = fixture(); assert.equal(f.toggle.checked, false);
    f.tick(); f.tick({ type: 'break', diff: 3, nextIndex: 1 });
    assert.equal(f.toasts.length, 0); assert.equal(f.autoOpens.length, 2);
    f.tick({ type: 'in_class', index: 1 }); assert.match(f.toasts[0][0], /Пара началась/);
});

test('opt-in is persisted, restores on reload and shows each upcoming reminder once', () => {
    const f = fixture(); f.change(true);
    assert.deepEqual(f.writes, [['nextLessonRemindersEnabled', 'true']]);
    f.tick(); f.tick(); assert.equal(f.toasts.length, 1);
    f.tick({ type: 'break', diff: 3, nextIndex: 1 }); f.tick(); assert.equal(f.toasts.length, 2);
    f.change(false); f.tick({ type: 'break', diff: 2, nextIndex: 2 }); assert.equal(f.toasts.length, 2);
    assert.equal(fixture({ saved: 'true' }).toggle.checked, true);
    assert.equal(fixture({ saved: 'invalid' }).toggle.checked, false);
});

test('windows never announce lesson start, end or upcoming reminders', () => {
    const f = fixture({ saved: 'true', windowReplacement: true });
    f.tick();
    f.tick({ type: 'in_class', index: 0 });
    f.tick({ type: 'break', diff: 3, nextIndex: 1 });
    f.tick({ type: 'in_class', index: 1 });
    f.tick({ type: 'after_school' });
    assert.equal(f.toasts.length, 0);
});

test('settings sync between tabs and blocked storage remains usable without touching replacement preferences', () => {
    const f = fixture({ saved: 'true' });
    f.events.storage({ key: 'nextLessonRemindersEnabled', newValue: 'false' }); f.tick();
    assert.equal(f.toggle.checked, false); assert.equal(f.toasts.length, 0);
    f.events.storage({ key: 'nextLessonRemindersEnabled', newValue: 'true' }); f.tick(); assert.equal(f.toasts.length, 1);
    f.events.storage({ key: null, newValue: null }); assert.equal(f.toggle.checked, false);
    const blocked = fixture({ blocked: true }); blocked.change(true); blocked.tick();
    assert.equal(blocked.toasts.length, 1);
    assert.match(blocked.nodes.get('nextLessonRemindersStatus').textContent, /не дозволив/);
    assert.ok(f.writes.every(([key]) => key === 'nextLessonRemindersEnabled'));
});
