import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('every app shares editorial layout, direct navigation and its existing settings', async () => {
    for (const path of ['index.html', 'reports/index.html', 'admin/index.html']) {
        const html = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
        assert.match(html, /<body[^>]*workspace-redesign/);
        assert.match(html, /editorial\.css\?v=20261020/);
        assert.match(html, /class="primary-navigation" aria-label="Основні розділи"/);
        assert.match(html, /data-appearance-settings/);
        assert.match(html, /site-auth\.js/);
        const ids = [...html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
        assert.equal(ids.length, new Set(ids).size, path);
        assert.doesNotMatch(html, /src="[^"]*background-particles\.js"/);
    }
    const build = await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
    assert.ok(build.includes("'editorial.css'"));
});

test('editorial layout keeps responsive layouts, keyboard focus and reduced-motion support', async () => {
    const css = await readFile(new URL('../editorial.css', import.meta.url), 'utf8');
    assert.match(css, /focus-visible/);
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /max-width: 600px/);
    assert.match(css, /\.workspace-wrapper\.single-column/);
    assert.match(css, /\.studio-sidebar-collapsed/);
    assert.match(css, /\.lesson-item\.is-current-lesson/);
    assert.doesNotMatch(css, /\.a4-page|\.docx|\.preview-content/);
});
