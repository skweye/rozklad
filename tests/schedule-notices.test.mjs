import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../schedule-notices.js', import.meta.url), 'utf8');
const clock = await readFile(new URL('../schedule-time.js', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const record = (extra = {}) => ({ date: '2026-09-24', index: 0, revision: 'a', lesson: { s: 'Бази даних' }, ...extra });
function fixture({ app = 'schedule', storage = new Map(), storageFails = false, autoplayBlocked = false, popover = true } = {}) {
    let timestamp = Date.parse('2026-09-24T07:00:00Z'), records = [], failed = false, reads = 0;
    class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [timestamp])); } }
    class Element {
        children = []; attrs = {}; listeners = {}; textContent = ''; hidden = false;
        append(...nodes) { for (const node of nodes) { if (node.parentElement) node.parentElement.children = node.parentElement.children.filter(child => child !== node); node.parentElement = this; this.children.push(node); } }
        replaceChildren() { this.children = []; }
        setAttribute(key, value) { this.attrs[key] = value; }
        addEventListener(key, value) { this.listeners[key] = value; }
        insertAdjacentElement(position, node) { this.after = node; }
        matches() { return this.popoverOpen; }
        showPopover() { this.popoverOpen = true; }
        hidePopover() { this.popoverOpen = false; }
    }
    if (!popover) Element.prototype.showPopover = undefined;
    const header = new Element(), body = new Element(); body.dataset = { app };
    let dialogs = [], observer;
    const document = { body, hidden: false, listeners: {}, createElement: () => new Element(), querySelector: () => header, querySelectorAll: () => dialogs, addEventListener(key, value) { const old = this.listeners[key]; this.listeners[key] = old ? (...args) => { old(...args); value(...args); } : value; } };
    const window = { listeners: {}, addEventListener(key, value) { this.listeners[key] = value; } };
    const timers = new Set();
    const sounds = [];
    class Audio {
        constructor(url) { this.url = url; this.plays = 0; this.pauses = 0; sounds.push(this); }
        play() { this.plays++; return autoplayBlocked ? Promise.reject(Error('NotAllowedError')) : Promise.resolve(); }
        pause() { this.pauses++; }
    }
    const context = vm.createContext({ window, document, Date: ClockDate, AbortSignal, Audio,
        MutationObserver: class { constructor(callback) { observer = callback; } observe() {} },
        localStorage: { getItem(key) { if (storageFails) throw Error('blocked'); return storage.get(key) ?? null; }, setItem(key, value) { if (storageFails) throw Error('blocked'); storage.set(key, value); } },
        fetch: async () => { reads++; if (failed) throw Error('offline'); return Response.json({ replacements: records }); },
        setInterval(fn) { timers.add(fn); return fn; }, clearInterval(fn) { timers.delete(fn); } });
    vm.runInContext(clock, context); vm.runInContext(source, context);
    const root = body.children[0];
    return { root, window, document, timers, storage, sounds, get reads() { return reads; },
        background(value) { window.studyBackgroundNotifications = { enabled: () => value, show() {} }; },
        allowSound() { autoplayBlocked = false; document.listeners.click(); },
        modal(open) { const dialog = new Element(); dialog.tagName = 'DIALOG'; dialogs = open ? [dialog] : []; observer([{ target: dialog }]); return dialog; },
        update: window.studyScheduleNotices.update,
        rows: () => root.children[1].children[1].children,
        dismiss() { root.children[0].children[1].listeners.click(); },
        setRecords(value) { records = value; }, fail(value) { failed = value; }, tick() { [...timers][0]?.(); },
        advanceDay() { timestamp += 86400000; }
    };
}

test('anonymous visitors get date, pair and subject notices with no duplicate schedule fetch', () => {
    const f = fixture();
    assert.equal(f.root.hidden, true); assert.equal(f.reads, 0);
    f.update([record()]);
    assert.equal(f.root.hidden, false);
    assert.match(f.rows()[0].children[0].textContent, /24.*1 пара/);
    assert.equal(f.rows()[0].children[1].textContent, 'Заміна: Бази даних');
    assert.equal(f.root.children[0].children[0].attrs['aria-live'], 'polite');
    const row = f.rows()[0]; f.update([record()]); assert.equal(f.rows()[0], row);
});

