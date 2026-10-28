import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../reports/metadata.js', import.meta.url), 'utf8');
function fixture(state = { labNumber: 1, discipline: '', cipher: '', variant: '', cipherMode: 'auto' }) {
    class Element {
        value = ''; children = []; events = {};
        replaceChildren(...children) { this.children = children; }
        append(node) { this.children.push(node); }
        addEventListener(type, fn) { this.events[type] = fn; }
    }
    const window = { document: { createElement: () => new Element() } };
    vm.runInNewContext(source, { window });
    const dom = Object.fromEntries(['disciplineInput', 'cipherInput', 'variantInput'].map(key => [key, new Element()]));
    let saves = 0;
    const controller = window.ReportMetadata.mount(state, dom, () => saves++);
    controller.restore();
    return { api: window.ReportMetadata, state, dom, controller, saves: () => saves,
        change(key, value, event = 'change') { dom[key].value = value; dom[key].events[event](); } };
}

test('all requested disciplines generate their own cipher with zero-padded variant and work number', () => {
    const f = fixture();
    assert.equal(f.api.subjects.length, 5);
    for (const [code, name] of f.api.subjects) {
        f.change('disciplineInput', name);
        f.change('variantInput', '6', 'input');
        assert.equal(f.state.cipher, `ФКЗЕ.121${code}06.01ЛР`);
        assert.equal(f.dom.cipherInput.value, code);
    }
    assert.equal(f.api.subjectFor('ОБ’ЄКТНО-ОРІЄНТОВАНЕ ПРОГРАМУВАННЯ')[0], 'ООП');
    for (const value of ['', '0', '-1', '2.5', '100', 'abc']) assert.equal(f.api.cipher('БД', value, 1), '');
});

test('selecting cipher synchronizes discipline and number edits update the single shared state', () => {
    const f = fixture();
    f.change('variantInput', '6', 'input');
    f.change('cipherInput', 'БД');
    assert.equal(f.state.discipline, 'Бази даних');
    assert.equal(f.dom.disciplineInput.value, 'Бази даних');
    assert.equal(f.state.cipher, 'ФКЗЕ.121БД06.01ЛР');
    f.state.labNumber = 12; f.controller.update();
    assert.equal(f.state.cipher, 'ФКЗЕ.121БД06.12ЛР');
    f.change('variantInput', '', 'input'); assert.equal(f.state.cipher, '');
    assert.equal(f.saves(), 3);
});

test('old drafts keep arbitrary subjects and ciphers until the user explicitly selects a replacement', () => {
    const f = fixture({ labNumber: 1, discipline: 'Інший предмет', cipher: '<custom> / F2' });
    assert.equal(f.state.cipher, '<custom> / F2');
    assert.equal(f.dom.disciplineInput.value, 'Інший предмет');
    assert.equal(f.dom.cipherInput.value, 'preserved');
    f.change('variantInput', '6', 'input');
    assert.equal(f.state.cipher, '<custom> / F2');
    f.change('cipherInput', 'ОС');
    assert.equal(f.state.cipher, 'ФКЗЕ.121ОС06.01ЛР');
    const restored = fixture(JSON.parse(JSON.stringify(f.state)));
    assert.equal(restored.state.cipher, f.state.cipher);
    assert.equal(restored.dom.variantInput.value, '06');
});

test('restoration infers an old variant without rewriting its saved cipher and does not leak it to a new draft', () => {
    const f = fixture({ labNumber: 1, discipline: 'Бази даних', cipher: 'ФКЗЕ. 121БД06. 01ЛР' });
    assert.equal(f.state.variant, '06');
    assert.equal(f.state.cipher, 'ФКЗЕ. 121БД06. 01ЛР');
    Object.assign(f.state, { labNumber: 1, discipline: '', cipher: '', variant: '', cipherMode: 'auto' });
    f.controller.restore();
    assert.equal(f.dom.variantInput.value, ''); assert.equal(f.dom.cipherInput.value, '');
});

test('metadata is bundled before editor and persists through storage and draft import', async () => {
    const html = await readFile(new URL('../reports/index.html', import.meta.url), 'utf8');
    const main = await readFile(new URL('../reports/script.js', import.meta.url), 'utf8');
    const build = await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
    assert.match(html, /<select id="disciplineInput"/);
    assert.match(html, /<select id="cipherInput"/);
    assert.ok(html.indexOf('src="metadata.js') < html.indexOf('src="script.js'));
    assert.match(main, /variant: state.variant/); assert.match(main, /cipherMode: state.cipherMode/);
    assert.match(main, /state.variant = loadedState.variant/);
    assert.match(main, /state.variant = saved.variant/);
    assert.match(main, /metadata.update\(\)/);
    assert.ok(build.includes("'reports/metadata.js'"));
});
