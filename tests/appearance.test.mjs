import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../site-appearance.js', import.meta.url), 'utf8');
const key = 'studyAppearanceV1';
const themeNames = ['neumorphism', 'neumorphism-dark', 'cyber', 'amoled', 'minimal', 'green', 'purple', 'sunset', 'university', 'glass'];
function fixture({ saved = new Map(), blocked = false, quietMode = false, cores = 8, early = false } = {}) {
    class Classes extends Set { remove(...names) { names.forEach(name => this.delete(name)); } toggle(name, active) { if (active) this.add(name); else this.delete(name); } }
    class Element {
        dataset = {}; attrs = {}; value = ''; textContent = ''; hidden = false; events = {}; classList = new Classes();
        style = { values: new Map(), setProperty(name, value) { this.values.set(name, value); } };
        setAttribute(name, value) { this.attrs[name] = value; }
        addEventListener(name, fn) { this.events[name] = fn; }
    }
    const body = new Element(), html = new Element(), controls = new Map(), windowEvents = {}, documentEvents = {};
    body.classList.add('existing-app'); body.classList.add('theme-midnight');
    const buttons = [...themeNames, 'custom'].map(name => { const el = new Element(); el.dataset.themeChoice = name; return el; });
    const opacity = [10, 20, 30].map(value => { const el = new Element(); el.dataset.transparencyChoice = String(value); return el; });
    const mount = { innerHTML: '', querySelectorAll: selector => selector.includes('theme-choice') ? buttons : opacity,
        querySelector(selector) { if (!controls.has(selector)) controls.set(selector, new Element()); return controls.get(selector); } };
    const video = { src: '', plays: 0, pauses: 0, autoplay: true, pause() { this.pauses++; }, play() { this.plays++; return Promise.resolve(); }, load() {}, removeAttribute() { this.src = ''; } };
    const quiet = { matches: quietMode, addEventListener(name, fn) { this.change = fn; } };
    const document = { body: early ? null : body, documentElement: html, cookie: '', hidden: false, getElementById: () => video, querySelector: () => mount, addEventListener(name, fn) { documentEvents[name] = fn; } };
    const window = { matchMedia: () => quiet, addEventListener(name, fn) { windowEvents[name] = fn; } };
    vm.runInNewContext(source, { window, document, navigator: { hardwareConcurrency: cores }, localStorage: {
        getItem: name => saved.get(name) ?? null,
        setItem(name, value) { if (blocked) throw new Error('quota'); saved.set(name, value); },
        removeItem(name) { saved.delete(name); }
    } });
    return { api: window.studyAppearance, body, html, controls, buttons, opacity, mount, saved, video, quiet, document, windowEvents, documentEvents,
        startBody() { document.body = body; window.studyAppearance.prime(body); },
        domReady() { documentEvents.DOMContentLoaded(); },
        control(selector) { return controls.get(selector); },
        theme(name) { buttons.find(button => button.dataset.themeChoice === name).events.click(); } };
}

test('all themes keep independently selected accent, background and transparency; active state persists', () => {
    const f = fixture();
    assert.equal(f.api.snapshot().accent, '#657caf');
    f.control('[name="accentHex"]').events.change({ target: { value: '#AABBCC' } });
    f.control('[name="background"]').events.change({ target: { value: 'solid' } });
    f.opacity[2].events.click();
    for (const name of themeNames) {
        f.theme(name);
        assert.equal(f.api.snapshot().accent, '#aabbcc');
        assert.equal(f.api.snapshot().background, 'solid');
        assert.equal(f.api.snapshot().transparency, 30);
        assert.equal(f.body.dataset.theme, name);
        assert.equal(f.buttons.filter(button => button.attrs['aria-pressed'] === 'true').length, 1);
        assert.equal(f.body.classList.has('existing-app'), true);
        assert.match(f.body.style.values.get('--ui-panel'), /,0\.7\)$/);
    }
    const secondPage = fixture({ saved: f.saved });
    assert.equal(secondPage.api.snapshot().theme, 'glass');
    assert.equal(secondPage.api.snapshot().accent, '#aabbcc');
    assert.equal(secondPage.body.dataset.background, 'solid');
    f.opacity[0].events.click(); assert.match(f.body.style.values.get('--ui-panel'), /,0\.9\)$/);
    f.opacity[1].events.click(); assert.match(f.body.style.values.get('--ui-panel'), /,0\.8\)$/);
});