test('window notices name the free period and cancellation restores the base schedule', () => {
    const f = fixture(); f.update([record({ lesson: null, source: { kind: 'window' } })]);
    assert.equal(f.rows()[0].children[1].textContent, 'Заміна: Вікно — пари немає');
    f.update([]); assert.match(f.rows()[0].children[1].textContent, /Діє основний розклад/);
});

test('dismissal survives reload and shared-page navigation; a new revision notifies again', () => {
    const storage = new Map(), f = fixture({ storage }); f.update([record()]); f.dismiss();
    assert.equal(f.root.hidden, true);
    f.update([record()]); assert.equal(f.root.hidden, true);
    const next = fixture({ storage }); next.update([record()]); assert.equal(next.root.hidden, true);
    next.update([record({ revision: 'b', lesson: { s: 'ООП' } })]);
    assert.equal(next.root.hidden, false); assert.match(next.rows()[0].children[1].textContent, /ООП/);
    assert.doesNotMatch([...storage.values()].join(), /Бази даних|email|token/);
});

test('active visitors see cancellations and safe text, while past days are not announced', () => {
    const f = fixture(); f.update([record({ lesson: { s: '<img src=x onerror=attack()>' } })]);
    assert.match(f.rows()[0].children[1].textContent, /<img/);
    assert.equal(f.rows()[0].children[1].children.length, 0);
    f.update([]); assert.match(f.rows()[0].children[1].textContent, /скасовано/);
    f.advanceDay(); f.update([]); assert.equal(f.root.hidden, true);
    f.update([record()]); assert.equal(f.root.hidden, true);
});

test('blocked storage retains session dismissal and cross-tab acknowledgements clear banners', () => {
    const f = fixture({ storageFails: true }); f.update([record()]); f.dismiss(); f.update([record()]);
    assert.equal(f.root.hidden, true);
    const a = fixture(), b = fixture({ storage: a.storage }); a.update([record()]); b.update([record()]);
    a.dismiss(); b.window.listeners.storage({ key: 'study-schedule-notices-seen-v1' }); assert.equal(b.root.hidden, true);
});

test('report page polls public changes, never invents cancellation on failure, pauses when hidden', async () => {
    const f = fixture({ app: 'reports' }); await settle();
    f.setRecords([record()]); f.tick(); await settle(); assert.equal(f.root.hidden, false);
    f.fail(true); f.tick(); await settle(); assert.match(f.rows()[0].children[1].textContent, /Заміна:/);
    f.document.hidden = true; f.document.listeners.visibilitychange(); assert.equal(f.timers.size, 0);
    f.fail(false); f.setRecords([]); f.document.hidden = false; f.document.listeners.visibilitychange(); await settle();
    assert.match(f.rows()[0].children[1].textContent, /скасовано/);
    f.window.listeners.pagehide(); assert.equal(f.timers.size, 0);
});

test('report polling remains active in a hidden tab only after opting into background notifications', async () => {
    const f = fixture({ app: 'reports' }); await settle();
    f.background(true); f.document.hidden = true; f.document.listeners.visibilitychange(); await settle();
    assert.equal(f.timers.size, 1);
    f.setRecords([record()]); f.tick(); await settle(); assert.equal(f.root.hidden, false);
    f.background(false); f.window.listeners['study-background-notifications-change']();
    assert.equal(f.timers.size, 0);
});

test('both app pages load public notices after date helpers, and the build includes the script', async () => {
    for (const file of ['index.html', 'reports/index.html']) {
        const html = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
        assert.ok(html.indexOf('schedule-time.js') < html.indexOf('schedule-notices.js'));
        assert.match(html, /schedule-notices\.js/);
    }
    const build = await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
    assert.match(build, /'schedule-notices.js'/);
});

