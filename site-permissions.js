/* The owner manages delegated schedule rights; enforcement lives in the server function. */
(() => {
    'use strict';
    const auth = window.studyAuth, mount = document.querySelector('[data-admin-permissions]');
    if (!auth || !mount) return;
    const labels = { createReplacements: 'Створювати заміни', editReplacements: 'Редагувати заміни', cancelReplacements: 'Скасовувати заміни' };
    const element = (tag, text, className) => {
        const node = document.createElement(tag);
        if (text) node.textContent = text;
        if (className) node.className = className;
        return node;
    };
    const button = text => { const node = element('button', text); node.type = 'button'; return node; };
    const dialog = element('section', '', 'permissions-dialog admin-widget');
    dialog.hidden = true;
    dialog.setAttribute('aria-labelledby', 'permissions-heading');
    const heading = element('h2', 'Права доступу'); heading.id = 'permissions-heading';
    const header = element('div', '', 'permissions-heading');
    header.append(heading);
    const owner = element('p', '', 'permissions-owner');
    const hint = element('p', 'Вкажіть Google-пошту користувача та дозвольте потрібні дії. Керування правами залишається тільки у головного адміністратора.', 'permissions-hint');
    const status = element('p', '', 'permissions-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const form = element('form'), fields = element('fieldset', '', 'permissions-fields');
    fields.setAttribute('aria-label', 'Надати або змінити права');
    const emailLabel = element('label', 'Google-пошта');
    const email = element('input'); email.type = 'email'; email.required = true; email.maxLength = 254; email.autocomplete = 'off'; email.spellcheck = false; email.placeholder = 'name@example.com';
    emailLabel.append(email); fields.append(emailLabel);
    const boxes = {};
    for (const [key, text] of Object.entries(labels)) {
        const label = element('label', '', 'permissions-check'), input = element('input'); input.type = 'checkbox';
        boxes[key] = input; label.append(input, element('span', text)); fields.append(label);
    }
    const save = button('Зберегти права'); save.type = 'submit';
    const reset = button('Очистити форму'), actions = element('div', '', 'permissions-actions');
    actions.append(save, reset); fields.append(actions); form.append(fields);
    const listHeading = element('div', '', 'permissions-heading'), reload = button('Оновити');
    listHeading.append(element('h3', 'Користувачі з доступом'), reload);
    const list = element('div', '', 'permissions-users');
    dialog.append(header, owner, hint, status, form, listHeading, list); mount.append(dialog);
    let identity = '', epoch = 0, busy = false, loaded = false, state = null;
    const controls = () => {
        fields.disabled = busy || !loaded; reload.disabled = busy;
        list.querySelectorAll('button').forEach(node => { node.disabled = busy || !loaded; });
        dialog.setAttribute('aria-busy', String(busy));
    };
    const clearForm = () => { email.value = ''; email.readOnly = false; Object.values(boxes).forEach(input => { input.checked = false; }); };
    function render() {
        owner.textContent = `Головний адміністратор: ${state.owner}. Змінюється лише в конфігурації сервера.`;
        list.replaceChildren();
        if (!state.users.length) list.append(element('p', 'Додаткові права ще нікому не надано.', 'permissions-hint'));
        for (const user of state.users) {
            const row = element('article', '', 'permissions-user'), info = element('div');
            info.append(element('strong', user.email), element('p', Object.entries(labels).filter(([key]) => user.permissions[key]).map(([, text]) => text).join(' · ')));
            const edit = button('Змінити'), revoke = button('Відкликати'), rowActions = element('div', '', 'permissions-actions');
            rowActions.append(edit, revoke); row.append(info, rowActions);
            const confirmation = element('div', '', 'permissions-confirm'); confirmation.hidden = true;
            const confirm = button('Так, відкликати'), cancel = button('Залишити');
            confirmation.append(element('p', `Відкликати всі додаткові права для ${user.email}? Звичайний доступ до сайту залишиться.`), confirm, cancel); row.append(confirmation);
            edit.addEventListener('click', () => {
                email.value = user.email; email.readOnly = true;
                Object.keys(boxes).forEach(key => { boxes[key].checked = user.permissions[key] === true; });
                status.textContent = 'Змініть дозволи та збережіть. Без позначених дозволів доступ буде відкликано.';
                email.focus();
            });
            revoke.addEventListener('click', () => { confirmation.hidden = false; confirm.focus(); });
            cancel.addEventListener('click', () => { confirmation.hidden = true; revoke.focus(); });
            confirm.addEventListener('click', () => change({ operation: 'remove', email: user.email }));
            list.append(row);
        }
        controls();
    }
    async function request(operation, success) {
        if (busy || !identity || dialog.hidden) return;
        const token = ++epoch; busy = true; controls(); status.textContent = 'Зачекайте…';
        try {
            const result = await operation();
            if (token !== epoch) return;
            state = result; loaded = true; render(); status.textContent = success;
            clearForm();
        } catch (error) {
            if (token !== epoch) return;
            loaded = false;
            status.textContent = `${auth.errorMessage(error)} Натисніть «Оновити», щоб перевірити актуальні права.`;
        } finally { if (token === epoch) { busy = false; controls(); } }
    }
    const load = () => request(() => auth.readPermissions(), 'Права актуальні.');
    const change = data => {
        if (!loaded) return;
        return request(() => auth.changePermissions({ ...data, revision: state.revision }), 'Права збережено. Вони перевірятимуться під час наступної дії користувача.');
    };
    form.addEventListener('submit', event => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        change({ operation: 'save', email: email.value.trim(), permissions: Object.fromEntries(Object.entries(boxes).map(([key, input]) => [key, input.checked])) });
    });
    reset.addEventListener('click', clearForm); reload.addEventListener('click', load);
    function clear() {
        epoch++; busy = false; loaded = false; state = null; list.replaceChildren(); owner.textContent = ''; status.textContent = ''; clearForm(); controls();
    }
    function update(session) {
        const next = session?.mainAdmin && session.user ? session.user.id : '';
        const changed = next !== identity;
        if (changed) { identity = next; clear(); }
        dialog.hidden = !identity; controls();
        if (changed && identity) load();
    }
    window.addEventListener('pagehide', () => { identity = ''; dialog.hidden = true; clear(); });
    window.addEventListener('pageshow', () => update(auth.snapshot()));
    auth.subscribe(update); update(auth.snapshot());
})();
