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

test('inserting below a numbered row updates the data without a redraw or moving focus', async () => {
    const start = source.indexOf('        container.addEventListener("click", async e => {');
    const end = source.indexOf('        async function upload(', start);
    const item = { id: 'table-1', rows: [['first'], ['second']] };
    const button = { dataset: { action: 'add-row', tableIndex: '0' }, hasAttribute: () => false,
        closest: () => ({ dataset: { block: item.id } }) };
    let updated = false, notified = false, handler;
    const container = { addEventListener(type, fn) { handler = fn; } };
    vm.runInNewContext(source.slice(start, end), { container, getItems: () => [item],
        changed() { assert.fail('Table structure must not redraw the editor'); },
        focusBlock() { assert.fail('Table structure must not move focus'); },
        updateTableStructure(card, block, axis, adding, at) { assert.equal(block, item); assert.equal(axis, 'row'); assert.equal(adding, true); assert.equal(at, 1); updated = true; },
        onChange() { notified = true; } });
    await handler({ target: { closest: () => button } });
    assert.deepEqual(Array.from(item.rows, row => [...row]), [['first'], [''], ['second']]);
    assert.equal(updated, true);
    assert.equal(notified, true);
});

test('columns can be added repeatedly beyond six without a redraw or losing existing content', async () => {
    const start = source.indexOf('        container.addEventListener("click", async e => {');
    const end = source.indexOf('        async function upload(', start);
    const original = Array.from({ length: 3 }, (_, r) => Array.from({ length: 6 }, (_, c) => `${r}:${c}`));
    const item = { id: 'wide-table', rows: original.map(row => [...row]) };
    const button = { dataset: { action: 'add-column', tableIndex: '5' }, hasAttribute: () => false,
        closest: () => ({ dataset: { block: item.id } }) };
    let updated = 0, notified = 0, handler;
    const container = { addEventListener(type, fn) { handler = fn; } };
    vm.runInNewContext(source.slice(start, end), { container, getItems: () => [item],
        changed() { assert.fail('Table structure must not redraw the editor'); },
        focusBlock() { assert.fail('Table structure must not move focus'); },
        updateTableStructure(card, block, axis, adding, at) {
            assert.equal(block, item); assert.equal(axis, 'column'); assert.equal(adding, true);
            assert.equal(at, item.rows[0].length - 1);
            button.dataset.tableIndex = String(at);
            updated++;
        },
        onChange() { notified++; } });
    for (let i = 0; i < 24; i++) await handler({ target: { closest: () => button } });
    assert.equal(updated, 24);
    assert.equal(notified, 24);
    item.rows.forEach((row, r) => assert.deepEqual(row, [...original[r], ...Array(24).fill('')]));
});

