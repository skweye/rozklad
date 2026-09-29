import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../reports/script.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('    function conclusionFromGoal('), source.indexOf('    function bindEvents('));
function fixture(goal, previous = '', confirmed = true) {
    const events = [], state = { conclusionText: previous, tasks: [{ kind: 'step', text: 'Створено таблицю.' }] };
    const dom = { labGoal: { value: goal, focus: () => events.push('focus') }, conclusionText: { value: previous } };
    for (const [key, value] of Object.entries({ conclusionActions: '', conclusionSkills: 'роботи з таблицями', conclusionOutcome: 'achieved', conclusionReason: '' })) {
        dom[key] = { value, focus: () => events.push(`focus:${key}`) };
    }
    const context = vm.createContext({ state, dom, showAppNotice: () => events.push('notice'),
        showAppConfirm: async () => { events.push('confirm'); return confirmed; },
        resizeTextArea: () => events.push('resize'), triggerAutoSave: () => events.push('save') });
    vm.runInContext(helpers, context);
    return { context, state, dom, events };
}

test('conclusion rewrites Ukrainian goal clauses without placeholders or duplicate punctuation', () => {
    const { conclusionFromGoal: generate } = fixture('').context;
    assert.equal(generate('Мета роботи: Вивчити середовище Windows.'), 'У ході виконання лабораторної роботи було вивчено середовище Windows.');
    assert.equal(generate('Ознайомитися з ОС та навчитися працювати з файлами.'), 'У ході виконання лабораторної роботи було проведено ознайомлення з ОС та набуто вміння працювати з файлами.');
    assert.equal(generate('НАВЧИТИСЯ створити програму.'), 'У ході виконання лабораторної роботи було набуто вміння створити програму.');
    assert.equal(generate('1. Вивчити API.\r\n2. Закріпити знання.'), 'У ході виконання лабораторної роботи було вивчено API; закріплено знання.');
    assert.equal(generate('Операційні системи'), 'У ході виконання лабораторної роботи було опрацьовано тему: «Операційні системи».');
    assert.equal(generate('Мета:   '), '');
});

test('button fills the editable field and saved state, resizes and requests autosave', async () => {
    const f = fixture('Навчитися працювати з таблицями.');
    await f.context.fillConclusionFromGoal();
    assert.equal(f.state.conclusionText, f.dom.conclusionText.value);
    assert.match(f.state.conclusionText, /набуто вміння працювати з таблицями/);
    assert.match(f.state.conclusionText, /виконано такі дії: Створено таблицю/);
    assert.match(f.state.conclusionText, /отримано практичні навички: роботи з таблицями/);
    assert.match(f.state.conclusionText, /Мету лабораторної роботи досягнуто\.$/);
    assert.deepEqual(f.events, ['resize', 'save']);
    assert.match(source, /btnAutoConclusion\.addEventListener\("click", fillConclusionFromGoal\)/);
});

test('explicit action summary overrides steps and partial outcomes require a reason', async () => {
    const f = fixture('Вивчити Windows.');
    f.dom.conclusionActions.value = 'Налаштовано властивості файлів.';
    f.dom.conclusionOutcome.value = 'partial';
    await f.context.fillConclusionFromGoal();
    assert.equal(f.state.conclusionText, '');
    assert.deepEqual(f.events, ['notice', 'focus:conclusionReason']);
    f.dom.conclusionReason.value = 'не завершено останнє завдання';
    await f.context.fillConclusionFromGoal();
    assert.match(f.state.conclusionText, /Налаштовано властивості файлів/);
    assert.doesNotMatch(f.state.conclusionText, /Створено таблицю/);
    assert.match(f.state.conclusionText, /Мету лабораторної роботи досягнуто частково\. Причина: не завершено останнє завдання\./);
    const text = f.context.composeConclusion({ goal: 'Вивчити ОС.', actions: 'Перевірено систему', skills: 'перевірки системи', outcome: 'not-achieved', reason: 'бракувало доступу' });
    assert.match(text, /Мету лабораторної роботи не досягнуто/);
});

test('generator does not invent skills, successful outcomes or actions from code and captions', async () => {
    for (const missing of ['conclusionActions', 'conclusionSkills', 'conclusionOutcome']) {
        const f = fixture('Вивчити ОС.');
        if (missing === 'conclusionActions') f.state.tasks = [{ kind: 'heading', text: 'Завдання' }, { kind: 'code', text: 'print(1)' }, { kind: 'image', caption: 'Результат' }];
        else f.dom[missing].value = '';
        await f.context.fillConclusionFromGoal();
        assert.equal(f.state.conclusionText, '');
        assert.deepEqual(f.events, ['notice', `focus:${missing}`]);
    }
});

test('conclusion inputs restore safely from new and legacy drafts', () => {
    const f = fixture('Вивчити ОС.');
    const details = { conclusionActions: 'Відкрито ОС', conclusionSkills: 'роботи з ОС', conclusionOutcome: 'partial', conclusionReason: 'брак часу' };
    f.context.conclusionDetails(details);
    for (const [key, value] of Object.entries(details)) {
        assert.equal(f.state[key], value);
        assert.equal(f.dom[key].value, value);
    }
    f.context.conclusionDetails({ conclusionOutcome: 'unsafe', conclusionSkills: { bad: true } });
    for (const key of Object.keys(details)) assert.equal(f.dom[key].value, '');
    assert.match(source, /conclusionDetails\(saved\)/);
    assert.match(source, /conclusionDetails\(state\)/);
    assert.match(source, /Object\.fromEntries\(conclusionFields\.map/);
});

test('empty goal and canceled replacement preserve an existing conclusion', async () => {
    const empty = fixture(' ', 'Мій висновок');
    await empty.context.fillConclusionFromGoal();
    assert.equal(empty.state.conclusionText, 'Мій висновок');
    assert.deepEqual(empty.events, ['notice', 'focus']);
    const canceled = fixture('Вивчити ОС.', 'Мій висновок', false);
    await canceled.context.fillConclusionFromGoal();
    assert.equal(canceled.dom.conclusionText.value, 'Мій висновок');
    assert.equal(canceled.state.conclusionText, 'Мій висновок');
    assert.deepEqual(canceled.events, ['confirm']);
    const accepted = fixture('Вивчити ОС.', 'Мій висновок', true);
    await accepted.context.fillConclusionFromGoal();
    assert.match(accepted.state.conclusionText, /було вивчено ОС/);
    assert.deepEqual(accepted.events, ['confirm', 'resize', 'save']);
});
