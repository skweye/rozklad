import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../reports/blocks.js', import.meta.url), 'utf8');

test('table redraw preserves page, editor and horizontal table scroll after content replacement', () => {
    const view = { scrollX: 0, scrollY: 2400, scrollTo({ left, top }) { this.scrollX = left; this.scrollY = top; } };
    const parent = { scrollTop: 350, scrollLeft: 0, parentElement: null };
    let table = { scrollLeft: 210, closest: () => ({ dataset: { block: 'table-1' } }) };
    const container = { scrollTop: 0, scrollLeft: 0, parentElement: parent, ownerDocument: { defaultView: view },
        querySelectorAll: () => [table], querySelector: () => table };
    let changes = 0;
    const start = source.indexOf('        const changed = (redraw = false) => {');
    const end = source.indexOf('        dialog.querySelectorAll', start);
    const scope = { container, onChange() { changes++; }, render() {
        view.scrollY = 0; parent.scrollTop = 0;
        table = { scrollLeft: 0 };
    } };
    vm.runInNewContext(source.slice(start, end) + '\nchanged(true);', scope);
    assert.equal(view.scrollY, 2400);
    assert.equal(parent.scrollTop, 350);
    assert.equal(table.scrollLeft, 210);
    assert.equal(changes, 1);
});

test('adding a table row updates its structure without a redraw or moving focus', async () => {
    const start = source.indexOf('        container.addEventListener("click", async e => {');
    const end = source.indexOf('        async function upload(', start);
    const item = { id: 'table-1', rows: [['existing']] };
    const button = { dataset: { action: 'add-row' }, hasAttribute: () => false,
        closest: () => ({ dataset: { block: item.id } }) };
    let updated = false, notified = false, handler;
    const container = { addEventListener(type, fn) { handler = fn; } };
    vm.runInNewContext(source.slice(start, end), { container, getItems: () => [item],
        changed() { assert.fail('Table structure must not redraw the editor'); },
        focusBlock() { assert.fail('Table structure must not move focus'); },
        updateTableStructure(card, block, action) { assert.equal(block, item); assert.equal(action, 'add-row'); updated = true; },
        onChange() { notified = true; } });
    await handler({ target: { closest: () => button } });
    assert.equal(item.rows.length, 2);
    assert.equal(updated, true);
    assert.equal(notified, true);
});

test('columns can be added repeatedly beyond six without a redraw or losing existing content', async () => {
    const start = source.indexOf('        container.addEventListener("click", async e => {');
    const end = source.indexOf('        async function upload(', start);
    const original = Array.from({ length: 3 }, (_, r) => Array.from({ length: 6 }, (_, c) => `${r}:${c}`));
    const item = { id: 'wide-table', rows: original.map(row => [...row]) };
    const button = { dataset: { action: 'add-column' }, hasAttribute: () => false,
        closest: () => ({ dataset: { block: item.id } }) };
    let updated = 0, notified = 0, handler;
    const container = { addEventListener(type, fn) { handler = fn; } };
    vm.runInNewContext(source.slice(start, end), { container, getItems: () => [item],
        changed() { assert.fail('Table structure must not redraw the editor'); },
        focusBlock() { assert.fail('Table structure must not move focus'); },
        updateTableStructure(card, block, action) { assert.equal(block, item); assert.equal(action, 'add-column'); updated++; },
        onChange() { notified++; } });
    for (let i = 0; i < 24; i++) await handler({ target: { closest: () => button } });
    assert.equal(updated, 24);
    assert.equal(notified, 24);
    item.rows.forEach((row, r) => assert.deepEqual(row, [...original[r], ...Array(24).fill('')]));
});

test('table structure changes preserve existing textareas and their selection', () => {
    function row() { return { cells: [], insertCell() { const cell = { append(input) { this.input = input; } }; this.cells.push(cell); return cell; }, deleteCell() { this.cells.pop(); } }; }
    const body = { rows: [row()], insertRow() { const next = row(); this.rows.push(next); return next; }, deleteRow() { this.rows.pop(); } };
    const original = { value: 'Existing text', selectionStart: 4, selectionEnd: 9 };
    body.rows[0].insertCell().append(original);
    const controls = {};
    const widths = [];
    const table = { style: { setProperty(name, value) { assert.equal(name, '--rb-table-columns'); widths.push(value); } } };
    const card = { querySelector(selector) { if (selector === '.rb-edit-table tbody') return body; if (selector === '.rb-edit-table') return table; return controls[selector] ||= {}; } };
    const block = { rows: [['Existing text'], ['']] };
    const start = source.indexOf('        function updateTableStructure(');
    const end = source.indexOf('        container.addEventListener("click"', start);
    const scope = { document: { createElement: () => ({ dataset: {}, setAttribute() {} }) }, resize() {}, card, block };
    vm.runInNewContext(source.slice(start, end) + '\nupdateTableStructure(card, block, "add-row");', scope);
    assert.equal(body.rows.length, 2);
    assert.equal(body.rows[0].cells[0].input, original);
    assert.equal(original.selectionStart, 4);
    block.rows.forEach(row => row.push(''));
    vm.runInNewContext('updateTableStructure(card, block, "add-column");', scope);
    assert.equal(body.rows[0].cells.length, 2);
    assert.equal(body.rows[0].cells[0].input, original);
    assert.equal(body.rows[1].cells[1].input.dataset.row, '1');
    assert.equal(body.rows[1].cells[1].input.dataset.column, '1');
    assert.deepEqual(widths, [1, 2]);
});