test('table coordinates track structure changes without shifting cell data or selection', () => {
    const element = () => ({ dataset: {}, setAttribute() {}, append(child) { this.firstElementChild = child; } });
    function row() {
        const cells = [];
        const tableCell = () => ({
            ...element(),
            insertAdjacentHTML(where, markup) { insertHeader(markup, cells.indexOf(this) + 1); }
        });
        const insertHeader = (markup, position) => {
            const scope = markup.match(/scope="(row|col)"/)[1];
            const number = { textContent: markup.match(/class="rb-table-index-number">(\d+)/)[1] };
            const buttons = Array.from(markup.matchAll(/data-action="([^"]+)" data-table-index="(\d+)"/g),
                ([, action, tableIndex]) => ({ ...element(), dataset: { action, tableIndex } }));
            const cell = {
                ...tableCell(), scope,
                querySelector: () => number,
                querySelectorAll: () => buttons
            };
            cells.splice(position, 0, cell);
        };
        return {
            cells,
            insertCell(index) { const cell = tableCell(); cells.splice(index, 0, cell); return cell; },
            insertAdjacentHTML(where, markup) { insertHeader(markup, 0); },
            deleteCell(index) { cells.splice(index, 1); }
        };
    }
    const body = { rows: [row()], insertRow(index) { const next = row(); this.rows.splice(index, 0, next); return next; }, deleteRow(index) { this.rows.splice(index, 1); } };
    const header = row();
    const original = { ...element(), value: 'Existing text', selectionStart: 4, selectionEnd: 9 };
    header.insertCell(0);
    const controls = {};
    const widths = [];
    const table = { style: { setProperty(name, value) { assert.equal(name, '--rb-table-columns'); widths.push(value); } } };
    const card = {
        querySelector(selector) { if (selector === '.rb-edit-table tbody') return body; if (selector === '.rb-edit-table thead tr') return header; if (selector === '.rb-edit-table') return table; return controls[selector] ||= {}; },
        querySelectorAll(selector) {
            const headings = selector.includes('remove-row') ? body.rows.map(row => row.cells[0]) : header.cells.slice(1);
            return headings.map(cell => cell.querySelectorAll('button')[1]);
        }
    };
    const block = { rows: [['Existing text'], ['']] };
    const start = source.indexOf('        function updateTableStructure(');
    const end = source.indexOf('        container.addEventListener("click"', start);
    const helpers = source.slice(source.indexOf('        function tableIndexLabels('), source.indexOf('        function render()'));
    const scope = { document: { createElement: element }, resize() {}, card, block, header, body, original };
    vm.runInNewContext(helpers + source.slice(start, end) + `
        header.cells[0].insertAdjacentHTML("afterend", tableHeader("col", 0));
        body.rows[0].insertAdjacentHTML("afterbegin", tableHeader("row", 0));
        body.rows[0].insertCell(1).append(original);
        updateTableStructure(card, block, "row", true, 1);
    `, scope);
    assert.equal(body.rows.length, 2);
    assert.equal(body.rows[0].cells[1].firstElementChild, original);
    assert.equal(body.rows[1].cells[0].querySelector('.rb-table-index-number').textContent, '2');
    assert.equal(body.rows[1].cells[0].scope, 'row');
    assert.equal(controls['.rb-table-size'].textContent, 'Рядків: 2 · Стовпців: 1');
    assert.equal(original.selectionStart, 4);
    block.rows.forEach(row => row.unshift(''));
    vm.runInNewContext('updateTableStructure(card, block, "column", true, 0);', scope);
    assert.equal(body.rows[0].cells.length, 3);
    assert.equal(body.rows[0].cells[2].firstElementChild, original);
    assert.equal(original.dataset.column, '1');
    assert.equal(original.selectionStart, 4);
    assert.equal(body.rows[1].cells[2].firstElementChild.dataset.row, '1');
    assert.equal(body.rows[1].cells[2].firstElementChild.dataset.column, '1');
    assert.equal(header.cells[2].querySelector('.rb-table-index-number').textContent, '2');
    assert.equal(header.cells[2].querySelectorAll('button')[0].dataset.tableIndex, '1');
    assert.equal(header.cells[2].scope, 'col');
    assert.equal(controls['.rb-table-size'].textContent, 'Рядків: 2 · Стовпців: 2');
    assert.deepEqual(widths, [1, 2]);
    block.rows.forEach(row => row.shift());
    vm.runInNewContext('updateTableStructure(card, block, "column", false, 0);', scope);
    assert.equal(header.cells.length, 2);
    assert.equal(body.rows[0].cells.length, 2);
    assert.equal(body.rows[0].cells[1].firstElementChild, original);
    assert.equal(original.dataset.column, '0');
    block.rows.pop();
    vm.runInNewContext('updateTableStructure(card, block, "row", false, 1);', scope);
    assert.equal(body.rows.length, 1);
    assert.equal(controls['.rb-table-size'].textContent, 'Рядків: 1 · Стовпців: 1');
    assert.equal(card.querySelectorAll('[data-action="remove-row"]')[0].disabled, true);
    assert.equal(card.querySelectorAll('[data-action="remove-column"]')[0].disabled, true);
    assert.deepEqual(block.rows, [['Existing text']]);
});
