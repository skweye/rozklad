import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../reports/script.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('    function conclusionFromGoal('), source.indexOf('    function bindEvents('));
function fixture(goal, previous = '', confirmed = true) {
    const events = [], state = { labGoal: goal, conclusionText: previous };
    const dom = { labGoal: { value: goal, focus: () => events.push('focus'), addEventListener(type, handler) { this.input = handler; } }, conclusionText: { value: previous } };
    const context = vm.createContext({ state, dom, showAppNotice: () => events.push('notice'),
        showAppConfirm: async () => { events.push('confirm'); return confirmed; },
        resizeTextArea: () => events.push('resize'), triggerAutoSave: () => events.push('save') });
    vm.runInContext(helpers, context);
    vm.runInContext(source.slice(source.indexOf('        dom.labGoal.addEventListener('), source.indexOf('        dom.labEquipment.addEventListener(')), context);
    return { context, state, dom, events, input(value) { dom.labGoal.value = value; dom.labGoal.input({ target: dom.labGoal }); } };
}

test('conclusion follows the requested four-sentence example with grammatical Ukrainian', () => {
    const { conclusionFromGoal: generate } = fixture('').context;
    const text = generate('Навчитися  визначати основні структурні компоненти та їх властивості, складати програми з реалізації найпростіших статичних структур даних мовою програмування С++.');
    assert.equal(text, 'у ході виконання лабораторної роботи було набуто вміння визначати основні структурні компоненти та їх властивості, складати програми з реалізації найпростіших статичних структур даних мовою програмування С++. Під час роботи було опрацьовано теоретичні відомості та практичні завдання. У результаті виконання завдань отримано практичні навички роботи з програмним кодом. Мету лабораторної роботи досягнуто.');
    assert.match(generate('Мета роботи: Вивчити середовище Windows.'), /^у ході виконання лабораторної роботи було вивчено середовище Windows\./);
    assert.doesNotMatch(generate('Вивчити середовище Windows.'), /програмним кодом/);
    assert.match(generate('Ознайомитися з ОС та навчитися працювати з файлами.'), /проведено ознайомлення з ОС та набуто вміння працювати з файлами/);
    assert.match(generate('НАВЧИТИСЯ створити програму.'), /набуто вміння створити програму/);
    assert.match(generate('1. Вивчити API.\r\n2. Закріпити знання.'), /вивчено API; закріплено знання/);
    assert.match(generate('Операційні системи'), /опрацьовано тему: «Операційні системи»/);
    assert.equal(generate('Мета:   '), '');
});

test('typing a goal automatically fills, updates, resizes and saves the conclusion without questions', () => {
    const f = fixture('');
    f.input('Вивчити ОС.');
    assert.equal(f.state.conclusionText, f.context.conclusionFromGoal('Вивчити ОС.'));
    assert.equal(f.dom.conclusionText.value, f.state.conclusionText);
    f.input('Вивчити алгоритми.');
    assert.equal(f.state.conclusionText, f.context.conclusionFromGoal('Вивчити алгоритми.'));
    assert.deepEqual(f.events, ['resize', 'save', 'resize', 'save']);
    f.input('');
    assert.equal(f.state.conclusionText, '');
    assert.equal(f.dom.conclusionText.value, '');
});

test('goal edits preserve manually written conclusions and old drafts', () => {
    const f = fixture('Вивчити ОС.', 'Мету досягнуто частково.');
    f.input('Вивчити алгоритми.');
    assert.equal(f.state.conclusionText, 'Мету досягнуто частково.');
    assert.equal(f.dom.conclusionText.value, 'Мету досягнуто частково.');
    assert.deepEqual(f.events, ['save']);
    f.context.syncConclusionFromGoal();
    assert.equal(f.state.conclusionText, 'Мету досягнуто частково.');
    const emptyDraft = fixture('Вивчити ОС.');
    emptyDraft.context.syncConclusionFromGoal();
    assert.match(emptyDraft.state.conclusionText, /було вивчено ОС/);
    const details = { conclusionActions: 'Відкрито ОС', conclusionSkills: 'роботи з ОС', conclusionOutcome: 'partial', conclusionReason: 'брак часу' };
    f.context.conclusionDetails(details);
    for (const [key, value] of Object.entries(details)) assert.equal(f.state[key], value);
});

test('manual regenerate button needs no extra fields and protects previous text', async () => {
    const f = fixture('Навчитися працювати з таблицями.');
    await f.context.fillConclusionFromGoal();
    assert.equal(f.state.conclusionText, f.context.conclusionFromGoal(f.state.labGoal));
    assert.deepEqual(f.events, ['resize', 'save']);
    const empty = fixture(' ', 'Мій висновок');
    await empty.context.fillConclusionFromGoal();
    assert.equal(empty.state.conclusionText, 'Мій висновок');
    assert.deepEqual(empty.events, ['notice', 'focus']);
    const canceled = fixture('Вивчити ОС.', 'Мій висновок', false);
    await canceled.context.fillConclusionFromGoal();
    assert.equal(canceled.dom.conclusionText.value, 'Мій висновок');
    assert.deepEqual(canceled.events, ['confirm']);
    const accepted = fixture('Вивчити ОС.', 'Мій висновок', true);
    await accepted.context.fillConclusionFromGoal();
    assert.match(accepted.state.conclusionText, /було вивчено ОС/);
    assert.deepEqual(accepted.events, ['confirm', 'resize', 'save']);
});

test('preview uses an inline mixed-case label and the additional form is removed', async () => {
    const html = await readFile(new URL('../reports/index.html', import.meta.url), 'utf8');
    assert.doesNotMatch(html, /id="conclusion(?:Actions|Skills|Outcome|Reason)"/);
    assert.ok(source.includes('<b>Висновок:</b>'));
    assert.doesNotMatch(source, /<h3[^>]*>ВИСНОВОК/);
    assert.match(source, /dom\.conclusionText\.value = state\.conclusionText;\s+syncConclusionFromGoal\(\)/);
    assert.match(source, /dom\.conclusionText\.value = state\.conclusionText \|\| "";\s+syncConclusionFromGoal\(\)/);
});
