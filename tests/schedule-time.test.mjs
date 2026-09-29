import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../schedule-time.js', import.meta.url), 'utf8');
const window = {};
vm.runInNewContext(source, { window, Date });
const time = window.studyScheduleTime;
const slots = [{ start: '9:00', end: '10:20' }, { start: '10:30', end: '11:50' }, { start: '12:20', end: '13:40' }];
const lesson = name => ({ s: name, t: 'Викладач', r: '205' });

test('upcoming lesson skips current slots, empty windows and empty subgroup arrays', () => {
    const schedule = { 4: [{ common: lesson('Перша') }, { common: [] }, { common: lesson('Третя') }] };
    assert.equal(time.nextLesson(schedule, slots, new Date(2026, 8, 24, 8, 59)).index, 0);
    assert.equal(time.nextLesson(schedule, slots, new Date(2026, 8, 24, 9, 0)).index, 2);
    assert.equal(time.nextLesson(schedule, slots, new Date(2026, 8, 24, 10, 25)).lesson.s, 'Третя');
    assert.equal(time.lessonAt({ 4: [{ common: [{ s: '' }] }] }, 4, 0, 'numerator'), null);
    assert.equal(time.nextLesson({}, slots, new Date(2026, 8, 24)), null);
});

test('Friday and weekend resolve the next Monday using that week’s numerator/denominator', () => {
    const monday = new Date(2026, 8, 28, 9), week = time.weekType(monday);
    const schedule = { 1: [{ num: lesson('Чисельник'), den: lesson('Знаменник') }] };
    for (const now of [new Date(2026, 8, 25, 17), new Date(2026, 8, 26, 12), new Date(2026, 8, 27, 12)]) {
        const next = time.nextLesson(schedule, slots, now);
        assert.equal(next.start, monday.getTime());
        assert.equal(next.week, week);
        assert.equal(next.lesson.s, week === 'numerator' ? 'Чисельник' : 'Знаменник');
    }
    assert.notEqual(time.weekType(new Date(2026, 8, 25)), week);
});

test('a replacement applies only on its date and is used by the upcoming card without mutating the base', () => {
    const schedule = { 4: [{ num: lesson('Чисельник'), den: lesson('Знаменник') }] };
    const records = [{ date: '2026-09-24', index: 0, lesson: lesson('Заміна') }];
    const date = new Date(2026, 8, 24);
    assert.equal(time.effectiveLesson(schedule, date, 0, records).s, 'Заміна');
    assert.equal(time.nextLesson(schedule, slots, new Date(2026, 8, 24, 8), records).lesson.s, 'Заміна');
    const nextWeek = new Date(2026, 9, 1);
    assert.equal(time.effectiveLesson(schedule, nextWeek, 0, records).s, time.weekType(nextWeek) === 'numerator' ? 'Чисельник' : 'Знаменник');
    assert.equal(schedule[4][0].num.s, 'Чисельник');
    assert.equal(time.effectiveLesson(schedule, date, 0, []).s, time.weekType(date) === 'numerator' ? 'Чисельник' : 'Знаменник');
});

test('a window overrides the base with no lesson, skips upcoming and expires next week', () => {
    const schedule = { 4: [{ common: lesson('Перша') }, { common: lesson('Друга') }] };
    const records = [{ date: '2026-09-24', index: 0, lesson: null, source: { kind: 'window' } }];
    assert.equal(time.effectiveLesson(schedule, new Date(2026, 8, 24), 0, records), null);
    assert.equal(time.nextLesson(schedule, slots, new Date(2026, 8, 24, 8), records).lesson.s, 'Друга');
    assert.equal(time.effectiveLesson(schedule, new Date(2026, 9, 1), 0, records).s, 'Перша');
    assert.equal(time.effectiveLesson(schedule, new Date(2026, 8, 24), 0, []).s, 'Перша');
});

test('school clock and week dates stay on Kyiv calendar around midnight and DST', () => {
    const midnight = time.schoolNow(new Date('2026-09-24T21:30:00Z'));
    assert.equal(time.dateKey(midnight), '2026-09-25');
    assert.equal(midnight.getHours(), 0);
    assert.equal(time.dateKey(time.dateForDay(1, midnight)), '2026-09-21');
    assert.equal(time.schoolNow(new Date('2026-10-25T02:30:00Z')).getHours(), 4);
});

test('current lesson is updated in place across start/end without a reload or repeated grid render', async () => {
    // ClockDate represents an actual instant; schoolNow converts it to Kyiv wall time.
    // Explicit September Kyiv offset keeps this fixture independent of the runner's TZ.
    let now = Date.parse('2026-09-24T08:59:00+03:00');
    class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
    function row(index) {
        const classes = new Set(); const badge = { hidden: true };
        return { dataset: { lessonDay: '4', lessonIndex: String(index) }, attrs: {}, badge,
            classList: { toggle(name, active) { if (active) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); } },
            setAttribute(key, value) { this.attrs[key] = value; }, removeAttribute(key) { delete this.attrs[key]; }, querySelector() { return badge; } };
    }
    const rows = [row(0), row(1)], nodes = new Map();
    const document = { addEventListener() {}, querySelectorAll: () => rows, getElementById(id) { if (!nodes.has(id)) nodes.set(id, { textContent: '' }); return nodes.get(id); } };
    const window = {};
    const context = vm.createContext({ window, document, Date: ClockDate, localStorage: { getItem() { return null; } } });
    vm.runInContext(source, context);
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(value => value.includes('let schedule ='));
    vm.runInContext(script, context);
    vm.runInContext(`schedule = { 4: [{common:{s:'Перша'}}, {common:{s:'Друга'}}] }; currentWeekType = getWeekType(); updateLessonHighlights(); updateNextLesson();`, context);
    assert.equal(rows[0].badge.hidden, true);
    assert.match(nodes.get('nextLessonTitle').textContent, /Перша/);
    now = Date.parse('2026-09-24T09:00:00+03:00'); vm.runInContext('updateLessonHighlights(); updateNextLesson();', context);
    assert.equal(rows[0].classList.contains('is-current-lesson'), true);
    assert.equal(rows[0].attrs['aria-current'], 'true');
    assert.equal(rows[0].badge.hidden, false);
    assert.match(nodes.get('nextLessonTitle').textContent, /Друга/);
    now = Date.parse('2026-09-24T10:20:00+03:00'); vm.runInContext('updateLessonHighlights();', context);
    assert.equal(rows[0].classList.contains('is-current-lesson'), false);
    assert.equal(rows[0].badge.hidden, true);
    now = Date.parse('2026-09-24T10:30:00+03:00'); vm.runInContext('updateLessonHighlights();', context);
    assert.equal(rows[1].classList.contains('is-current-lesson'), true);
});
