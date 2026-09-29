import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('schedule has no legacy administration panel, hidden entry points or local editor overrides', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    assert.doesNotMatch(html, /adminBtn|adminModal|adminpanel|adminSecretTrigger|scheduleEditor|visualEditor|customSchedule|applyPreviewBtn|importSchedule|exportSchedule|announcementText|testNotifyBtn|exportAnnouncementBtn|clearAnnouncementCacheBtn|e\.ctrlKey\s*&&\s*e\.altKey/i);
    assert.match(html, /fetch\('schedule\.json'\)/);
    assert.match(html, /fetch\('announcement\.json'/);
    assert.match(html, /e\.key === 'Escape'/);
    assert.match(html, /id="autoOpenToggle"/);
    const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(source => source.trim());
    assert.ok(inlineScripts.length > 0);
    for (const source of inlineScripts) assert.doesNotThrow(() => new vm.Script(source));
    for (const file of ['styles.css', 'workspace.css', 'frosted-glass.css', 'reports/style.css']) {
        const css = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
        assert.doesNotMatch(css, /#adminBtn|\.editor-input\b|\.modal-content\b|\.close-modal\b|modalPopIn|modalPopOut/);
    }
});

test('direct event bindings on schedule reference existing markup elements', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    const ids = new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
    const bindings = [...html.matchAll(/getElementById\(['"]([^'"]+)['"]\)\.addEventListener/g)];
    assert.ok(bindings.length > 0);
    for (const [, id] of bindings) assert.ok(ids.has(id), `Missing element for event binding: ${id}`);
    assert.ok(ids.has('fabTestSound'));
    assert.ok(!html.includes("getElementById('testSoundBtn')"));
});

test('overview contains summary, resource links and Classroom in reading order with responsive columns', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const overview = html.slice(html.indexOf('<div class="overview-layout">'), html.indexOf('<div class="section-heading schedule-heading"'));
    const stack = [], children = [], sidebarChildren = [];
    // Inspect nesting rather than only checking that the blocks occur somewhere on the page.
    for (const [token, closing, tag, attrs] of overview.matchAll(/<(\/?)(div|nav|section)\b([^>]*)>/g)) {
        if (closing) { assert.equal(stack.pop(), tag); continue; }
        if (stack.length === 1) children.push(attrs.match(/class="([^"]+)"/)?.[1]);
        if (stack.length === 2 && children.at(-1) === 'overview-sidebar') sidebarChildren.push(attrs.match(/class="([^"]+)"/)?.[1]);
        stack.push(tag);
    }
    assert.deepEqual(children, ['overview-sidebar', 'classroom-panel']);
    assert.deepEqual(sidebarChildren, ['status-grid', 'links-grid']);
    assert.equal(stack.length, 0);
    assert.match(overview, /id="currentDate"/);
    assert.match(overview, /id="statusCard"/);
    const css = await readFile(new URL('../workspace.css', import.meta.url), 'utf8');
    assert.match(css, /grid-template-areas: "sidebar classroom"/);
    assert.match(css, /grid-template-areas: "sidebar" "classroom"/);
    assert.match(css, /grid-template-areas: "status resources"/);
    assert.match(css, /grid-template-areas: "status" "resources"/);
    assert.match(css, /\.status-grid\s*\{[^}]*grid-template-columns: minmax\(0,1fr\)/);
});

test('overview sidebar stays content-sized independently of the number of assignments', async () => {
    const css = await readFile(new URL('../workspace.css', import.meta.url), 'utf8');
    assert.match(css, /\.overview-layout\s*\{[^}]*align-items: start/);
    assert.match(css, /\.overview-sidebar\s*\{[^}]*align-items: start/);
    assert.doesNotMatch(css, /\.status-grid\s*\{[^}]*grid-template-rows: repeat/);
    assert.match(css, /\.overview-layout \.link-card\s*\{[^}]*flex: 0 0 auto/);
    assert.match(css, /\.status-grid > \.card\s*\{[^}]*min-height: 0/);
    const mobile = css.slice(css.indexOf('@media (max-width: 640px)'));
    assert.match(mobile, /\.overview-sidebar\s*\{[^}]*grid-template-columns: minmax\(0,1fr\)/);
});
