import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../reports/drafts-store.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);
const { createLibrary, titleFor, openRepository } = context.ReportDraftStore;
const copy = value => JSON.parse(JSON.stringify(value));

// Repository contract: all writes and active-report changes commit together or not at all.
function fixture() {
    const records = new Map();
    let activeId, fail = false, counter = 0;
    const repo = {
        async active() { return copy(records.get(activeId) || null); },
        async list() { return copy([...records.values()]); },
        async commit({ writes = [], activateId, loadId, removeId }) {
            if (fail) throw new Error('QuotaExceededError');
            for (const { record, expected } of writes) {
                if ((records.get(record.id)?.revision || 0) !== expected) throw new Error('draft_conflict');
            }
            if (loadId && !records.has(loadId)) throw new Error('draft_missing');
            if (removeId === activeId && removeId) throw new Error('draft_active');
            for (const { record } of writes) records.set(record.id, copy(record));
            if (activateId) activeId = activateId;
            if (removeId) records.delete(removeId);
            return loadId ? copy(records.get(loadId)) : undefined;
        }
    };
    const create = () => createLibrary(repo, { id: () => `draft-${++counter}`, now: () => '2026-10-06T12:00:00.000Z' });
    return { repo, create, library: create(), records, fail(value) { fail = value; } };
}
const os = { discipline: 'Операційні системи', labNumber: 2, labTheme: 'Windows', studentName: 'Студент', labGoal: 'Вивчити ОС',
    tasks: [{ id: 'image', kind: 'image', dataUrl: 'data:image/png;base64,YWJj', caption: 'Рисунок' }, { id: 'text', kind: 'text', text: 'Абзац 1\nАбзац 2' }],
    questions: [{ id: 1, question: 'Питання', answer: 'Текст' }], conclusionText: 'Висновок', cipher: 'ОС.02' };
const blank = { discipline: '', labNumber: 1, tasks: [], questions: [], studentName: 'Студент' };

test('OS → new ASD → OS preserves separate text, photos, questions and latest edits across reload', async () => {
    const f = fixture(), a = f.library;
    await a.save(os, 'ОС — чернетка');
    const osId = a.current().id;
    const initial = await a.startNew(os, blank);
    assert.deepEqual(copy(initial), blank);
    const asdId = a.current().id;
    assert.notEqual(asdId, osId);
    const asd = { ...blank, discipline: 'АСД', tasks: [{ kind: 'code', text: 'int main() {}' }] };
    await a.save(asd, 'АСД');
    assert.deepEqual(copy(await a.switchTo(osId, asd)), os);
    await a.save({ ...os, labTheme: 'Windows — продовжено' });
    const reloaded = f.create();
    assert.equal((await reloaded.restore()).labTheme, 'Windows — продовжено');
    assert.deepEqual(copy(await reloaded.switchTo(asdId, { ...os, labTheme: 'Windows — продовжено' })), asd);
    assert.equal((await reloaded.list()).length, 2);
});

test('saving captures an independent snapshot; quick edits and switches serialize without duplicates', async () => {
    const f = fixture(), state = copy(os);
    const saving = f.library.save(state);
    state.tasks[0].caption = 'Нова версія';
    await saving;
    assert.equal([...f.records.values()][0].state.tasks[0].caption, 'Рисунок');
    const id = f.library.current().id;
    const first = f.library.save(state);
    const second = f.library.startNew(state, blank);
    await Promise.all([first, second]);
    assert.equal(f.records.size, 2);
    assert.equal(f.records.get(id).state.tasks[0].caption, 'Нова версія');
    assert.equal((await f.repo.active()).state.discipline, '');
});

test('quota failure cannot clear the form, switch active report or partially replace stored work', async () => {
    const f = fixture();
    await f.library.save(os);
    const previous = f.library.current().id;
    const stored = copy([...f.records.values()]);
    f.fail(true);
    await assert.rejects(f.library.startNew({ ...os, labTheme: 'Unsaved' }, blank), /Quota/);
    assert.equal(f.library.current().id, previous);
    assert.deepEqual([...f.records.values()], stored);
    await assert.rejects(f.library.save(os), /Quota/);
    f.fail(false);
    await f.library.save({ ...os, labTheme: 'Recovered' });
    assert.equal((await f.repo.active()).state.labTheme, 'Recovered');
});

