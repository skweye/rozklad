import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('legal pages are public static documents with real owner details and navigation', async () => {
    for (const file of ['privacy.html', 'terms.html']) {
        const html = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
        assert.match(html, /<html lang="uk">/);
        assert.match(html, /<h1>/);
        assert.match(html, /Ярослав/);
        assert.match(html, /skweye\.su@gmail\.com/);
        assert.match(html, /https:\/\/newrozklad\.pp\.ua\//);
        assert.ok(!html.includes('<script'));
        assert.match(html, /href="\/"/);
    }
    const privacy = await readFile(new URL('../privacy.html', import.meta.url), 'utf8');
    assert.match(privacy, /Limited Use/);
    assert.match(privacy, /myaccount.google.com\/connections/);
    const build = await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
    for (const file of ['privacy.html', 'terms.html', 'legal.css']) assert.ok(build.includes(`'${file}'`));
});

test('both public app pages link privacy and terms without requiring JavaScript or login', async () => {
    for (const file of ['index.html', 'reports/index.html']) {
        const html = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
        const footer = html.match(/<footer class="site-legal-footer"[\s\S]*?<\/footer>/)?.[0];
        assert.ok(footer);
        assert.doesNotMatch(footer, /Ярослав/);
        assert.match(footer, /href="\/privacy.html"/);
        assert.match(footer, /href="\/terms.html"/);
    }
});
