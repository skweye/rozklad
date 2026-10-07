import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../schedule-replacements.js', import.meta.url), 'utf8');
const clockSource = await readFile(new URL('../schedule-time.js', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const base = { 1: [{ common: { s: 'Бази даних', t: 'Викладач' } }], 4: [{ common: { s: 'Основна пара' } }] };
function fixture({ admin = true, permissions, fail = false, initial = [], schedule = base } = {}) {
    let records = initial, writes = [], noticeUpdates = [], refreshes = 0, reads = 0, failWrite = false, subscriber;
    let timestamp = Date.parse('2026-09-24T06:00:00Z');
    class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [timestamp])); } static now() { return timestamp; } }
    class Element {
        children = []; listeners = {}; attrs = {}; value = ''; textContent = ''; hidden = false; disabled = false; open = false;
        addEventListener(name, handler) { this.listeners[name] = handler; }
        setAttribute(name, value) { this.attrs[name] = value; }
        append(...items) { this.children.push(...items); }
        appendChild(item) { this.children.push(item); }
        replaceChildren() { this.children = []; }
        contains() { return true; }
        focus() { this.focused = true; }
        showModal() { this.open = true; }
        close() { this.open = false; this.listeners.close?.(); }
        querySelector(selector) { return this.parts[selector]; }
        set innerHTML(value) {
            this.markup = value;
            this.parts = Object.fromEntries(['form', '.replacement-save', '.replacement-picker', '.replacement-search', '.replacement-choices', '.replacement-selection', '.replacement-empty', '.replacement-message', '.replacement-remove', '.replacement-date', '.replacement-base', '.replacement-close', '.replacement-cancel'].map(key => [key, new Element()]));
            this.parts.form.querySelectorAll = () => [this.parts['.replacement-search'], this.parts['.replacement-close'], this.parts['.replacement-cancel'], this.parts['.replacement-remove'], ...this.parts['.replacement-choices'].children.map(node => node.children[0])];
        }
        get innerHTML() { return this.markup || ''; }
    }
    const nodes = Object.fromEntries(['scheduleGrid', 'replacementStatus', 'refreshReplacements', 'toggleReplacementEditing'].map(key => [key, new Element()]));
    const body = new Element(), document = { hidden: false, listeners: {}, body, getElementById: id => nodes[id], createElement: () => new Element(), addEventListener(name, handler) { this.listeners[name] = handler; } };
    const timers = new Map(); let timerId = 0;
    const window = { listeners: {}, addEventListener(name, handler) { this.listeners[name] = handler; },
        studyScheduleNotices: { update(records, suppressedIds) { noticeUpdates.push({ records, suppressedIds: [...suppressedIds] }); } },
        scheduleReplacementView: { schedule: () => schedule, refresh() { refreshes++; } },
        studyAuth: { snapshot: () => ({ scheduleAdmin: admin, permissions }), subscribe(fn) { subscriber = fn; }, errorMessage: error => error.message,
            async changeReplacement(data) {
                if (failWrite) throw new Error('replacement_conflict');
                writes.push(data);
                const replacement = data.operation === 'set' ? { date: data.date, index: data.index, revision: 'new-revision', lesson: data.source.kind === 'window' ? null : schedule[data.source.day][data.source.index][data.source.variant], source: data.source } : null;
                records = records.filter(item => item.date !== data.date || item.index !== data.index);
                if (replacement) records.push(replacement);
                return { replacement, date: data.date, index: data.index, notificationId: `${data.date}/${data.index}@${replacement ? replacement.revision : `removed:${data.revision}`}` };
            }
        }
    };
    const context = vm.createContext({ window, document, Date: ClockDate, AbortSignal,
        fetch: async () => { reads++; if (fail) throw new Error('offline'); return Response.json({ replacements: records }); },
        setInterval(fn) { timers.set(++timerId, fn); return timerId; }, clearInterval(id) { timers.delete(id); } });
    vm.runInContext(clockSource, context); vm.runInContext(source, context);
    const dialog = body.children[0];
    return { window, document, nodes, dialog, timers, writes, noticeUpdates, get reads() { return reads; }, get refreshes() { return refreshes; },
        setFail(value) { fail = value; }, setFailWrite(value) { failWrite = value; },
        role(value) { admin = value; subscriber({ scheduleAdmin: value }); },
        enable() { nodes.toggleReplacementEditing.listeners.click(); },
        choose(index) { dialog.parts['.replacement-choices'].children[index].children[0].listeners.change(); },
        open(date = '2026-09-24', index = 0) { nodes.scheduleGrid.listeners.click({ target: { closest: () => ({ dataset: { replacementDate: date, replacementIndex: String(index) } }) } }); },
        async save() { dialog.parts.form.listeners.submit({ preventDefault() {} }); await settle(); },
        tick() { [...timers.values()][0]?.(); }
    };
}