test('theme selector renders named rows with decorative three-color palettes and live accent previews', async () => {
    const f = fixture();
    const rows = [...f.mount.innerHTML.matchAll(/<button type="button" data-theme-choice="([^"]+)" aria-pressed="false">([\s\S]*?)<\/button>/g)];
    assert.deepEqual(rows.map(row => row[1]), [...themeNames, 'custom']);
    for (const [, , markup] of rows) {
        assert.match(markup, /class="appearance-theme-name">[^<]+<\/span>/);
        assert.match(markup, /class="appearance-palette" aria-hidden="true"/);
        assert.match(markup, /<span><\/span><span><\/span><span><\/span>/);
    }
    f.control('[name="accentHex"]').events.change({ target: { value: '#F080AC' } });
    for (const button of f.buttons) {
        f.theme(button.dataset.themeChoice);
        assert.equal(button.style.values.get('--theme-preview-accent'), f.body.style.values.get('--ui-accent'));
        assert.equal(button.attrs['aria-pressed'], 'true');
    }
    const css = await readFile(new URL('../appearance.css', import.meta.url), 'utf8');
    assert.match(css, /\.appearance-themes\s*\{[^}]*grid-template-columns: minmax\(0,1fr\)/);
    assert.match(css, /@media \(pointer: coarse\)[^\n]*min-height: 44px/);
    assert.match(css, /\[aria-pressed="true"\] \.appearance-theme-name::before \{ visibility: visible/);
    assert.match(css, /:focus-visible/);
    const neumorphism = await readFile(new URL('../neumorphism.css', import.meta.url), 'utf8');
    assert.doesNotMatch(neumorphism, /\[data-theme-choice\]/, 'Raised button rules must not override flat palette rows');
    for (const page of ['index.html', 'reports/index.html', 'admin/index.html']) {
        const html = await readFile(new URL(`../${page}`, import.meta.url), 'utf8');
        assert.match(html, /data-appearance-settings/);
        assert.match(html, /appearance\.css/);
    }
});

test('legacy settings migrate, invalid settings fall back, blocked writes leave usable controls', () => {
    const legacy = fixture({ saved: new Map([['theme', 'light'], ['customAccentColor', '#123456']]) });
    assert.equal(legacy.api.snapshot().theme, 'minimal');
    assert.equal(legacy.api.snapshot().accent, '#123456');
    const f = fixture({ saved: new Map([[key, '{broken']]), blocked: true });
    f.theme('purple');
    assert.equal(f.body.dataset.theme, 'purple');
    assert.match(f.control('[data-appearance-notice]').textContent, /не дозволив збереження/);
    const old = f.api.snapshot().accent;
    f.control('[name="accentHex"]').events.change({ target: { value: 'red;url(x)' } });
    assert.equal(f.api.snapshot().accent, old);
    assert.equal(f.api.normalize({ theme: '__proto__', accent: 'red', transparency: 99 }).theme, 'neumorphism');
});

test('wallpaper is preserved when selecting solid/gradient; storage events synchronize both pages', () => {
    const wallpaper = JSON.stringify({ type: 'image', dataUrl: 'data:image/png;base64,YQ==', name: 'test.png' });
    const saved = new Map([['customBackground', wallpaper]]), f = fixture({ saved });
    assert.match(f.body.style.values.get('background'), /data:image\/png/);
    f.control('[name="background"]').events.change({ target: { value: 'solid' } });
    assert.equal(f.body.style.values.get('background'), 'var(--ui-ground)');
    assert.equal(saved.get('customBackground'), wallpaper);
    const other = fixture({ saved }); other.theme('green');
    f.windowEvents.storage({ key });
    assert.equal(f.api.snapshot().theme, 'green');
    f.control('[name="background"]').events.change({ target: { value: 'wallpaper' } });
    assert.match(f.body.style.values.get('background'), /data:image\/png/);
    f.control('[data-remove-wallpaper]').events.click();
    assert.equal(saved.has('customBackground'), false);
    assert.equal(f.api.snapshot().background, 'gradient');
});

test('video wallpapers do not load on weak devices or reduced motion; background tabs pause them', () => {
    const saved = new Map([['customBackground', JSON.stringify({ type: 'video', dataUrl: 'data:video/mp4;base64,YQ==' })]]);
    for (const options of [{ quietMode: true }, { cores: 2 }]) {
        const f = fixture({ saved, ...options });
        assert.equal(f.video.src, '');
        assert.equal(f.video.plays, 0);
    }
    const f = fixture({ saved });
    assert.equal(f.video.plays, 1);
    f.document.hidden = true; f.documentEvents.visibilitychange();
    const count = f.video.pauses;
    assert.ok(count > 0);
    f.document.hidden = false; f.documentEvents.visibilitychange();
    assert.equal(f.video.plays, 2);
    f.quiet.matches = true; f.quiet.change();
    assert.equal(f.video.src, '');
});

test('accent text retains contrast even for black, white and neon accents', () => {
    const f = fixture();
    const luminance = hex => {
        const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    for (const background of ['#252b34', '#e6ebf2', '#f5f6f8', '#080d14', '#000000', '#f3f0e8']) for (const raw of ['#000000', '#ffffff', '#00ff88', '#ff00ff']) {
        const accent = f.api.readableAccent(raw, background), a = luminance(accent), b = luminance(background);
        assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `${accent} on ${background}`);
    }
});

test('neumorphism is the fresh default without overwriting saved appearance; every app loads its stylesheet', async () => {
    const fresh = fixture();
    assert.equal(fresh.api.snapshot().theme, 'neumorphism');
    assert.equal(fresh.body.style.colorScheme, 'light');
    assert.equal(fresh.body.style.values.get('--ui-ground'), '#e6ebf2');
    const existing = fixture({ saved: new Map([[key, JSON.stringify({ theme: 'purple', accent: '#abcdef', background: 'solid', transparency: 30 })]]) });
    assert.equal(existing.api.snapshot().theme, 'purple');
    assert.equal(existing.api.snapshot().accent, '#abcdef');
    for (const file of ['index.html', 'reports/index.html', 'admin/index.html']) {
        assert.match(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'), /href="[^"\n]*neumorphism\.css"/);
    }
    const css = await readFile(new URL('../neumorphism.css', import.meta.url), 'utf8');
    assert.match(css, /--neu-inset: inset/);
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /data-low-power="true"/);
    assert.match(css, /focus-visible/);
});

test('dark neumorphism persists, syncs and switches back to light without resetting personal settings', () => {
    const f = fixture();
    f.control('[name="accentHex"]').events.change({ target: { value: '#C3B3EA' } });
    f.control('[name="background"]').events.change({ target: { value: 'solid' } });
    f.opacity[2].events.click();
    f.theme('neumorphism-dark');
    assert.equal(f.body.dataset.theme, 'neumorphism-dark');
    assert.equal(f.body.classList.has('theme-light'), false);
    assert.equal(f.body.style.colorScheme, 'dark');
    assert.equal(f.body.style.values.get('--ui-ground'), '#252b34');
    assert.equal(f.body.style.values.get('--ui-text'), '#edf1f5');
    assert.match(f.body.style.values.get('--ui-panel'), /37,43,52,0\.7/);
    assert.equal(f.buttons.find(button => button.dataset.themeChoice === 'neumorphism-dark').attrs['aria-pressed'], 'true');
    const reopened = fixture({ saved: f.saved });
    assert.equal(reopened.api.snapshot().theme, 'neumorphism-dark');
    reopened.theme('neumorphism');
    f.windowEvents.storage({ key });
    assert.equal(f.body.style.colorScheme, 'light');
    assert.equal(f.body.classList.has('theme-light'), true);
    assert.equal(f.api.snapshot().accent, '#c3b3ea');
    assert.equal(f.api.snapshot().background, 'solid');
    assert.equal(f.api.snapshot().transparency, 30);
});

test('dark neumorphism shares all layout rules and overrides light surface tokens', async () => {
    const css = await readFile(new URL('../neumorphism.css', import.meta.url), 'utf8');
    const dark = css.match(/body\[data-app\]\[data-theme="neumorphism-dark"\]\s*\{([^}]+)\}/)?.[1];
    assert.ok(dark);
    for (const token of ['base', 'light', 'shade', 'inset-shade', 'inset-light', 'edge', 'control-edge', 'field-edge', 'subgroup', 'hover', 'danger-text']) {
        assert.match(dark, new RegExp(`--neu-${token}:`));
    }
    assert.doesNotMatch(css, /body\[data-app\]\[data-theme="neumorphism"\]/);
    assert.match(css, /:is\(\[data-theme="neumorphism"\],\[data-theme="neumorphism-dark"\]\)/);
});

