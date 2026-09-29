import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../reports/script.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('    function questionText('), source.indexOf('    function focusQuestion('));
const context = vm.createContext({});
vm.runInContext(helpers, context);
const { questionText, numberedQuestion, parseQuestionLines } = context;

test('questions get consecutive numbers after additions, deletion and reordering', () => {
    const questions = ['Що таке ОС?', 'Для чого потрібен драйвер?', 'Що таке процес?'];
    assert.deepEqual(questions.map(numberedQuestion), ['1 Що таке ОС?', '2 Для чого потрібен драйвер?', '3 Що таке процес?']);
    questions.splice(1, 1);
    questions.push('Що таке потік?');
    assert.deepEqual(questions.map(numberedQuestion), ['1 Що таке ОС?', '2 Що таке процес?', '3 Що таке потік?']);
    questions.reverse();
    assert.equal(numberedQuestion(questions[0], 0), '1 Що таке потік?');
});

test('copied numbering is removed without removing meaningful numeric question text', () => {
    assert.deepEqual(Array.from(parseQuestionLines('5. Перше?\r\n\n12) Друге?\u2028Третє?')), ['Перше?', 'Друге?', 'Третє?']);
    assert.equal(numberedQuestion('17. Питання?', 0), '1 Питання?');
    for (const text of ['32 біти — це скільки байтів?', '3.14 — що за число?', '2026 рік']) assert.equal(questionText(text), text);
    assert.equal(numberedQuestion('', 1), '2 (Запитання не заповнено)');
});

test('editor leaves numbers outside editable text and preview/export share the numbering helper', () => {
    const add = source.slice(source.indexOf('    function addNewQuestion('), source.indexOf('    function questionText('));
    assert.match(add, /question: ""/);
    assert.match(source, /aria-label="Запитання \$\{index \+ 1\}"/);
    assert.match(source, /escapeHtml\(numberedQuestion\(q.question, index\)\)/);
    assert.match(source, /text: numberedQuestion\(q.question, index\)/);
    assert.doesNotThrow(() => new vm.Script(source));
});

test('document paragraphs number even blank questions and retain their answers', () => {
    const start = source.lastIndexOf('            state.questions.forEach((q, index) => {');
    const end = source.indexOf('\n            });', start) + '\n            });'.length;
    const children = [];
    const output = vm.createContext({
        state: { questions: [{ question: '9) Перше?', answer: 'Відповідь один' }, { question: '', answer: 'Збережена відповідь' }, { question: 'Третє?', answer: '' }] },
        children, numberedQuestion,
        Paragraph: class { constructor(value) { Object.assign(this, value); } },
        TextRun: class { constructor(value) { Object.assign(this, value); } },
        AlignmentType: { BOTH: 'both' }, LineRuleType: { AUTO: 'auto' }
    });
    vm.runInContext(source.slice(start, end), output);
    assert.equal(children.length, 6);
    assert.equal(children[0].children[0].text, '1 Перше?');
    assert.equal(children[2].children[0].text, '2 (Запитання не заповнено)');
    assert.equal(children[3].children[1].text, 'Збережена відповідь');
    assert.equal(children[4].children[0].text, '3 Третє?');
});