test('delegated controls match create-only and cancel-only rights', async () => {
    const current = { date: '2026-09-24', index: 0, revision: 'existing', lesson: { s: 'Заміна' }, source: { day: 1, index: 0, variant: 'common' } };
    const createOnly = fixture({ permissions: { createReplacements: true, editReplacements: false, cancelReplacements: false }, initial: [current] });
    await settle(); createOnly.enable(); createOnly.open();
    assert.equal(createOnly.dialog.open, false);
    assert.equal(createOnly.window.studyReplacements.canEditSlot(null), true);
    assert.equal(createOnly.window.studyReplacements.canEditSlot(current), false);
    const cancelOnly = fixture({ permissions: { createReplacements: false, editReplacements: false, cancelReplacements: true }, initial: [current] });
    await settle(); cancelOnly.enable(); cancelOnly.open();
    assert.equal(cancelOnly.dialog.open, true);
    assert.equal(cancelOnly.dialog.parts['.replacement-save'].hidden, true);
    assert.equal(cancelOnly.dialog.parts['.replacement-picker'].hidden, true);
    assert.equal(cancelOnly.dialog.parts['.replacement-remove'].hidden, false);
    await cancelOnly.save(); assert.equal(cancelOnly.writes.length, 0);
    cancelOnly.dialog.parts['.replacement-remove'].listeners.click(); await settle();
    assert.equal(cancelOnly.writes[0].operation, 'remove');
    cancelOnly.open(); assert.equal(cancelOnly.dialog.open, false);
});

test('only an admin with loaded replacements sees an editor; selection saves a date, index and trusted source reference', async () => {
    const f = fixture();
    assert.equal(f.window.studyReplacements.canEdit(), false);
    await settle();
    assert.equal(f.window.studyReplacements.canEdit(), false);
    f.open(); assert.equal(f.dialog.open, false);
    f.enable();
    assert.equal(f.window.studyReplacements.canEdit(), true);
    f.open();
    assert.equal(f.dialog.open, true);
    assert.match(f.dialog.parts['.replacement-date'].textContent, /24.*2026.*1/);
    assert.match(f.dialog.parts['.replacement-base'].textContent, /Основна пара/);
    assert.equal(f.dialog.parts['.replacement-choices'].children[1].children[1].children[0].textContent, 'Бази даних');
    await f.save(); assert.equal(f.writes.length, 0); // required choice
    f.choose(1); await f.save();
    assert.equal(f.dialog.open, false);
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].date, '2026-09-24');
    assert.equal(f.writes[0].revision, null);
    assert.equal(f.writes[0].source.variant, 'common');
    assert.equal(f.window.studyReplacements.entries()[0].lesson.s, 'Бази даних');
    assert.ok(f.noticeUpdates.at(-1).suppressedIds.includes('2026-09-24/0@new-revision'));
    assert.match(f.nodes.replacementStatus.textContent, /збережено/);
    assert.doesNotMatch(JSON.stringify(f.writes), /email|lesson|<script/);
    f.open(); assert.equal(f.dialog.parts['.replacement-remove'].hidden, false);
    f.dialog.parts['.replacement-remove'].listeners.click(); await settle();
    assert.equal(f.writes[1].operation, 'remove');
    assert.equal(f.writes[1].revision, 'new-revision');
    assert.equal(f.window.studyReplacements.entries().length, 0);
    assert.ok(f.noticeUpdates.at(-1).suppressedIds.includes('2026-09-24/0@removed:new-revision'));
});

test('window is the first searchable choice, persists selection and can be cancelled', async () => {
    const f = fixture(); await settle(); f.enable(); f.open();
    const options = f.dialog.parts['.replacement-choices'].children;
    assert.equal(options[0].children[1].children[0].textContent, 'Вікно');
    const search = f.dialog.parts['.replacement-search']; search.value = 'вікно'; search.listeners.input();
    assert.equal(options[0].hidden, false); assert.equal(options[1].hidden, true);
    f.choose(0); assert.match(f.dialog.parts['.replacement-selection'].textContent, /Вікно/);
    await f.save();
    assert.equal(f.writes[0].source.kind, 'window');
    assert.equal(f.window.studyReplacements.entries()[0].lesson, null);
    f.open();
    assert.equal(f.dialog.parts['.replacement-choices'].children[0].children[0].checked, true);
    f.dialog.parts['.replacement-remove'].listeners.click(); await settle();
    assert.equal(f.writes[1].operation, 'remove');
    assert.equal(f.window.studyReplacements.entries().length, 0);
});