test('every theme is primed before body content; deferred setup preserves the initial palette', () => {
    for (const theme of themeNames) {
        const f = fixture({ early: true, saved: new Map([[key, JSON.stringify({ theme, accent: '#fa91bc', background: 'solid', transparency: 30 })]]) });
        assert.equal(f.document.body, null);
        assert.equal(f.html.dataset.theme, theme);
        assert.ok(f.html.style.values.get('background').startsWith('#'));
        assert.equal(f.mount.innerHTML, '', 'Do not build settings while parsing the head');
        f.startBody();
        assert.equal(f.body.dataset.theme, theme);
        assert.equal(f.body.dataset.transparency, '30');
        assert.equal(f.body.style.values.get('background'), 'var(--ui-ground)');
        const initial = new Map(f.body.style.values);
        f.domReady();
        for (const [name, value] of initial) assert.equal(f.body.style.values.get(name), value, `${theme}: ${name}`);
        assert.equal(f.buttons.filter(button => button.attrs['aria-pressed'] === 'true').length, 1);
    }
});

test('early application handles wallpapers, corrupt storage and disabled storage without hiding content', () => {
    const wallpaper = JSON.stringify({ type: 'image', dataUrl: 'data:image/png;base64,YQ==' });
    const f = fixture({ early: true, saved: new Map([['customBackground', wallpaper]]) });
    f.startBody();
    assert.match(f.body.style.values.get('background'), /data:image\/png/);
    f.domReady();
    assert.match(f.body.style.values.get('background'), /data:image\/png/);
    const corrupt = fixture({ early: true, blocked: true, saved: new Map([[key, '{broken']]) });
    corrupt.startBody(); corrupt.domReady();
    assert.equal(corrupt.body.dataset.theme, 'neumorphism');
    assert.equal(corrupt.body.style.values.has('visibility'), false);
    assert.equal(corrupt.body.style.values.has('opacity'), false);
});

