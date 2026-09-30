import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../reports/delete-confirm.js', import.meta.url), 'utf8');
function fixture({ nativePopover = true, width = 800, height = 600 } = {}) {
    class Events {
        events = new Map();
        addEventListener(name, handler) { if (!this.events.has(name)) this.events.set(name, new Set()); this.events.get(name).add(handler); }
        removeEventListener(name, handler) { this.events.get(name)?.delete(handler); }
        fire(name, event = {}) { for (const handler of [...(this.events.get(name) || [])]) handler(event); }
    }
    let document;
    class Element extends Events {
        children = []; attrs = {}; style = {}; isConnected = false; className = '';
        rect = { left: 600, right: 640, top: 100, bottom: 140, width: 40, height: 40 };
        constructor(tag) { super(); this.tag = tag; if (nativePopover) this.showPopover = () => { this.popoverOpen = true; }; }
        append(...children) { this.children.push(...children); for (const child of children) { child.parent = this; child.isConnected = true; } }
        remove() { this.isConnected = false; this.parent.children = this.parent.children.filter(child => child !== this); }
        setAttribute(name, value) { this.attrs[name] = value; }
        removeAttribute(name) { delete this.attrs[name]; }
        contains(target) { return this === target || this.children.some(child => child.contains(target)); }
        focus() { document.activeElement = this; document.fire('focusin', { target: this }); }
        getBoundingClientRect() { return this.className === 'delete-confirm' ? { width: Math.min(292, width - 20), height: 180 } : this.rect; }
    }
    document = new Events(); document.body = new Element('body'); document.createElement = tag => new Element(tag);
    const window = new Events(); Object.assign(window, { innerWidth: width, innerHeight: height });
    let observer;
    class MutationObserver { constructor(callback) { this.callback = callback; observer = this; } observe() {} disconnect() { this.disconnected = true; } }
    vm.runInNewContext(source, { window, document, MutationObserver });
    const anchor = new Element('button'); document.body.append(anchor);
    const panel = () => document.body.children.find(el => el.className === 'delete-confirm');
    return { api: window.ReportDeleteConfirm, window, document, anchor, panel, observer: () => observer,
        buttons: () => panel().children.at(-1).children };
}
test('normal click opens a small non-modal confirmation and only explicit confirmation resolves true', async () => {
    const f = fixture(); let settled = false;
    const promise = f.api.request({ anchor: f.anchor, title: '<Delete>' }).then(value => { settled = true; return value; });
    assert.equal(settled, false);
    assert.equal(f.panel().attrs['aria-modal'], 'false');
    assert.equal(f.panel().attrs.popover, 'manual');
    assert.equal(f.panel().popoverOpen, true);
    assert.equal(f.panel().children[0].textContent, '<Delete>');
    assert.equal(f.document.activeElement, f.buttons()[0], 'Cancel receives initial focus');
    assert.equal(f.panel().style.top, '148px');
    f.buttons()[1].fire('click');
    assert.equal(await promise, true);
    assert.equal(f.panel(), undefined);
    assert.equal(f.document.activeElement, f.anchor);
    assert.equal(f.anchor.attrs['aria-expanded'], undefined);
    assert.equal(f.observer().disconnected, true);
    for (const listeners of f.document.events.values()) assert.equal(listeners.size, 0);
});
test('Shift bypasses confirmation once, cancels older prompts, and is not a persistent preference', async () => {
    const f = fixture();
    const old = f.api.request({ anchor: f.anchor });
    assert.equal(await f.api.request({ anchor: f.anchor, skipConfirmation: true }), true);
    assert.equal(await old, false);
    assert.equal(f.panel(), undefined);
    const next = f.api.request({ anchor: f.anchor });
    assert.ok(f.panel());
    f.buttons()[0].fire('click'); assert.equal(await next, false);
});
test('Escape, outside pointer and focus changes cancel without deleting', async () => {
    for (const kind of ['escape', 'pointer', 'focus']) {
        const f = fixture(), promise = f.api.request({ anchor: f.anchor });
        if (kind === 'escape') f.document.fire('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} });
        if (kind === 'pointer') f.document.fire('pointerdown', { target: f.document.body });
        if (kind === 'focus') f.document.fire('focusin', { target: f.document.body });
        assert.equal(await promise, false);
        assert.equal(f.panel(), undefined);
    }
});
test('menu flips above a low anchor, stays inside narrow screens and works without Popover API', async () => {
    const f = fixture({ nativePopover: false, width: 320, height: 400 });
    f.anchor.rect = { left: 275, right: 315, top: 350, bottom: 390 };
    const promise = f.api.request({ anchor: f.anchor });
    assert.equal(f.panel().attrs.popover, undefined);
    assert.equal(f.panel().style.left, '18px');
    assert.equal(f.panel().style.top, '162px');
    f.anchor.rect = { left: 0, right: 40, top: 20, bottom: 60 };
    f.window.fire('resize');
    assert.equal(f.panel().style.left, '10px');
    assert.equal(f.panel().style.top, '68px');
    f.buttons()[0].fire('click'); assert.equal(await promise, false);
});
test('removed or off-screen anchors cancel; stale Shift clicks cannot delete a different item', async () => {
    const f = fixture();
    let promise = f.api.request({ anchor: f.anchor });
    f.anchor.isConnected = false; f.observer().callback();
    assert.equal(await promise, false);
    assert.equal(await f.api.request({ anchor: f.anchor, skipConfirmation: true }), false);
    f.anchor.isConnected = true;
    promise = f.api.request({ anchor: f.anchor });
    f.anchor.rect = { left: 0, right: 40, top: -200, bottom: -160 };
    f.document.fire('scroll'); assert.equal(await promise, false);
});
test('report deletion passes the exact anchor and Shift flag; production includes the helper before editor', async () => {
    const blocks = await readFile(new URL('../reports/blocks.js', import.meta.url), 'utf8');
    const main = await readFile(new URL('../reports/script.js', import.meta.url), 'utf8');
    assert.match(blocks, /anchor: button, skipConfirmation: e\.shiftKey/);
    assert.match(main, /confirm: window\.ReportDeleteConfirm\.request/);
    for (const anchor of ['btn', 'dom.btnNewReport', 'dom.btnClearForm']) assert.ok(main.includes(`anchor: ${anchor}, skipConfirmation: event.shiftKey`));
    assert.match(main, /const currentIndex = state\.questions\.indexOf\(question\)/);
    const html = await readFile(new URL('../reports/index.html', import.meta.url), 'utf8');
    const blocksPosition = html.indexOf('src="blocks.js?v=20260930-task-heading-indent"');
    assert.ok(blocksPosition >= 0);
    assert.ok(html.indexOf('src="delete-confirm.js"') < blocksPosition);
    const build = await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
    assert.match(build, /'reports\/delete-confirm\.js'/);
});
