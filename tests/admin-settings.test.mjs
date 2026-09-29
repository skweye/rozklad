import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../admin/settings.js', import.meta.url), 'utf8');
function fixture() {
    class Element {
        listeners = {}; attrs = {}; focused = false; disabled = false;
        classes = new Set();
        classList = { contains: name => this.classes.has(name), toggle: (name, value) => value ? this.classes.add(name) : this.classes.delete(name) };
        addEventListener(name, fn) { this.listeners[name] = fn; }
        setAttribute(name, value) { this.attrs[name] = value; }
        contains(node) { return node === this || node === this.child; }
        querySelector() { return this.child; }
        focus() { this.focused = true; }
    }
    const nodes = Object.fromEntries(['adminSettingsFab', 'adminSettingsMenu', 'adminTestSound', 'adminSoundStatus'].map(id => [id, new Element()]));
    nodes.adminSettingsMenu.child = new Element();
    const document = { listeners: {}, getElementById: id => nodes[id], addEventListener(name, fn) { this.listeners[name] = fn; } };
    const window = { listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; } };
    let sound, fail = false;
    class Audio {
        constructor(path) { this.path = path; sound = this; }
        async play() { if (fail) throw new Error('blocked'); }
        pause() { this.paused = true; }
    }
    vm.runInNewContext(source, { document, window, Audio });
    return { ...nodes, document, window, sound, fail() { fail = true; } };
}

test('admin settings toggle, outside click and Escape keep accessibility and keyboard focus in sync', () => {
    const f = fixture(), fab = f.adminSettingsFab, menu = f.adminSettingsMenu;
    fab.listeners.click();
    assert.equal(menu.classList.contains('active'), true); assert.equal(menu.inert, false);
    assert.equal(fab.attrs['aria-expanded'], 'true'); assert.equal(menu.child.focused, true);
    f.document.listeners.click({ target: menu.child }); assert.equal(menu.inert, false);
    f.document.listeners.keydown({ key: 'Escape' });
    assert.equal(menu.inert, true); assert.equal(fab.focused, true); assert.equal(fab.attrs['aria-expanded'], 'false');
    fab.listeners.click(); f.document.listeners.click({ target: {} }); assert.equal(menu.inert, true);
    fab.listeners.click(); f.document.listeners.focusin({ target: {} }); assert.equal(menu.inert, true);
    fab.listeners.click(); f.window.listeners.pagehide(); assert.equal(menu.inert, true); assert.equal(f.sound.paused, true);
});

test('sound test uses the shared asset and displays errors inside settings', async () => {
    const f = fixture(); assert.equal(f.sound.path, '/sound.mp3');
    f.fail(); await f.adminTestSound.listeners.click();
    assert.equal(f.adminTestSound.disabled, false); assert.match(f.adminSoundStatus.textContent, /дозвіл браузера/);
});

test('admin shares footer markup and settings assets, with no old inline appearance block', async () => {
    const admin = await readFile(new URL('../admin/index.html', import.meta.url), 'utf8');
    const schedule = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const footer = html => html.match(/<footer class="site-legal-footer"[^]*?<\/footer>/)[0].replace(/\s+/g, ' ');
    assert.equal(footer(admin), footer(schedule));
    assert.doesNotMatch(admin, /admin-appearance|Оформлення панелі|class="site-footer"/);
    assert.equal([...admin.matchAll(/data-appearance-settings/g)].length, 1);
    assert.match(admin, /id="adminSettingsMenu"[^>]*aria-hidden="true" inert/);
    for (const script of ['site-appearance.js', 'background-notifications.js', 'schedule-notices.js', 'admin/settings.js']) assert.ok(admin.includes(script));
    assert.match(admin, /id="bgVideo"/);
    assert.match(await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8'), /admin\/settings\.js/);
});