test('notice uses the top layer and stays interactive above an opened modal', () => {
    const f = fixture(); f.update([record()]);
    assert.equal(f.root.attrs.popover, 'manual');
    assert.equal(f.root.popoverOpen, true);
    const dialog = f.modal(true);
    assert.equal(f.root.parentElement, dialog);
    assert.equal(f.root.popoverOpen, true);
    f.modal(false); assert.equal(f.root.parentElement, f.document.body);
    f.dismiss(); assert.equal(f.root.popoverOpen, false);
    const fallback = fixture({ popover: false }); fallback.update([record()]);
    assert.equal(fallback.root.hidden, false);
    const fallbackDialog = fallback.modal(true);
    assert.equal(fallback.root.parentElement, fallbackDialog);
});

test('sound plays once per change, not each poll or click, and uses the shared local audio', async () => {
    const f = fixture(); f.update([record()]); await settle();
    assert.equal(f.sounds[0].url, '/sound.mp3'); assert.equal(f.sounds[0].volume, 0.6);
    assert.equal(f.sounds[0].plays, 1);
    f.update([record()]); f.allowSound(); await settle(); assert.equal(f.sounds[0].plays, 1);
    f.update([record({ revision: 'b' })]); await settle(); assert.equal(f.sounds[0].plays, 2);
    f.dismiss(); f.allowSound(); await settle(); assert.equal(f.sounds[0].plays, 2);
});

test('blocked autoplay retries after interaction and hidden tabs never sound until visible', async () => {
    const f = fixture({ autoplayBlocked: true }); f.update([record()]); await settle();
    assert.equal(f.sounds[0].plays, 1);
    f.update([record()]); await settle(); assert.equal(f.sounds[0].plays, 1);
    f.allowSound(); await settle(); assert.equal(f.sounds[0].plays, 2);
    f.allowSound(); await settle(); assert.equal(f.sounds[0].plays, 2);
    f.document.hidden = true; f.document.listeners.visibilitychange();
    f.update([record({ revision: 'b' })]); await settle(); assert.equal(f.sounds[0].plays, 2);
    f.document.hidden = false; f.document.listeners.visibilitychange(); await settle(); assert.equal(f.sounds[0].plays, 3);
});

test('popup is viewport-fixed, responsive, layered above page UI and respects reduced motion', async () => {
    const css = await readFile(new URL('../workspace.css', import.meta.url), 'utf8');
    assert.match(css, /\.schedule-notices\s*\{[^}]*position: fixed;[^}]*top: max\(16px,env\(safe-area-inset-top\)\);[^}]*right: max/);
    assert.match(css, /\.schedule-notices\s*\{[^}]*z-index: 2147483647/);
    assert.match(css, /prefers-reduced-motion: reduce\) \{ \.schedule-notices \{ animation: none/);
});

test('author exclusions suppress popup, sound and background delivery without marking other users read', async () => {
    const f = fixture(); let deliveries = 0;
    f.window.studyBackgroundNotifications = { show(notices) { deliveries += notices.length; } };
    const id = '2026-09-24/0@a';
    f.update([record()], [id]); await settle();
    assert.equal(f.root.hidden, true); assert.equal(f.sounds.length, 0); assert.equal(deliveries, 0);
    assert.equal(f.window.studyScheduleNotices.shouldNotify(id), false);
    f.update([record()], [id]); await settle(); assert.equal(deliveries, 0);
    assert.equal(f.storage.size, 0);
    // The same pair changed by another administrator must still notify this author.
    f.update([record({ revision: 'b' })], []); await settle();
    assert.equal(f.root.hidden, false); assert.equal(f.sounds[0].plays, 1); assert.equal(deliveries, 1);
    // Cancelling one's own edit is quiet too.
    f.update([], ['2026-09-24/0@removed:b']); await settle();
    assert.equal(f.root.hidden, true); assert.equal(f.sounds[0].plays, 1);
});

test('newly personalized responses remove a pending own notice even when the record did not change', () => {
    const f = fixture(); f.update([record()]); assert.equal(f.root.hidden, false);
    f.update([record()], ['2026-09-24/0@a']); assert.equal(f.root.hidden, true);
    f.update([record()], []); assert.equal(f.root.hidden, false);
});
