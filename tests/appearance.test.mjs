import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const source = await read('site-appearance.js');
const key = 'studyAppearanceV1';
const pages = ['index.html', 'reports/index.html', 'admin/index.html'];

function fixture({ saved = new Map(), systemDark = false, blocked = false, early = false, cores = 8 } = {}) {
    class Element {
        dataset = {}; attrs = {}; events = {};
        classList = { toggle() {} };
        style = { values: new Map(), setProperty(name, value) { this.values.set(name, value); } };
        setAttribute(name, value) { this.attrs[name] = value; }
        addEventListener(name, fn) { this.events[name] = fn; }
    }
    const body = new Element(), root = new Element(), status = new Element();
    const buttons = ['light', 'dark', 'gray'].map(mode => {
        const button = new Element();
        button.dataset.themeChoice = mode;
        return button;
    });
    const settings = { querySelectorAll: () => buttons, querySelector: () => status };
    const media = { matches: systemDark, addEventListener(type, fn) { this.events = { [type]: fn }; } };
    const document = Object.assign(new Element(), { body: early ? null : body, documentElement: root, querySelector: () => settings });
    const window = Object.assign(new Element(), { matchMedia: () => media });
    const localStorage = {
        getItem: name => saved.get(name) ?? null,
        setItem(name, value) { if (blocked) throw new Error('quota'); saved.set(name, value); }
    };
    vm.runInNewContext(source, { window, document, navigator: { hardwareConcurrency: cores }, localStorage });
    return { api: window.studyAppearance, body, root, status, settings, buttons, media, saved, window, document };
}

test('light, dark and gray are offered, saved and marked selected', () => {
    const f = fixture();
    assert.deepEqual([...f.settings.innerHTML.matchAll(/data-theme-choice="([^"]+)"/g)].map(m => m[1]), ['light', 'dark', 'gray']);
    assert.equal(f.buttons[0].attrs['aria-pressed'], 'true');
    f.buttons[1].events.click();
    assert.deepEqual(JSON.parse(f.saved.get(key)), { theme: 'dark' });
    assert.equal(f.root.style.colorScheme, 'dark');
    assert.equal(f.body.style.colorScheme, 'dark');
    assert.equal(f.buttons[1].attrs['aria-pressed'], 'true');
    assert.equal(f.buttons[0].attrs['aria-pressed'], 'false');
    assert.equal(fixture({ saved: f.saved }).api.snapshot().theme, 'dark');
    f.buttons[2].events.click();
    assert.deepEqual(JSON.parse(f.saved.get(key)), { theme: 'gray' });
    assert.equal(f.root.style.colorScheme, 'light');
    assert.equal(f.buttons[2].attrs['aria-pressed'], 'true');
    assert.equal(f.buttons[1].attrs['aria-pressed'], 'false');
    const restored = fixture({ saved: f.saved, systemDark: true });
    assert.equal(restored.body.dataset.theme, 'gray');
    assert.equal(restored.root.style.values.get('--ui-ground'), '#ececee');
});

test('legacy themes retain their light or dark character and obsolete settings do not affect the palette', () => {
    const light = ['neumorphism', 'minimal', 'university', 'dualshot', 'graphite'];
    const dark = ['deep-tech', 'neumorphism-dark', 'cyber', 'amoled', 'green', 'purple', 'sunset', 'glass', 'coffee'];
    for (const theme of [...light, ...dark]) {
        const saved = new Map([[key, JSON.stringify({ theme, accent: '#ff0000', background: 'wallpaper' })]]);
        const f = fixture({ saved });
        assert.equal(f.body.dataset.theme, light.includes(theme) ? 'light' : 'dark');
        assert.notEqual(f.body.style.values.get('--ui-accent'), '#ff0000');
        assert.equal(f.body.style.values.has('background'), false);
    }
    assert.equal(fixture({ saved: new Map([[key, 'invalid'], ['theme', 'dark']]) }).api.snapshot().theme, 'dark');
});

test('the first paint follows the system preference and restores on history and storage events', () => {
    const f = fixture({ systemDark: true, early: true, cores: 4 });
    assert.equal(f.root.dataset.theme, 'dark');
    f.document.body = f.body;
    f.api.prime(f.body);
    f.document.events.DOMContentLoaded();
    assert.equal(f.body.dataset.theme, 'dark');
    assert.equal(f.body.dataset.lowPower, 'true');
    f.saved.set(key, '{"theme":"light"}');
    f.window.events.storage({ key });
    assert.equal(f.root.dataset.theme, 'light');
    f.saved.set(key, '{"theme":"dark"}');
    f.window.events.pageshow();
    assert.equal(f.body.dataset.theme, 'dark');
    f.saved.delete(key);
    f.media.matches = false;
    f.media.events.change();
    assert.equal(f.body.dataset.theme, 'light');
});

test('a blocked settings write keeps the choice usable until reload', () => {
    const f = fixture({ blocked: true });
    f.buttons[1].events.click();
    f.window.events.pageshow();
    assert.equal(f.body.dataset.theme, 'dark');
    assert.match(f.status.textContent, /до оновлення/);
});

test('native menus and the white report paper keep readable input colors', async () => {
    assert.match(await read('appearance.css'), /select :is\(option,optgroup\)\s*\{\s*background-color: Canvas; color: CanvasText;/);
    const css = await read('campus.css');
    assert.match(css, /\.document-sheet select\s*\{\s*color-scheme: light/);
    assert.match(css, /\.document-sheet \.form-control\s*\{[^}]*caret-color: #222228/);
});

test('all app pages prime before rendering and share the last-loaded campus stylesheet', async () => {
    for (const file of pages) {
        const html = await read(file);
        const script = html.match(/<script src="[^"]*site-appearance\.js\?v=20261120-gray"><\/script>/);
        assert.ok(script && script.index < html.indexOf('rel="stylesheet"'));
        assert.match(html, /<body[^>]*>\s*<script>window\.studyAppearance\?\.prime\(document\.body\);<\/script>/);
        assert.match(html, /data-appearance-settings/);
        const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m => m[1]);
        assert.match(styles.at(-1), /campus\.css/);
        assert.ok(!styles.some(path => /neumorphism|deep-tech|frosted-glass/.test(path)));
    }
    const build = await read('scripts/build.mjs');
    for (const asset of ['appearance.css', 'site-appearance.js', 'campus.css']) assert.ok(build.includes(`'${asset}'`));
    const css = await read('campus.css');
    assert.match(css, /\.schedule-notices,\.toast,\.app-notice/);
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /forced-colors: active/);
});
