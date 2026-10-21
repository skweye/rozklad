import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../reports/studio.js', import.meta.url), 'utf8');
function fixture(hash = '') {
    class Element {
        attrs = {}; events = {}; open = false; scrolls = 0;
        classList = { toggle() {} };
        addEventListener(type, fn) { this.events[type] = fn; }
        getAttribute(name) { return this.attrs[name]; }
        setAttribute(name, value) { this.attrs[name] = value; }
        removeAttribute(name) { delete this.attrs[name]; }
        scrollIntoView() { this.scrolls++; }
        querySelector() { return this.summary; }
        focus() { this.focused = true; }
        showModal() { this.open = true; }
        close() { this.open = false; }
        dispatchEvent(event) { this.events[event.type]?.(event); }
    }
    const sections = ['reportStudent', 'reportDetails', 'reportWork', 'reportQuestions', 'reportConclusion'].map(id => {
        const section = new Element(); section.id = id; section.summary = new Element();
        section.open = id === 'reportDetails'; return section;
    });
    const links = sections.map(section => { const link = new Element(); link.attrs.href = `#${section.id}`; return link; });
    const nodes = new Proxy({}, { get(target, id) { return target[id] ||= new Element(); } });
    const window = new Element(), location = { hash };
    const classes = new Set();
    window.scrollTo = () => {};
    const document = { addEventListener() {}, querySelector: () => new Element(), body: { classList: { toggle(name, on) { on ? classes.add(name) : classes.delete(name); } } }, getElementById: id => nodes[id], querySelectorAll: selector => selector === '.studio-section' ? sections : selector === '.report-steps a' ? links : [] };
    vm.runInNewContext(source, { document, window, location, Event });
    if (hash) window.ReportStudio.showEditor(hash);
    return { sections, links, nodes, window, location, classes };
}

test('library and editor views preserve the selected section and refit the preview', () => {
    const f = fixture();
    let resizes = 0;
    f.window.addEventListener('resize', () => resizes++);
    f.window.ReportStudio.showEditor('#reportWork');
    const selected = f.sections[2];
    f.window.ReportStudio.showLibrary();
    assert.equal(f.nodes.reportsEditor.hidden, true);
    assert.equal(f.nodes.reportsLibrary.hidden, false);
    f.window.ReportStudio.showEditor();
    assert.equal(f.nodes.reportsEditor.hidden, false);
    assert.equal(f.nodes.reportsLibrary.hidden, true);
    assert.equal(f.sections[2], selected);
    assert.equal(f.sections[2].hidden, false);
    assert.ok(resizes > 0);
});

test('studio navigation reveals collapsed sections, marks the active step and moves keyboard focus', () => {
    const f = fixture();
    assert.equal(f.links[1].attrs['aria-current'], 'step');
    let prevented = false;
    f.links[2].events.click({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(f.sections[2].open, true);
    assert.equal(f.sections[2].summary.focused, true);
    assert.equal(f.sections[2].hidden, false);
    assert.equal(f.links[2].attrs['aria-current'], 'step');
    assert.equal(f.links[1].attrs['aria-current'], undefined);
    assert.equal(f.sections[1].hidden, true, 'Only the selected section is displayed');
    f.window.ReportStudio.reveal('#reportStudent');
    assert.equal(f.links[0].attrs['aria-current'], 'step');
    f.window.ReportStudio.reveal('#reportDetails');
    assert.equal(f.links[1].attrs['aria-current'], 'step');
});

test('deep links and help dialog work without changing report state', () => {
    const f = fixture('#reportConclusion');
    assert.equal(f.sections[4].open, true);
    f.location.hash = '#reportQuestions'; f.window.events.hashchange();
    assert.equal(f.sections[3].open, true);
    f.location.hash = '#not-a-section'; assert.doesNotThrow(() => f.window.events.hashchange());
    f.nodes.btnStudioHelp.events.click(); assert.equal(f.nodes.studioHelpDialog.open, true);
    f.nodes.btnCloseStudioHelp.events.click(); assert.equal(f.nodes.studioHelpDialog.open, false);
});

test('textareas in closed sections retain their minimum size and grow when revealed', async () => {
    const main = await readFile(new URL('../reports/script.js', import.meta.url), 'utf8');
    const start = main.indexOf('    function resizeTextArea('), end = main.indexOf('    function resizeReportTextAreas(', start);
    class Textarea {
        visible = false; dataset = {}; style = {}; offsetHeight = 36; scrollHeight = 90;
        getClientRects() { return this.visible ? [{}] : []; }
    }
    const scope = { HTMLTextAreaElement: Textarea };
    vm.runInNewContext(main.slice(start, end), scope);
    const textarea = new Textarea(); scope.resizeTextArea(textarea);
    assert.equal(textarea.dataset.minAutoHeight, undefined);
    assert.equal(textarea.style.height, undefined);
    textarea.visible = true; scope.resizeTextArea(textarea);
    assert.equal(textarea.style.height, '90px');
    textarea.scrollHeight = 20; scope.resizeTextArea(textarea);
    assert.equal(textarea.style.height, '36px');
});

test('studio keeps unique editor controls, accessible native sections and bundled local assets', async () => {
    const html = await readFile(new URL('../reports/index.html', import.meta.url), 'utf8');
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(ids.length, new Set(ids).size);
    for (const id of ['reportStudent', 'reportDetails', 'reportWork', 'reportQuestions', 'reportConclusion']) {
        assert.match(html, new RegExp(`<details[^>]*id="${id}"[^>]*>\\s*<summary>`));
    }
    for (const id of ['btnDraftLibrary', 'btnNewDraft', 'btnGenerateDocx', 'btnLiveDocx', 'btnExportDraft', 'btnImportDraft', 'btnAddCustomTask']) assert.ok(ids.includes(id));
    const footer = html.slice(html.indexOf('class="studio-preview-footer"'), html.indexOf('<!-- Мобільна'));
    assert.ok(footer.includes('id="btnLiveDocx"'));
    const build = await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
    assert.ok(build.includes("'reports/studio.css'")); assert.ok(build.includes("'reports/studio.js'"));
});
