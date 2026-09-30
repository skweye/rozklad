import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const source = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(item => item[1]).find(item => item.includes('let schedule ='));
function fixture({ preferences = {}, windowReplacement = false } = {}) {
    const events = {}, toasts = [], autoOpens = [];
    const document = { addEventListener() {}, getElementById() { return null; } };
    const window = {
        studyNotifications: { enabled: kind => preferences[kind] === true },
        addEventListener(name, callback) { events[name] = callback; },
        studyScheduleTime: { schoolNow: () => new Date(2026, 8, 24, 8, 55) }
    };
    const context = vm.createContext({ document, window, Date, toasts, autoOpens, mockStatus: { type: 'before_start', diff: 5 },
        localStorage: { getItem() { return null; } } });
    vm.runInContext(source, context);
    vm.runInContext(`getCurrentStatus = () => mockStatus; getLesson = () => ({s:'Тестова пара'}); checkAutoOpen = status => autoOpens.push(status.type); showToast = (...args) => toasts.push(args); hasInteracted = true; prevStatus = {type:'before_start'}; initLessonReminderSettings();`, context);
    if (windowReplacement) vm.runInContext('getLesson = () => null;', context);
    return { toasts, autoOpens,
        change(kind, value) { preferences[kind] = value; events['study-notifications-change'](); },
        tick(status) { if (status) context.mockStatus = status; vm.runInContext('checkNotifications()', context); } };
}

test('all lesson notifications are off by default without disabling automatic opening', () => {
    const f = fixture();
    f.tick(); f.tick({ type: 'break', diff: 3, nextIndex: 1 });
    f.tick({ type: 'in_class', index: 1 }); f.tick({ type: 'after_school' });
    assert.equal(f.toasts.length, 0); assert.equal(f.autoOpens.length, 4);
});

test('opt-in shows each upcoming reminder once and disabling takes immediate effect', () => {
    const f = fixture(); f.change('nextLesson', true);
    f.tick(); f.tick(); assert.equal(f.toasts.length, 1);
    f.tick({ type: 'break', diff: 3, nextIndex: 1 }); f.tick(); assert.equal(f.toasts.length, 2);
    assert.equal(f.toasts[0][4], 'nextLesson');
    f.change('nextLesson', false);
    f.tick({ type: 'break', diff: 2, nextIndex: 2 }); assert.equal(f.toasts.length, 2);
    const restored = fixture({ preferences: { nextLesson: true } }); restored.tick();
    assert.equal(restored.toasts.length, 1);
});

test('windows never announce lesson start, end or upcoming reminders', () => {
    const f = fixture({ preferences: { nextLesson: true, lessonStart: true, lessonEnd: true }, windowReplacement: true });
    f.tick(); f.tick({ type: 'in_class', index: 0 }); f.tick({ type: 'break', diff: 3, nextIndex: 1 });
    f.tick({ type: 'in_class', index: 1 }); f.tick({ type: 'after_school' });
    assert.equal(f.toasts.length, 0);
});

test('lesson start and end are independently opt-in and react to shared setting changes', () => {
    const f = fixture();
    f.change('lessonStart', true); f.tick({ type: 'in_class', index: 0 });
    assert.equal(f.toasts.length, 1); assert.equal(f.toasts[0][4], 'lessonStart');
    f.tick({ type: 'break', diff: 15, nextIndex: 1 }); assert.equal(f.toasts.length, 1);
    f.change('lessonStart', false); f.change('lessonEnd', true);
    f.tick({ type: 'in_class', index: 1 }); assert.equal(f.toasts.length, 1);
    f.tick({ type: 'after_school' }); assert.equal(f.toasts.length, 2);
    assert.equal(f.toasts[1][4], 'lessonEnd');
});
