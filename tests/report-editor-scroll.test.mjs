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

test('table tools restore focus to the same action without scrolling to the block heading', async () => {
    const start = source.indexOf('        container.addEventListener("click", async e => {');
    const end = source.indexOf('        async function upload(', start);
    const item = { id: 'table-1', rows: [['existing']] };
    const button = { dataset: { action: 'add-row' }, hasAttribute: () => false,
        closest: () => ({ dataset: { block: item.id } }) };
    let focused, fallback = false, handler;
    const restored = { focus(options) { focused = options; } };
    const container = { addEventListener(type, fn) { handler = fn; }, querySelector: () => ({ querySelector: () => restored }) };
    vm.runInNewContext(source.slice(start, end), { container, getItems: () => [item], changed() {}, focusBlock() { fallback = true; } });
    await handler({ target: { closest: () => button } });
    assert.equal(item.rows.length, 2);
    assert.equal(focused.preventScroll, true);
    assert.equal(fallback, false);
});
