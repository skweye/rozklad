/* Owner-only live panel. The server authorizes every read. */
(() => {
    'use strict';
    const auth = window.studyAuth, mount = document.querySelector('[data-admin-presence]');
    if (!auth || !mount) return;
    let timer, epoch = 0, loading = false, identity = '', stopped = false;
    const node = (tag, text = '', className = '') => {
        const element = document.createElement(tag); element.textContent = text; element.className = className; return element;
    };
    const panel = node('section', '', 'permissions-dialog admin-widget'); panel.hidden = true;
    panel.setAttribute('aria-labelledby', 'presence-heading');
    const heading = node('h2', 'Користувачі онлайн'); heading.id = 'presence-heading';
    const header = node('div', '', 'permissions-heading'); header.append(heading);
    const hint = node('p', 'Видима вкладка протягом останніх 2 хвилин. Один Google-акаунт показується один раз; гості рахуються за браузерами.', 'permissions-hint');
    const summary = node('p', '', 'presence-summary');
    const status = node('p', '', 'permissions-status'); status.setAttribute('role', 'status');
    const reload = node('button', 'Оновити'); reload.type = 'button';
    const list = node('div', '', 'permissions-users');
    panel.append(header, hint, summary, reload, status, list); mount.append(panel);
    const time = value => new Date(value).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Kyiv' });
    async function load() {
        if (loading || document.hidden || stopped || !identity) return;
        const token = ++epoch; loading = true; reload.disabled = true;
        status.textContent = 'Оновлюємо…';
        try {
            const data = await auth.readPresence();
            if (token !== epoch) return;
            list.replaceChildren();
            summary.textContent = `З акаунтом: ${data.users.length} · Гостей: ${data.guests}`;
            for (const user of data.users) {
                const row = node('article', '', 'permissions-user presence-user');
                const name = node('strong', user.name || user.email), email = node('p', user.email);
                const page = ({ reports: 'Звіти', schedule: 'Розклад', admin: 'Адмін-панель' })[user.page] || 'Сайт';
                row.append(name, email, node('p', `${page} · Останній сигнал ${time(user.lastSeen)}`)); list.append(row);
            }
            if (!data.users.length) list.append(node('p', 'Зараз немає користувачів із Google-акаунтом онлайн.', 'permissions-hint'));
            status.textContent = `Оновлено ${time(data.updatedAt)} · Київ. Автооновлення кожні 30 с.`;
        } catch (error) {
            if (token !== epoch) return;
            list.replaceChildren(); summary.textContent = '';
            status.textContent = auth.errorMessage(error);
        } finally { if (token === epoch) { loading = false; reload.disabled = false; } }
    }
    function clear() {
        epoch++; loading = false; reload.disabled = false; list.replaceChildren(); summary.textContent = ''; status.textContent = '';
    }
    function resume() {
        clearInterval(timer);
        if (document.hidden || stopped || !identity) return;
        load(); timer = setInterval(load, 30000);
    }
    function update(session) {
        const next = session?.mainAdmin && session.user ? session.user.id : '';
        const changed = identity !== next;
        if (changed) { identity = next; clear(); }
        panel.hidden = !identity;
        if (changed) resume();
    }
    reload.addEventListener('click', load);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); resume(); });
    window.addEventListener('pagehide', () => { stopped = true; clear(); clearInterval(timer); });
    window.addEventListener('pageshow', () => { stopped = false; update(auth.snapshot()); resume(); });
    auth.subscribe(update); update(auth.snapshot());
})();
