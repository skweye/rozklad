import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('both pages use existing local, decorative icons with no external font dependency', async () => {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const sprite = await readFile(resolve(root, 'ui-icons.svg'), 'utf8');
    const symbols = new Set([...sprite.matchAll(/<symbol id="([^"]+)"/g)].map(match => match[1]));
    assert.ok(symbols.size >= 12);
    for (const page of ['index.html', 'reports/index.html']) {
        const html = await readFile(resolve(root, page), 'utf8');
        const icons = [...html.matchAll(/<svg[^>]*class="ui-icon[^>]*>[\s\S]*?<\/svg>/g)];
        assert.ok(icons.length >= 5);
        for (const [markup] of icons) {
            assert.match(markup, /aria-hidden="true"/);
            assert.match(markup, /focusable="false"/);
            const [, path, name] = markup.match(/href="([^"#]+)#([^"#]+)"/);
            assert.ok(symbols.has(name), `Missing icon ${name}`);
            assert.equal(resolve(root, page, '..', path), resolve(root, 'ui-icons.svg'));
        }
    }
    const build = await readFile(resolve(root, 'scripts/build.mjs'), 'utf8');
    assert.ok(build.includes("'ui-icons.svg'"));
    const reportCode = await readFile(resolve(root, 'reports/script.js'), 'utf8');
    assert.ok(!/splitViewIcon\.(textContent|innerHTML)\s*=/.test(reportCode), 'Preview toggle must preserve its SVG');
});

test('link indicators use the shared monochrome SVG instead of a text arrow', async () => {
    for (const page of ['index.html', 'reports/index.html', 'workspace.css']) {
        const content = await readFile(new URL(`../${page}`, import.meta.url), 'utf8');
        assert.ok(!content.includes('↗'), `Legacy arrow remains in ${page}`);
    }
    const schedule = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const resources = [...schedule.matchAll(/<a class="link-card"[\s\S]*?<\/a>/g)];
    assert.equal(resources.length, 3);
    for (const [markup] of resources) {
        assert.match(markup, /class="ui-icon resource-link-indicator"/);
        assert.match(markup, /href="ui-icons.svg#link"/);
    }
});
