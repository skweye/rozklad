import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../site-permissions.js', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(mainAdmin = true) {
    class Element {
        constructor(tag) { this.tag = tag; }
        children = []; listeners = {}; textContent = ''; value = ''; open = false; hidden = false; disabled = false;
        append(...items) { this.children.push(...items); }
        replaceChildren() { this.children = []; }
        setAttribute() {}
        addEventListener(name, callback) { this.listeners[name] = callback; }
        querySelectorAll(tag) { return this.children.flatMap(node => [...(node.tag === tag ? [node] : []), ...node.querySelectorAll(tag)]); }
        showModal() { this.open = true; }
        close() { this.open = false; this.listeners.close?.(); }
        focus() {}
        reportValidity() { return true; }
    }
    const mount = new Element('div'), body = new Element('body');
    let session = { user: { id: 'owner', email: 'owner@example.com' }, mainAdmin: false }, subscriber, fail = false, pending;
    let state = { owner: 'owner@example.com', revision: null, users: [] }, writes = [];
    const auth = { snapshot: () => session, subscribe(fn) { subscriber = fn; }, errorMessage: error => error.message,
        async readPermissions() { if (pending) return pending; return structuredClone(state); },
        async changePermissions(data) {
            writes.push(data); if (fail) throw new Error('permissions_conflict');
            state = { ...state, revision: 'next', users: data.operation === 'save' ? [{ email: data.email, permissions: data.permissions }] : [] };
            return structuredClone(state);
        }
    };
    vm.runInNewContext(source, { window: { studyAuth: auth, addEventListener() {} }, document: { body, querySelector: () => mount, createElement: tag => new Element(tag) } });
    const dialog = mount.children[0], section = dialog;
    const launch = { listeners: { click() { session = { ...session, mainAdmin }; subscriber(session); } } };
    const [header, owner, hint, status, form, listHeading, list] = dialog.children;
    const fields = form.children[0], email = fields.children[0].children[0];
    return { dialog, section, launch, owner, status, fields, email, list, writes,
        checks: fields.children.slice(1, 4).map(label => label.children[0]),
        async open() { launch.listeners.click(); await settle(); },
        async submit() { form.listeners.submit({ preventDefault() {} }); await settle(); },
        async reload() { listHeading.children[1].listeners.click(); await settle(); },
        session(value) { session = value; subscriber(value); },
        fail() { fail = true; }, pending(value) { pending = value; }
    };
}

test('owner UI grants selected permissions, edits and explicitly confirms revocation', async () => {
    const f = fixture(); await f.open();
    assert.equal(f.section.hidden, false); assert.equal(f.fields.disabled, false);
    f.email.value = 'student@example.com'; f.checks[0].checked = true; await f.submit();
    assert.equal(f.writes[0].revision, null); assert.equal(f.writes[0].permissions.createReplacements, true);
    assert.equal(f.writes[0].permissions.editReplacements, false);
    const row = f.list.children[0];
    row.children[1].children[0].listeners.click();
    assert.equal(f.email.value, 'student@example.com'); assert.equal(f.email.readOnly, true);
    row.children[1].children[1].listeners.click();
    const confirmation = row.children[2]; assert.equal(confirmation.hidden, false); assert.equal(f.writes.length, 1);
    confirmation.children[1].listeners.click(); await settle();
    assert.equal(f.writes[1].operation, 'remove'); assert.equal(f.writes[1].revision, 'next');
    assert.equal(f.email.readOnly, false);
});

test('nonowners never see management; logout clears private data and invalidates late responses', async () => {
    const ordinary = fixture(false); await ordinary.open();
    assert.equal(ordinary.section.hidden, true);
    const f = fixture(); let resolve;
    f.pending(new Promise(done => { resolve = done; }));
    f.launch.listeners.click(); assert.equal(f.fields.disabled, true);
    f.session({ user: null, mainAdmin: false });
    assert.equal(f.section.hidden, true);
    resolve({ owner: 'private@example.com', revision: 'r', users: [] }); await settle();
    assert.equal(f.owner.textContent, ''); assert.equal(f.list.children.length, 0);
});

test('conflicts keep typed input but disable further writes until refreshed', async () => {
    const f = fixture(); await f.open(); f.email.value = 'student@example.com'; f.checks[1].checked = true;
    f.fail(); await f.submit();
    assert.match(f.status.textContent, /permissions_conflict/); assert.equal(f.email.value, 'student@example.com'); assert.equal(f.fields.disabled, true);
    await f.submit(); assert.equal(f.writes.length, 1);
    await f.reload(); assert.equal(f.fields.disabled, false);
});

test('management lives only on the admin page; public pages load its navigation link', async () => {
    for (const path of ['index.html', 'reports/index.html']) {
        const html = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
        assert.doesNotMatch(html, /site-permissions\.js/);
        assert.ok(html.indexOf('site-admin.js') > html.indexOf('site-auth.js'));
    }
    const admin = await readFile(new URL('../admin/index.html', import.meta.url), 'utf8');
    assert.ok(admin.indexOf('site-permissions.js') > admin.indexOf('site-auth.js'));
    assert.match(await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8'), /site-permissions\.js/);
});
