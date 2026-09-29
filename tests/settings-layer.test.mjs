import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('settings on all three pages belong to the root stacking context above the header', async () => {
    const voidTags = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
    for (const file of ['index.html', 'reports/index.html', 'admin/index.html']) {
        const html = (await readFile(new URL(`../${file}`, import.meta.url), 'utf8'))
            .replace(/<!--[^]*?-->|<script\b[^>]*>[^]*?<\/script>|<style\b[^>]*>[^]*?<\/style>/gi, '');
        const stack = [];
        let found = 0;
        for (const [token, closing, tag, attrs] of html.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*)>/gi)) {
            if (closing) { assert.equal(stack.pop(), tag, `${file}: balanced ${tag}`); continue; }
            if (/class="(?:reports-)?settings-fab-container"/.test(attrs)) {
                assert.equal(stack.at(-1), 'body', `${file}: settings cannot be trapped inside main`);
                found++;
            }
            if (!voidTags.has(tag) && !token.endsWith('/>')) stack.push(tag);
        }
        assert.equal(found, 1, `${file}: one settings container`);
    }
    const css = await readFile(new URL('../workspace.css', import.meta.url), 'utf8');
    const settings = css.match(/body\[data-app\] > :is\(\.settings-fab-container, \.reports-settings-fab-container\)\s*\{([^}]+)\}/)?.[1];
    const header = css.match(/body\[data-app\] > header\.app-header\s*\{([^}]+)\}/)?.[1];
    assert.match(settings, /position:\s*fixed/);
    assert.ok(Number(settings.match(/z-index:\s*(\d+)/)[1]) > Number(header.match(/z-index:\s*(\d+)/)[1]));
});