test('debt sessions are excluded from every replacement variant without changing the timetable or source indices', async () => {
    const regular = { s: 'Бази даних', t: 'Викладач' };
    const debt = { ...regular, note: 'борги і т.д.' };
    const schedule = { ...base, 1: [
        { common: debt },
        { num: { ...debt, note: ' БОРГИ і т. д. ' }, den: regular },
        { common: [{ s: 'Підгрупи', g: 'I' }, { s: 'Підгрупи', g: 'II', note: 'борги і т.д.' }] },
        { den: debt },
        { common: { s: 'Практична пара', note: 'Практика' } }
    ] };
    const original = JSON.stringify(schedule);
    const f = fixture({ schedule }); await settle(); f.enable(); f.open();
    const options = f.dialog.parts['.replacement-choices'].children;
    assert.deepEqual(options.map(node => node.children[1].children[0].textContent), ['Вікно', 'Бази даних', 'Практична пара', 'Основна пара']);
    const search = f.dialog.parts['.replacement-search']; search.value = 'борги'; search.listeners.input();
    assert.ok(options.every(node => node.hidden));
    assert.equal(f.dialog.parts['.replacement-empty'].hidden, false);
    search.value = ''; search.listeners.input(); f.choose(1); await f.save();
    assert.equal(JSON.stringify(f.writes[0].source), JSON.stringify({ day: 1, index: 1, variant: 'den' }));
    assert.equal(JSON.stringify(schedule), original);
});

test('real schedule offers ordinary lessons and a window without debt-marked duplicates', async () => {
    const schedule = JSON.parse(await readFile(new URL('../schedule.json', import.meta.url), 'utf8'));
    const f = fixture({ schedule }); await settle(); f.enable(); f.open();
    const options = f.dialog.parts['.replacement-choices'].children;
    assert.ok(options.length > 1);
    for (const node of options) assert.doesNotMatch(node.children[1].children.map(child => child.textContent).join(' '), /борги/iu);
    assert.ok(options.some(node => node.children[1].children[0].textContent === 'Бази даних'));
    assert.ok(JSON.stringify(schedule).includes('борги і т.д.'));
});

test('visitors read replacements but cannot open editor; logout removes editing immediately', async () => {
    const f = fixture({ admin: false, initial: [{ date: '2026-09-24', index: 0, lesson: { s: 'Заміна' } }] });
    await settle(); f.open();
    assert.equal(f.window.studyReplacements.entries().length, 1);
    assert.equal(f.dialog.open, false);
    f.role(true); f.enable(); f.open(); assert.equal(f.dialog.open, true);
    f.role(false); assert.equal(f.dialog.open, false);
    assert.equal(f.window.studyReplacements.canEdit(), false);
    assert.equal(f.nodes.toggleReplacementEditing.hidden, true);
    assert.equal(f.writes.length, 0);
});

test('offline reads are explicit, preserve last data and block stale editing until recovery', async () => {
    const f = fixture({ fail: true }); await settle();
    assert.match(f.nodes.replacementStatus.textContent, /основний розклад/);
    f.open(); assert.equal(f.dialog.open, false);
    f.setFail(false); await f.nodes.refreshReplacements.listeners.click();
    f.enable();
    assert.equal(f.window.studyReplacements.canEdit(), true);
    f.setFail(true); await f.nodes.refreshReplacements.listeners.click();
    assert.match(f.nodes.replacementStatus.textContent, /останні отримані/);
    assert.equal(f.window.studyReplacements.canEdit(), false);
});

test('conflict leaves the dialog and selection intact without announcing successful save', async () => {
    const f = fixture(); await settle(); f.enable(); f.open(); f.choose(1);
    f.setFailWrite(true); await f.save();
    assert.equal(f.dialog.open, true);
    assert.equal(f.dialog.parts['.replacement-choices'].children[1].children[0].checked, true);
    assert.equal(f.dialog.parts['.replacement-search'].disabled, false);
    assert.match(f.dialog.parts['.replacement-message'].textContent, /replacement_conflict/);
    assert.equal(f.writes.length, 0);
    assert.doesNotMatch(f.nodes.replacementStatus.textContent, /збережено/);
});