test('missing/deleted drafts and concurrent edits are rejected without overwriting another report', async () => {
    const f = fixture();
    await f.library.save(os);
    const otherTab = f.create(); await otherTab.restore();
    await f.library.save({ ...os, labTheme: 'Tab one' });
    await assert.rejects(otherTab.save({ ...os, labTheme: 'Tab two' }), /draft_conflict/);
    await assert.rejects(f.library.switchTo('missing', os), /draft_missing/);
    assert.equal((await f.repo.active()).state.labTheme, 'Tab one');
});

test('names update in place, deletion removes only an inactive selected draft', async () => {
    const f = fixture();
    await f.library.save(os, '  Мій звіт  ');
    const id = f.library.current().id;
    await f.library.save(os, '<img onerror=alert(1)>');
    assert.equal(f.records.size, 1);
    assert.equal(f.library.current().title, '<img onerror=alert(1)>');
    await assert.rejects(f.library.remove(id), /draft_active/);
    await f.library.startNew(os, blank);
    await f.library.remove(id);
    assert.equal(f.records.has(id), false);
    assert.equal(f.records.size, 1);
    assert.equal(titleFor(os), 'Операційні системи · ЛР №2');
});

test('importing a report preserves the old report and unavailable storage fails explicitly', async () => {
    const f = fixture();
    await f.library.save(os);
    const oldId = f.library.current().id;
    const imported = { ...os, discipline: 'АСД', tasks: [] };
    await f.library.startNew(os, imported);
    assert.deepEqual(f.records.get(oldId).state, os);
    assert.deepEqual(await f.repo.active().then(record => record.state), imported);
    await assert.rejects(openRepository(null), /storage_unavailable/);
});

test('legacy single-report migration preserves content and deletes the old copy only after a successful commit', async () => {
    const main = await readFile(new URL('../reports/script.js', import.meta.url), 'utf8');
    const helpers = main.slice(main.indexOf('    async function saveToStorage()'), main.indexOf('    function clearAllData()'));
    const f = fixture(), storage = new Map([['legacy', JSON.stringify(os)]]), state = {};
    const dom = Object.fromEntries(['studentName', 'studentGroup', 'studentTeacher', 'reportYear', 'labNumberInput', 'labTitleDisplay',
        'disciplineInput', 'cipherInput', 'labTheme', 'labGoal', 'labEquipment', 'conclusionText'].map(key => [key, {}]));
    const ctx = vm.createContext({ state, dom, STORAGE_KEY: 'legacy', draftLibrary: f.library, draftsUI: null, conclusionFields: [],
        window: { ReportBlocks: { normalize: value => value, create: (kind, values) => ({ kind, ...values }) } },
        localStorage: { getItem: key => storage.get(key), removeItem: key => storage.delete(key) },
        conclusionDetails() {}, syncConclusionFromGoal() {}, renderTasks() {}, renderQuestions() {}, resizeReportTextAreas() {}, setSaveStatus() {},
        console: { warn() {}, error() {} } });
    vm.runInContext(helpers, ctx);
    assert.equal(ctx.loadFromStorage(), true);
    assert.deepEqual(copy(state.tasks), os.tasks);
    f.fail(true);
    assert.equal(await ctx.saveToStorage(), false);
    assert.ok(storage.has('legacy'));
    f.fail(false);
    assert.equal(await ctx.saveToStorage(), true);
    assert.equal(storage.has('legacy'), false);
    const restored = await f.create().restore();
    assert.deepEqual(copy(restored.tasks), os.tasks);
    assert.deepEqual(copy(restored.questions), os.questions);
    assert.equal(restored.conclusionText, os.conclusionText);
});