test('back-forward restore reloads the shared theme and root canvas color', () => {
    const f = fixture();
    f.saved.set(key, JSON.stringify({ theme: 'neumorphism-dark', accent: '#ffdddd', background: 'solid' }));
    f.windowEvents.pageshow();
    assert.equal(f.body.dataset.theme, 'neumorphism-dark');
    assert.equal(f.html.style.values.get('background'), '#252b34');
    assert.equal(f.html.style.colorScheme, 'dark');
    assert.equal(f.body.style.colorScheme, 'dark');
});

test('all app pages load appearance synchronously before CSS and prime body before its content', async () => {
    for (const page of ['index.html', 'reports/index.html', 'admin/index.html']) {
        const html = await readFile(new URL(`../${page}`, import.meta.url), 'utf8');
        const scripts = [...html.matchAll(/<script\b[^>]*src="[^"]*site-appearance\.js"[^>]*><\/script>/g)];
        assert.equal(scripts.length, 1);
        assert.doesNotMatch(scripts[0][0], /\b(?:defer|async)\b/);
        assert.ok(scripts[0].index < html.indexOf('rel="stylesheet"'));
        assert.match(html, /<body[^>]*>\s*<script>window\.studyAppearance\?\.prime\(document\.body\);<\/script>/);
    }
});

test('custom theme has an independent palette, background and continuous transparency that survive switching and reload', () => {
    const f = fixture();
    f.control('[name="accentHex"]').events.change({ target: { value: '#112233' } });
    f.theme('custom');
    assert.equal(f.control('[data-custom-editor]').hidden, false);
    assert.equal(f.control('[data-preset-transparency]').hidden, true);
    f.control('[name="accentHex"]').events.change({ target: { value: '#00ff88' } });
    f.control('[name="background"]').events.change({ target: { value: 'solid' } });
    f.control('[data-custom-hex="ground"]').events.input({ target: { value: '#152335' } });
    f.control('[data-custom-range="transparency"]').events.input({ target: { value: '47' } });
    assert.equal(f.body.style.values.get('--ui-ground'), '#152335');
    assert.equal(f.body.style.values.get('--ui-panel'), 'rgba(42,45,48,0.53)');
    assert.equal(f.body.dataset.background, 'solid');
    f.theme('minimal');
    assert.equal(f.control('[data-custom-editor]').hidden, true);
    assert.equal(f.api.snapshot().accent, '#112233');
    assert.equal(f.body.dataset.background, 'gradient');
    f.theme('custom');
    assert.equal(f.control('[name="accent"]').value, '#00ff88');
    const other = fixture({ saved: f.saved, early: true });
    assert.equal(other.html.style.values.get('background'), '#152335');
    other.startBody(); other.domReady();
    assert.equal(other.body.style.values.get('--ui-panel'), 'rgba(42,45,48,0.53)');
    const copy = other.api.snapshot(); copy.custom.ground = '#ffffff';
    assert.equal(other.api.snapshot().custom.ground, '#152335');
});

test('custom geometry, styles, exact colors, fonts and effects update actual tokens; low-power glass avoids blur', () => {
    const f = fixture(); f.theme('custom');
    for (const [name, value] of Object.entries({ radius: 30, buttonRadius: 4, borderWidth: 3, blur: 26, shadow: 45, angle: 240 })) {
        f.control(`[data-custom-range="${name}"]`).events.input({ target: { value: String(value) } });
    }
    assert.equal(f.body.style.values.get('--custom-radius'), '30px');
    assert.equal(f.body.style.values.get('--custom-button-radius'), '4px');
    assert.equal(f.body.style.values.get('--custom-border-width'), '3px');
    assert.equal(f.body.style.values.get('--custom-blur'), 'blur(26px)');
    assert.match(f.body.style.values.get('--appearance-gradient'), /240deg/);
    f.control('[data-custom-select="style"]').events.change({ target: { value: 'flat' } });
    assert.equal(f.body.style.values.get('--custom-shadow'), 'none');
    assert.equal(f.body.style.values.get('--custom-blur'), 'none');
    f.control('[data-custom-select="style"]').events.change({ target: { value: 'soft' } });
    assert.match(f.body.style.values.get('--custom-shadow'), /-6px -6px/);
    f.control('[data-custom-select="font"]').events.change({ target: { value: 'mono' } });
    assert.match(f.body.style.values.get('--custom-font'), /monospace/);
    f.control('[data-custom-check="contrast"]').events.change({ target: { checked: false } });
    f.control('[data-custom-color="text"]').events.input({ target: { value: '#223344' } });
    assert.equal(f.body.style.values.get('--ui-text'), '#223344');
    for (const name of ['motion', 'particles']) f.control(`[data-custom-check="${name}"]`).events.change({ target: { checked: false } });
    assert.equal(f.body.dataset.customMotion, 'false'); assert.equal(f.body.dataset.customParticles, 'false');
    f.control('[data-custom-select="style"]').events.change({ target: { value: 'glass' } });
    assert.equal(fixture({ saved: f.saved, cores: 2 }).body.style.values.get('--custom-blur'), 'none');
    assert.equal(fixture({ saved: f.saved, quietMode: true }).body.style.values.get('--custom-blur'), 'none');
});

test('custom normalization blocks arbitrary CSS, invalid enums and non-finite sizes; reset supports undo', () => {
    const f = fixture(); f.theme('custom');
    const normalized = f.api.normalize({ theme: 'custom', custom: { ground: 'url(https://evil.test)', radius: 999, blur: -5, shadow: Infinity, font: 'url(x)', style: '__proto__', contrast: 'false' } });
    assert.equal(normalized.custom.ground, '#17191b');
    assert.equal(normalized.custom.radius, 36); assert.equal(normalized.custom.blur, 0);
    assert.equal(normalized.custom.shadow, 25); assert.equal(normalized.custom.font, 'sans');
    assert.equal(normalized.custom.style, 'glass'); assert.equal(normalized.custom.contrast, true);
    assert.equal(f.api.normalize(null).theme, 'neumorphism');
    f.control('[data-custom-range="radius"]').events.input({ target: { value: '28' } });
    const reset = f.control('[data-custom-reset]'); reset.events.click({ target: reset });
    assert.equal(f.api.snapshot().custom.radius, 16);
    reset.events.click({ target: reset }); assert.equal(f.api.snapshot().custom.radius, 28);
    const input = f.control('[data-custom-hex="ground"]'); input.events.change({ target: { value: 'invalid' } });
    assert.match(f.control('[data-appearance-notice]').textContent, /HEX/);
    const other = fixture({ saved: f.saved });
    other.control('[data-custom-range="radius"]').events.input({ target: { value: '8' } });
    f.windowEvents.storage({ key }); assert.equal(f.body.style.values.get('--custom-radius'), '8px');
});

test('both pages share appearance assets and controls; glowing lessons respect reduced motion', async () => {
    for (const file of ['index.html', 'reports/index.html']) {
        const html = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
        assert.match(html, /data-appearance-settings/);
        assert.match(html, /site-appearance\.js/);
        assert.match(html, /appearance\.css/);
        assert.doesNotMatch(html, /function applyTheme|reportsCustomColor|customColorPickerContainer/);
        for (const [, code] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new vm.Script(code));
    }
    const css = await readFile(new URL('../appearance.css', import.meta.url), 'utf8');
    assert.match(css, /@keyframes current-lesson-glow/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\).*animation: none/);
    assert.match(css, /body\[data-low-power="true"\].*animation: none/);
    const build = await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
    for (const asset of ['appearance.css', 'site-appearance.js', 'schedule-time.js']) assert.ok(build.includes(`'${asset}'`));
});