test('polling pauses in background and resumes on return; past days cannot open', async () => {
    const f = fixture(); await settle(); f.enable(); f.open('2026-09-23');
    assert.equal(f.dialog.open, false);
    assert.equal(f.timers.size, 1);
    f.document.hidden = true; f.document.listeners.visibilitychange(); assert.equal(f.timers.size, 0);
    const before = f.reads;
    f.document.hidden = false; f.document.listeners.visibilitychange(); await settle();
    assert.equal(f.timers.size, 1); assert.equal(f.reads, before + 1);
    f.window.listeners.pagehide(); assert.equal(f.timers.size, 0);
});

test('edit mode is opt-in and can be turned off; searchable radio cards retain selection when filtered', async () => {
    const f = fixture(); await settle();
    assert.equal(f.window.studyReplacements.canEdit(), false);
    assert.equal(f.nodes.toggleReplacementEditing.attrs['aria-pressed'], 'false');
    f.enable(); f.open(); f.choose(1);
    assert.match(f.dialog.parts['.replacement-selection'].textContent, /Бази даних/);
    const search = f.dialog.parts['.replacement-search'];
    search.value = 'основна'; search.listeners.input();
    const options = f.dialog.parts['.replacement-choices'].children;
    assert.equal(options[0].hidden, true); assert.equal(options[1].hidden, true); assert.equal(options[2].hidden, false);
    assert.equal(options[1].children[0].checked, true);
    search.value = 'нічого такого'; search.listeners.input();
    assert.equal(f.dialog.parts['.replacement-empty'].hidden, false);
    search.value = 'викладач'; search.listeners.input(); assert.equal(options[1].hidden, false);
    f.dialog.close(); f.enable();
    assert.equal(f.window.studyReplacements.canEdit(), false);
    f.open(); assert.equal(f.dialog.open, false);
});

test('schedule keeps polling in background only with notification opt-in', async () => {
    const f = fixture(); await settle();
    f.window.studyBackgroundNotifications = { enabled: () => true };
    f.document.hidden = true; f.document.listeners.visibilitychange(); await settle();
    assert.equal(f.timers.size, 1);
    const before = f.reads; f.tick(); await settle(); assert.equal(f.reads, before + 1);
    f.window.studyBackgroundNotifications.enabled = () => false;
    f.window.listeners['study-background-notifications-change'](); assert.equal(f.timers.size, 0);
});

test('actual schedule rendering displays the replacement and restores next week, escaping public text', async () => {
    let timestamp = Date.parse('2026-09-24T06:00:00Z'), admin = true;
    class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [timestamp])); } static now() { return timestamp; } }
    const grid = { children: [], set innerHTML(value) { this.children = []; }, appendChild(item) { this.children.push(item); } };
    const document = { addEventListener() {}, getElementById: () => grid, querySelectorAll: () => [], createElement: () => ({ classList: { add() {} } }) };
    const window = { studyReplacements: { entries: () => [{ date: '2026-09-24', index: 0, lesson: { s: '<img src=x onerror=bad()>', t: '<script>bad</script>' } }], canEdit: () => admin } };
    const context = vm.createContext({ window, document, Date: ClockDate, localStorage: { getItem() { return null; } } });
    vm.runInContext(clockSource, context);
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const inline = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(item => item[1]).find(item => item.includes('let schedule ='));
    vm.runInContext(inline, context);
    vm.runInContext(`schedule = ${JSON.stringify(base)}; currentWeekType = getWeekType(); renderSchedule();`, context);
    let rendered = grid.children.map(item => item.innerHTML).join('');
    assert.match(rendered, /replacement-badge/);
    assert.match(rendered, /data-replacement-date="2026-09-24"/);
    assert.match(rendered, /&lt;img/); assert.doesNotMatch(rendered, /<img|<script/);
    assert.match(rendered, /Замість: Основна пара/);
    admin = false; vm.runInContext('renderSchedule()', context);
    assert.doesNotMatch(grid.children.map(item => item.innerHTML).join(''), /data-replacement-date/);
    window.studyReplacements.entries = () => [{ date: '2026-09-24', index: 0, lesson: null, source: { kind: 'window' } }];
    vm.runInContext('renderSchedule()', context);
    rendered = grid.children.map(item => item.innerHTML).join('');
    assert.match(rendered, /class="subject-name">Вікно<\/span>/);
    assert.match(rendered, /Замість: Основна пара/);
    assert.doesNotMatch(rendered, /is-current-lesson/);
    assert.equal(vm.runInContext('getLesson(4, 0, currentWeekType)', context), null);
    timestamp = Date.parse('2026-10-01T06:00:00Z'); vm.runInContext('currentWeekType = getWeekType(); renderSchedule()', context);
    rendered = grid.children.map(item => item.innerHTML).join('');
    assert.doesNotMatch(rendered, /replacement-badge|&lt;img/);
    assert.match(rendered, /Основна пара/);
});
