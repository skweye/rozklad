import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../reports/script.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('    function conclusionFromGoal('), source.indexOf('    function bindEvents('));
function fixture(goal, previous = '', confirmed = true) {
    const events = [], state = { conclusionText: previous };
    const dom = { labGoal: { value: goal, focus: () => events.push('focus') }, conclusionText: { value: previous } };
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
    assert.deepEqual(f.events, ['resize', 'save']);
    assert.match(source, /btnAutoConclusion\.addEventListener\("click", fillConclusionFromGoal\)/);
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
