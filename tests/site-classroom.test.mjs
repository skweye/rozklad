import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../site-classroom.js', import.meta.url), 'utf8');

test('assignment report creation is removed while the ordinary editor remains independent', async () => {
    for (const file of ['index.html', 'reports/index.html', 'reports/script.js', 'site-classroom.js', 'workspace.css', 'scripts/build.mjs']) {
        const content = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
        assert.doesNotMatch(content, /report-handoff|studyReportHandoff|classroomContext|classroomReportContext|classroom-create-report|classroom-report-context/);
    }
    const editor = await readFile(new URL('../reports/script.js', import.meta.url), 'utf8');
    assert.match(editor, /const STORAGE_KEY = "lab_report_generator_state_v3"/);
    assert.doesNotThrow(() => new vm.Script(editor));
    assert.match(source, /classroom-search/);
    assert.match(source, /classroom-sort/);
    assert.match(source, /classroom-subject/);
});

test('deadline list uses aligned rows, full titles and a narrow-panel layout', async () => {
    const css = await readFile(new URL('../workspace.css', import.meta.url), 'utf8');
    assert.match(css, /\.classroom-list\s*\{[^}]*grid-template-columns: minmax\(0,1fr\); gap: 0/);
    assert.match(css, /\.classroom-work\s*\{[^}]*grid-template-columns: minmax\(0,1fr\) auto/);
    assert.match(css, /\.classroom-list:empty\s*\{\s*display: none/);
    assert.match(css, /\.classroom-title\s*\{[^}]*overflow-wrap: anywhere/);
    assert.doesNotMatch(css, /\.classroom-title\s*\{[^}]*(?:line-clamp|overflow: hidden)/);
    assert.match(css, /container: classroom \/ inline-size/);
    assert.match(css, /@container classroom \(max-width: 520px\)\s*\{\s*\.classroom-work\s*\{[^}]*grid-template-columns: minmax\(0,1fr\);/);
    assert.match(css, /a\.classroom-title:focus-visible\s*\{[^}]*outline: 2px solid/);
});

test('Classroom cards and their script load only on the schedule, while reports retain shared sign-in', async () => {
    const schedule = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const reports = await readFile(new URL('../reports/index.html', import.meta.url), 'utf8');
    assert.match(schedule, /data-classroom/);
    assert.match(schedule, /src="site-classroom\.js"/);
    assert.doesNotMatch(reports, /data-classroom|site-classroom\.js/);
    assert.match(reports, /src="\.\.\/site-auth\.js"/);
});
const settle = () => new Promise(resolve => setImmediate(resolve));
const user = { id: 'student', email: 'student@example.com' };
const sample = {
    updatedAt: new Date().toISOString(), partial: false,
    assignments: [
        { title: '<img src=x onerror=alert(1)>', course: 'Algorithms', due: new Date(Date.now() + 86400000).toISOString(), url: 'https://classroom.google.com/c/123/a/456', review: false },
        { title: 'Overdue', course: 'Math', due: '2020-01-01T12:00:00Z', url: null, review: false },
        { title: 'No date', course: 'English', due: null, url: null, review: false },
        { title: 'Returned', course: 'Systems', due: null, url: null, review: true }
    ]
};

function fixture({ signedIn = false, connected = false, read = async () => sample, connect = async () => {}, now = Date.now() } = {}) {
    class Element {
        children = []; events = {}; attributes = {}; hidden = false; ownText = ''; disabled = false; value = '';
        get textContent() { return this.ownText + this.children.map(child => child.textContent || '').join(''); }
        set textContent(value) { this.ownText = value; this.children = []; this.iconMarkup = ''; }
        append(...children) { this.children.push(...children); }
        replaceChildren(...children) { this.children = children; }
        setAttribute(name, value) { this.attributes[name] = value; }
        getAttribute(name) { return this.attributes[name] || null; }
        insertAdjacentHTML(position, markup) { this.iconMarkup = markup; }
        addEventListener(name, callback) { this.events[name] = callback; }
        querySelector(selector) { return this.elements[selector]; }
        set innerHTML(value) {
            this.markup = value;
            this.elements = Object.fromEntries(['.classroom-action', '.classroom-status', '.classroom-filters', '.classroom-list', '.classroom-more', '.classroom-tools', '.classroom-search', '.classroom-subject', '.classroom-sort'].map(selector => [selector, new Element()]));
        }
    }
    const root = new Element(), events = {}, documentEvents = {}, timers = new Map();
    let clock = now, timerId = 0;
    class ClockDate extends Date {
        constructor(...args) { super(...(args.length ? args : [clock])); }
        static now() { return clock; }
    }
    const document = { hidden: false, querySelector: () => root, createElement: () => new Element(),
        addEventListener: (name, callback) => { documentEvents[name] = callback; } };
    let session = { user: signedIn ? user : null, clientId: 'client', classroomConnected: connected };
    let subscriber, options, lastPrompt, reads = 0, opens = 0, prompts = 0;
    const auth = {
        snapshot: () => session, subscribe: fn => { subscriber = fn; }, prepareGoogle: async () => {},
        open: () => { opens++; }, errorMessage: error => error.message,
        readClassroom: async () => { reads++; return read(); },
        connectClassroom: async token => {
            assert.equal(token, 'access');
            await connect();
            session = { ...session, classroomConnected: true };
            subscriber(session);
        }
    };
    const google = { accounts: { oauth2: { initTokenClient: value => {
        options = value;
        return { requestAccessToken(value) { prompts++; lastPrompt = value; } };
    } } } };
    vm.runInNewContext(source, {
        window: { studyAuth: auth, addEventListener: (name, callback) => { events[name] = callback; } },
        document,
        google, URL, Intl, Date: ClockDate,
        setTimeout(callback, delay) { timers.set(++timerId, { callback, at: clock + delay }); return timerId; },
        clearTimeout(id) { timers.delete(id); }
    });
    return {
        root, events, get options() { return options; }, get reads() { return reads; },
        get opens() { return opens; }, get prompts() { return prompts; },
        get lastPrompt() { return lastPrompt; },
        get timerCount() { return timers.size; },
        advance(milliseconds) {
            clock += milliseconds;
            for (const [id, timer] of [...timers]) {
                if (timer.at <= clock) { timers.delete(id); timer.callback(); }
            }
        },
        hide(value) { document.hidden = value; documentEvents.visibilitychange(); },
        change(value) { session = value; subscriber(value); }
    };
}

test('guests must log in before any coursework is fetched', () => {
    const f = fixture();
    assert.equal(f.reads, 0);
    f.root.querySelector('.classroom-action').events.click();
    assert.equal(f.opens, 1);
    assert.equal(f.reads, 0);
});

test('logged-in visitors explicitly grant read-only access; cancellation permits retry', async () => {
    const f = fixture({ signedIn: true });
    await settle();
    assert.equal(f.reads, 0);
    assert.match(f.options.scope, /classroom\.coursework\.me\.readonly/);
    assert.equal(f.options.hint, user.id);
    const action = f.root.querySelector('.classroom-action');
    action.events.click();
    assert.equal(f.prompts, 1);
    assert.equal(action.disabled, true);
    f.options.error_callback();
    assert.equal(action.disabled, false);
    action.events.click();
    await f.options.callback({ access_token: 'access' });
    assert.equal(f.reads, 1);
    assert.equal(action.textContent, 'Оновити');
    assert.match(action.iconMarkup, /ui-icons\.svg#refresh/);
});

test('deadline groups render safe text and links target the signed-in account', async () => {
    const f = fixture({ signedIn: true, connected: true });
    await settle();
    const list = f.root.querySelector('.classroom-list');
    assert.equal(list.children.length, 1);
    const title = list.children[0].children[0].children[1];
    assert.equal(title.textContent, sample.assignments[0].title);
    assert.equal(title.title, sample.assignments[0].title);
    assert.equal(title.markup, undefined);
    assert.equal(new URL(title.href).searchParams.get('authuser'), user.email);
    const filters = f.root.querySelector('.classroom-filters');
    assert.equal(filters.children.length, 4);
    assert.match(filters.children[0].iconMarkup, /ui-icons\.svg#calendar/);
    assert.match(list.children[0].children[1].children[0].iconMarkup, /ui-icons\.svg#clock/);
    filters.children[1].events.click();
    assert.equal(list.children[0].children[0].children[1].textContent, 'Overdue');
    filters.children[2].events.click();
    assert.equal(list.children[0].children[0].children[1].textContent, 'No date');
    filters.children[3].events.click();
    assert.equal(list.children[0].children[0].children[1].textContent, 'Returned');
    f.change({ user: null, classroomConnected: false });
    assert.equal(list.children.length, 0);
    assert.equal(filters.hidden, true);
});

test('filter icons and buttons remain mounted through switching, search, refresh and deadline changes', async () => {
    const f = fixture({ signedIn: true, connected: true, now: fixedNow, read: async () => worksWithDeadlines([30000, null]) });
    await settle();
    const filters = f.root.querySelector('.classroom-filters');
    const controls = [...filters.children];
    const symbols = ['calendar', 'clock', 'list', 'return'];
    const check = () => {
        assert.equal(filters.children.length, 4);
        controls.forEach((button, i) => {
            assert.equal(filters.children[i], button, 'Do not replace a focused filter button');
            assert.match(button.iconMarkup, new RegExp(`ui-icons\\.svg#${symbols[i]}`));
            assert.equal(button.children.length, 1, 'Only a separate caption is updated');
        });
    };
    for (const index of [1, 2, 3, 0, 2, 0]) {
        controls[index].events.click(); check();
        assert.equal(controls[index].attributes['aria-pressed'], 'true');
        assert.equal(controls.filter(button => button.attributes['aria-pressed'] === 'true').length, 1);
    }
    const search = f.root.querySelector('.classroom-search'); search.value = 'test'; search.events.input(); check();
    const sort = f.root.querySelector('.classroom-sort'); sort.value = 'title'; sort.events.change(); check();
    const subject = f.root.querySelector('.classroom-subject'); subject.events.change(); check();
    f.root.querySelector('.classroom-more').events.click(); check();
    await f.root.querySelector('.classroom-action').events.click(); check();
    f.advance(30000); check();
    assert.equal(controls[1].textContent, 'Прострочені · 1');
    f.change({ user: null, clientId: 'client', classroomConnected: false });
    assert.equal(filters.children.length, 0);
    f.change({ user, clientId: 'client', classroomConnected: true }); await settle();
    assert.equal(filters.children.length, 4);
    assert.notEqual(filters.children[0], controls[0]);
    assert.match(filters.children[0].iconMarkup, /ui-icons\.svg#calendar/);
});

test('late responses cannot restore private coursework after logout', async () => {
    let resolve;
    const pending = new Promise(done => { resolve = done; });
    const f = fixture({ signedIn: true, connected: true, read: () => pending });
    f.change({ user: null, classroomConnected: false });
    resolve(sample);
    await settle();
    assert.equal(f.root.querySelector('.classroom-list').children.length, 0);
    assert.equal(f.root.querySelector('.classroom-action').textContent, 'Увійти');
});

test('compact list shows five works initially and allows expanding the rest', async () => {
    const works = Array.from({ length: 8 }, (_, index) => ({ ...sample.assignments[0], title: `Work ${index + 1}` }));
    const f = fixture({ signedIn: true, connected: true, read: async () => ({ ...sample, assignments: works }) });
    await settle();
    const list = f.root.querySelector('.classroom-list');
    const more = f.root.querySelector('.classroom-more');
    assert.equal(list.children.length, 5);
    assert.equal(more.hidden, false);
    more.events.click();
    assert.equal(list.children.length, 8);
    assert.equal(more.hidden, true);
    f.root.querySelector('.classroom-filters').children[0].events.click();
    assert.equal(list.children.length, 5);
});

test('expired access prompts reconnection and the back/forward cache does not preserve works', async () => {
    const expired = fixture({ signedIn: true, connected: true, read: async () => { throw new Error('classroom_expired'); } });
    await settle();
    assert.equal(expired.root.querySelector('.classroom-action').textContent, 'Підключити Classroom');
    assert.equal(expired.root.querySelector('.classroom-list').children.length, 0);
    const f = fixture({ signedIn: true, connected: true });
    await settle();
    f.events.pagehide();
    assert.equal(f.root.querySelector('.classroom-list').children.length, 0);
});

test('temporary verification failures retry the same grant without another Google popup', async () => {
    let attempts = 0;
    const f = fixture({ signedIn: true, connect: async () => {
        if (++attempts === 1) throw new Error('classroom_verification_unavailable');
    } });
    await settle();
    const action = f.root.querySelector('.classroom-action');
    action.events.click();
    await f.options.callback({ access_token: 'access', expires_in: 3600 });
    assert.equal(action.textContent, 'Повторити перевірку');
    await action.events.click();
    assert.equal(attempts, 2);
    assert.equal(f.prompts, 1);
    assert.equal(f.reads, 1);
});

test('only a genuinely missing permission requests a new consent screen', async () => {
    const f = fixture({ signedIn: true, connect: async () => { throw new Error('classroom_scope_required'); } });
    await settle();
    const action = f.root.querySelector('.classroom-action');
    action.events.click();
    assert.equal(f.lastPrompt.prompt, '');
    await f.options.callback({ access_token: 'access' });
    assert.equal(action.textContent, 'Надати відсутній дозвіл');
    action.events.click();
    assert.equal(f.lastPrompt.prompt, 'consent');
    assert.equal(f.options.include_granted_scopes, true);
});

const fixedNow = Date.parse('2026-09-23T12:00:00Z');
const hours = value => value * 3600000;
function worksWithDeadlines(offsets) {
    return { updatedAt: new Date(fixedNow).toISOString(), assignments: offsets.map((offset, index) => ({
        title: `Work ${index}`, course: 'Course', review: false, url: null,
        due: typeof offset === 'number' ? new Date(fixedNow + offset).toISOString() : offset
    })) };
}
const badgeOf = row => row.children[1].children[1];

test('search, subject filter and sorting combine before pagination and reset on logout', async () => {
    const works = Array.from({ length: 8 }, (_, index) => ({
        id: `c:${index}`, title: `Лабораторна ${8 - index}`, course: 'ПЗ-24-1/9',
        subject: index % 2 ? 'Бази даних' : 'Об’єктно-орієнтоване програмування',
        due: new Date(fixedNow + hours(index + 1)).toISOString()
    }));
    const f = fixture({ signedIn: true, connected: true, now: fixedNow, read: async () => ({ assignments: works, updatedAt: new Date(fixedNow).toISOString() }) });
    await settle();
    const list = f.root.querySelector('.classroom-list'), search = f.root.querySelector('.classroom-search');
    const subject = f.root.querySelector('.classroom-subject'), sort = f.root.querySelector('.classroom-sort');
    const titles = () => list.children.map(row => row.children[0].children[1].textContent);
    assert.equal(list.children[0].children[0].children[0].textContent, works[0].subject);
    assert.equal(subject.children.length, 3);
    f.root.querySelector('.classroom-more').events.click();
    assert.equal(list.children.length, 8);
    sort.value = 'title'; sort.events.change();
    assert.deepEqual(titles(), ['Лабораторна 1', 'Лабораторна 2', 'Лабораторна 3', 'Лабораторна 4', 'Лабораторна 5']);
    subject.value = 'Бази даних'; subject.events.change();
    assert.deepEqual(titles(), ['Лабораторна 1', 'Лабораторна 3', 'Лабораторна 5', 'Лабораторна 7']);
    search.value = '  ЛАБОРАТОРНА 3 '; search.events.input();
    assert.deepEqual(titles(), ['Лабораторна 3']);
    search.value = 'не існує'; search.events.input();
    assert.equal(list.children.length, 0);
    assert.match(f.root.querySelector('.classroom-status').textContent, /нічого не знайдено/);
    subject.value = ''; search.value = "об'єктно"; search.events.input();
    assert.equal(list.children.length, 4);
    search.value = ''; sort.value = 'subject'; sort.events.change();
    assert.equal(list.children[0].children[0].children[0].textContent, 'Бази даних');
    assert.equal(f.reads, 1);
    f.change({ user: null, classroomConnected: false });
    assert.equal(search.value, '');
    assert.equal(subject.children.length, 0);
    assert.equal(f.root.querySelector('.classroom-tools').hidden, true);
});

test('countdowns next to semantic dates use every urgency boundary and compact duration labels', async () => {
    const f = fixture({ signedIn: true, connected: true, now: fixedNow,
        read: async () => worksWithDeadlines([hours(73), hours(72), hours(24), hours(3), 30000]) });
    await settle();
    const rows = f.root.querySelector('.classroom-list').children;
    assert.deepEqual(rows.map(row => badgeOf(row).attributes['data-urgency']), ['urgent', 'urgent', 'soon', 'near', 'safe']);
    assert.deepEqual(rows.map(row => badgeOf(row).textContent), ['00:00:00', '00:03:00', '01:00:00', '03:00:00', '03:01:00']);
    assert.equal(rows[4].children[1].children[0].dateTime, new Date(fixedNow + hours(73)).toISOString());
    assert.match(badgeOf(rows[1]).attributes['aria-label'], /До трьох годин/);
    assert.equal(f.timerCount, 1);
});

test('minute ticks update text and urgency in place, without rebuilding cards or fetching coursework', async () => {
    const f = fixture({ signedIn: true, connected: true, now: fixedNow,
        read: async () => worksWithDeadlines([hours(3) + 60000]) });
    await settle();
    const list = f.root.querySelector('.classroom-list');
    const row = list.children[0], badge = badgeOf(row);
    assert.equal(badge.attributes['data-urgency'], 'soon');
    assert.equal(badge.textContent, '00:03:01');
    f.advance(60000);
    assert.equal(list.children[0], row);
    assert.equal(badge.attributes['data-urgency'], 'urgent');
    assert.equal(badge.textContent, '00:03:00');
    assert.equal(f.reads, 1);
    assert.equal(f.timerCount, 1);
});

test('deadline crossing moves work to overdue immediately and shows elapsed time including returned work', async () => {
    const result = worksWithDeadlines([30000, -hours(25)]);
    result.assignments[1].review = true;
    const f = fixture({ signedIn: true, connected: true, now: fixedNow, read: async () => result });
    await settle();
    f.advance(30000);
    const list = f.root.querySelector('.classroom-list'), filters = f.root.querySelector('.classroom-filters');
    assert.equal(list.children.length, 0);
    assert.equal(filters.children[1].textContent, 'Прострочені · 1');
    filters.children[1].events.click();
    assert.equal(badgeOf(list.children[0]).textContent, '−00:00:00');
    assert.equal(badgeOf(list.children[0]).attributes['data-urgency'], 'overdue');
    f.advance(120000);
    assert.equal(badgeOf(list.children[0]).textContent, '−00:00:02');
    filters.children[3].events.click();
    assert.equal(badgeOf(list.children[0]).textContent, '−01:01:02');
    assert.match(list.children[0].children[1].className, /is-overdue/);
    assert.equal(f.reads, 1);
});

test('undated and invalid dates have no countdown or timer', async () => {
    const f = fixture({ signedIn: true, connected: true, now: fixedNow,
        read: async () => worksWithDeadlines([null, 'invalid-date']) });
    await settle();
    f.root.querySelector('.classroom-filters').children[2].events.click();
    const rows = f.root.querySelector('.classroom-list').children;
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.children[1].children.length === 1));
    assert.ok(rows.every(row => row.children[1].children[0].textContent === 'Без строку'));
    assert.equal(f.timerCount, 0);
});

test('timers pause in hidden tabs, catch up on return and stop on logout or pagehide', async () => {
    for (const exit of ['logout', 'pagehide']) {
        const f = fixture({ signedIn: true, connected: true, now: fixedNow,
            read: async () => worksWithDeadlines([hours(4)]) });
        await settle();
        assert.equal(f.timerCount, 1);
        f.hide(true);
        assert.equal(f.timerCount, 0);
        f.advance(hours(2));
        f.hide(false);
        assert.equal(badgeOf(f.root.querySelector('.classroom-list').children[0]).textContent, '00:02:00');
        assert.equal(f.timerCount, 1);
        if (exit === 'logout') f.change({ user: null, classroomConnected: false });
        else f.events.pagehide();
        assert.equal(f.timerCount, 0);
        f.hide(false);
        f.advance(hours(4));
        assert.equal(f.timerCount, 0);
        assert.equal(f.root.querySelector('.classroom-list').children.length, 0);
    }
});

test('DD:HH:MM preserves days, pads each unit and rolls through day/hour boundaries', async () => {
    const f = fixture({ signedIn: true, connected: true, now: fixedNow,
        read: async () => worksWithDeadlines([hours(24), hours(1), hours(2400) + hours(2) + 5 * 60000]) });
    await settle();
    const list = f.root.querySelector('.classroom-list');
    assert.deepEqual(list.children.map(row => badgeOf(row).textContent), ['00:01:00', '01:00:00', '100:02:05']);
    assert.match(badgeOf(list.children[2]).attributes['aria-label'], /100 дн., 2 год., 5 хв/);
    assert.match(badgeOf(list.children[0]).title, /DD:HH:MM/);
    f.advance(60000);
    assert.deepEqual(list.children.map(row => badgeOf(row).textContent), ['00:00:59', '00:23:59', '100:02:04']);
});
