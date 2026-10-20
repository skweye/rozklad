import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../workspace-layout.js', import.meta.url), 'utf8');
function fixture(hash = '') {
    class Element {
        attrs = {}; events = {}; hidden = false;
        constructor(id) { this.id = id; }
        setAttribute(key, value) { this.attrs[key] = value; }
        getAttribute(key) { return this.attrs[key]; }
        addEventListener(type, listener) { this.events[type] = listener; }
        contains(target) { return this.children?.includes(target) ?? false; }
        focus() { this.focused = true; }
        click() { this.events.click(); }
    }
    const panels = [new Element('scheduleView'), new Element('assignments')];
    panels[0].children = [new Element('weeklySchedule'), new Element('scheduleDay3')];
    const links = panels.map(panel => {
        const link = new Element(); link.dataset = { workspaceView: panel.id }; return link;
    });
    const navigation = new Element(); navigation.querySelectorAll = () => links;
    const workspace = { querySelector: () => navigation };
    const nodes = [...panels, ...panels[0].children];
    const document = new Element();
    document.querySelector = () => workspace;
    document.getElementById = id => nodes.find(node => node.id === id);
    const window = new Element(), location = { hash };
    vm.runInNewContext(source, { document, window, location });
    return { panels, links, navigation, document, window, location };
}

test('workspace tabs keep both original sections mounted and select the timetable by default', () => {
    const f = fixture();
    const schedule = f.panels[0], assignments = f.panels[1];
    assignments.unsavedFilter = 'Операційні системи';
    assert.equal(f.navigation.attrs.role, 'tablist');
    assert.equal(schedule.hidden, false);
    assert.equal(assignments.hidden, true);
    f.links[1].click();
    assert.equal(schedule.hidden, true);
    assert.equal(assignments.hidden, false);
    assert.equal(f.links[1].attrs['aria-selected'], 'true');
    assert.equal(f.links[0].tabIndex, -1);
    f.links[0].click(); f.links[1].click();
    assert.equal(assignments.unsavedFilter, 'Операційні системи');
    assert.equal(f.panels[1], assignments);
    assert.equal(assignments.attrs['aria-labelledby'], f.links[1].id);
});

test('workspace tabs support arrow, Home and End keys', () => {
    const f = fixture();
    const key = (index, value) => {
        let prevented = false;
        f.links[index].events.keydown({ key: value, preventDefault() { prevented = true; } });
        return prevented;
    };
    assert.equal(key(0, 'ArrowLeft'), true);
    assert.equal(f.links[1].focused, true);
    assert.equal(f.panels[1].hidden, false);
    key(1, 'ArrowRight'); assert.equal(f.panels[0].hidden, false);
    key(0, 'End'); assert.equal(f.panels[1].hidden, false);
    key(1, 'Home'); assert.equal(f.panels[0].hidden, false);
    assert.equal(key(0, 'Tab'), false);
});

test('deep links, history and in-page links reveal the corresponding workspace', () => {
    const f = fixture('#assignments');
    assert.equal(f.panels[1].hidden, false);
    f.location.hash = '#scheduleDay3'; f.window.events.hashchange();
    assert.equal(f.panels[0].hidden, false);
    f.location.hash = '#assignments'; f.window.events.pageshow();
    assert.equal(f.panels[1].hidden, false);
    f.document.events.click({ target: { closest: () => ({ getAttribute: () => '#weeklySchedule' }) } });
    assert.equal(f.panels[0].hidden, false);
    f.links[1].click();
    f.location.hash = ''; f.window.events.hashchange();
    assert.equal(f.panels[0].hidden, false);
    f.location.hash = '#unknown'; assert.doesNotThrow(() => f.window.events.hashchange());
});

test('new structure retains progressive content, a document outline and protected admin mounts', async () => {
    const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    const schedule = await read('index.html');
    assert.match(schedule, /<aside class="learning-context"/);
    assert.match(schedule, /data-workspace-views/);
    assert.match(schedule, /id="scheduleView"(?![^>]*hidden)/);
    assert.match(schedule, /id="assignments"(?![^>]*hidden)/);
    assert.match(schedule, /workspace-layout\.js/);
    const reports = await read('reports/index.html');
    const sidebar = reports.slice(reports.indexOf('id="studioSidebar"'), reports.indexOf('class="report-document-bar"'));
    assert.match(sidebar, /class="report-steps"/);
    assert.doesNotMatch(sidebar, /id="btnExportDraft"|id="btnClearForm"/);
    const tools = reports.slice(reports.indexOf('class="report-document-bar"'), reports.indexOf('id="workspaceWrapper"'));
    for (const id of ['btnNewDraft', 'btnExportDraft', 'btnImportDraft', 'btnClearForm', 'btnToggleSplitView', 'saveStatusIndicator']) {
        assert.ok(tools.includes(`id="${id}"`), id);
    }
    assert.match(reports, /<header class="report-topbar">[\s\S]*?<div class="nav-links"><\/div>/);
    const admin = await read('admin/index.html');
    assert.match(admin, /class="management-workspace" data-admin-content hidden/);
    assert.match(admin, /data-admin-presence/);
    assert.match(admin, /data-admin-permissions/);
    assert.ok((await read('scripts/build.mjs')).includes("'workspace-layout.js'"));
});
