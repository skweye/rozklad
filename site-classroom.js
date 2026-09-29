/* Personal deadlines stay in memory; coursework and tokens are not stored in browser storage. */
(() => {
    'use strict';
    const root = document.querySelector('[data-classroom]');
    const auth = window.studyAuth;
    if (!root || !auth) return;
    const iconPath = root.getAttribute('data-icons') === '../ui-icons.svg' ? '../ui-icons.svg' : 'ui-icons.svg';
    const icon = name => `<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="${iconPath}#${name}"/></svg>`;
    root.innerHTML = `
        <div class="classroom-heading"><div class="classroom-heading-copy"><span class="classroom-heading-icon">${icon('book')}</span><div><p class="eyebrow">Google Classroom</p><h2>Найближчі здачі</h2></div></div>
            <button type="button" class="btn classroom-action">Увійти</button></div>
        <p class="classroom-status" role="status" aria-live="polite">Увійдіть, щоб побачити свої роботи та строки здачі.</p>
        <div class="classroom-filters" role="group" aria-label="Фільтр робіт" hidden></div>
        <div class="classroom-tools" hidden>
            <label class="classroom-search-label"><span>Пошук</span><input type="search" class="classroom-search" placeholder="Назва роботи або предмет" maxlength="200" autocomplete="off"></label>
            <label><span>Предмет</span><select class="classroom-subject"><option value="">Усі предмети</option></select></label>
            <label><span>Сортування</span><select class="classroom-sort"><option value="due">За строком</option><option value="subject">За предметом</option><option value="title">За назвою</option></select></label>
        </div>
        <ul class="classroom-list" aria-label="Роботи в Classroom"></ul>
        <button type="button" class="btn classroom-more" hidden>Показати ще</button>
        <p class="classroom-note">${icon('shield')}<span>Лише читання. Сайт не змінює та не здає роботи.</span></p>`;
    const action = root.querySelector('.classroom-action');
    const status = root.querySelector('.classroom-status');
    const filters = root.querySelector('.classroom-filters');
    const list = root.querySelector('.classroom-list');
    const more = root.querySelector('.classroom-more');
    const searchTools = root.querySelector('.classroom-tools');
    const searchInput = root.querySelector('.classroom-search');
    const subjectInput = root.querySelector('.classroom-subject');
    const sortInput = root.querySelector('.classroom-sort');
    const subjectName = item => item.subject ?? item.course ?? '';
    const normalizeSearch = value => String(value).normalize('NFKC').toLocaleLowerCase('uk-UA').replace(/[’'`ʼ]/g, "'").trim();
    const collator = new Intl.Collator('uk-UA', { sensitivity: 'base', numeric: true });
    let identity = null, connected = false, tokenClient = null, generation = 0, loading = false;
    const pageSize = 5;
    let data = null, filter = 'upcoming', visible = pageSize;
    let pendingGrant = null;
    let needsConsent = false;
    let countdownTimer = null, countdowns = [], renderedGroups = '';
    const scopes = 'openid https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.coursework.me.readonly';
    const dateFormat = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const groups = { upcoming: 'Найближчі', overdue: 'Прострочені', undated: 'Без строку', review: 'Повернуті' };
    const filterControls = new Map();
    const dueTime = item => item.due ? Date.parse(item.due) : NaN;
    const group = (item, now = Date.now()) => item.review ? 'review' : !Number.isFinite(dueTime(item)) ? 'undated' : dueTime(item) <= now ? 'overdue' : 'upcoming';

    function stopCountdown() {
        if (countdownTimer !== null) clearTimeout(countdownTimer);
        countdownTimer = null;
    }

    function updateCountdowns(now) {
        for (const { badge, due, deadline } of countdowns) {
            const remaining = due - now;
            const overdue = remaining <= 0;
            const absolute = Math.abs(remaining);
            const minutes = Math.floor(absolute / 60000);
            const days = Math.floor(minutes / 1440);
            const hours = Math.floor(minutes / 60) % 24;
            const duration = [days, hours, minutes % 60].map(value => String(value).padStart(2, '0')).join(':');
            const urgency = overdue ? 'overdue' : remaining <= 3 * 3600000 ? 'urgent' :
                remaining <= 24 * 3600000 ? 'soon' : remaining <= 72 * 3600000 ? 'near' : 'safe';
            badge.setAttribute('data-urgency', urgency);
            badge.textContent = `${overdue ? '−' : ''}${duration}`;
            const descriptions = { safe: 'Більше трьох днів', near: 'До трьох днів', soon: 'До доби', urgent: 'До трьох годин', overdue: 'Строк минув' };
            const readable = absolute < 60000 ? 'менше хвилини' : `${days} дн., ${hours} год., ${minutes % 60} хв.`;
            badge.title = `${descriptions[urgency]}. ${overdue ? 'Після строку минуло' : 'До здачі залишилось'}: ${readable} Формат DD:HH:MM — дні:години:хвилини.`;
            badge.setAttribute('aria-label', badge.title);
            deadline.className = `classroom-deadline${overdue ? ' is-overdue' : ''}`;
        }
    }

    function scheduleCountdown() {
        stopCountdown();
        if (!data || document.hidden || !data.assignments.some(item => Number.isFinite(dueTime(item)))) return;
        const now = Date.now();
        // One lightweight timer for the panel; no network calls or per-card intervals.
        // Wake at the deadline itself if it falls before the next minute tick.
        const nextDeadline = data.assignments.reduce((delay, item) => {
            const remaining = dueTime(item) - now;
            return remaining > 0 ? Math.min(delay, remaining) : delay;
        }, 60000);
        countdownTimer = setTimeout(tickCountdown, Math.max(1, nextDeadline));
    }

    function tickCountdown() {
        if (!data || document.hidden) { stopCountdown(); return; }
        const now = Date.now();
        const signature = data.assignments.map(item => group(item, now)).join(',');
        // Move newly overdue works to the correct filter, but leave cards untouched on normal ticks.
        if (signature !== renderedGroups) { draw(); return; }
        updateCountdowns(now);
        scheduleCountdown();
    }

    function clear() {
        stopCountdown();
        countdowns = [];
        renderedGroups = '';
        data = null;
        list.replaceChildren();
        filters.replaceChildren();
        filterControls.clear();
        filters.hidden = true;
        more.hidden = true;
        searchTools.hidden = true;
        searchInput.value = '';
        subjectInput.replaceChildren();
        subjectInput.value = '';
        sortInput.value = 'due';
    }

    function refreshSubjects() {
        const previous = subjectInput.value;
        subjectInput.replaceChildren();
        const subjects = [...new Set(data.assignments.map(subjectName).filter(Boolean))].sort(collator.compare);
        for (const subject of ['', ...subjects]) {
            const option = document.createElement('option');
            option.value = subject;
            option.textContent = subject || 'Усі предмети';
            subjectInput.append(option);
        }
        subjectInput.value = data.assignments.some(item => subjectName(item) === previous) ? previous : '';
    }

    function draw() {
        if (!data) return;
        const now = Date.now();
        countdowns = [];
        renderedGroups = data.assignments.map(item => group(item, now)).join(',');
        const counts = Object.fromEntries(Object.keys(groups).map(key => [key, data.assignments.filter(item => group(item, now) === key).length]));
        filters.hidden = false;
        searchTools.hidden = false;
        for (const [key, label] of Object.entries(groups)) {
            // Keep the button and its SVG mounted: replacing external <use> nodes on
            // every click can lose their painting, and also drops keyboard focus.
            if (!filterControls.has(key)) {
                const control = document.createElement('button');
                control.type = 'button';
                control.className = 'classroom-filter';
                control.insertAdjacentHTML('afterbegin', icon({ upcoming: 'calendar', overdue: 'clock', undated: 'list', review: 'return' }[key]));
                const caption = document.createElement('span');
                caption.className = 'classroom-filter-label';
                control.append(caption);
                control.addEventListener('click', () => { filter = key; visible = pageSize; draw(); });
                filters.append(control);
                filterControls.set(key, { control, caption });
            }
            const { control, caption } = filterControls.get(key);
            caption.textContent = `${label} · ${counts[key]}`;
            control.setAttribute('aria-pressed', String(filter === key));
        }
        const query = normalizeSearch(searchInput.value || '');
        const selected = data.assignments.filter(item => group(item, now) === filter &&
            (!subjectInput.value || subjectName(item) === subjectInput.value) &&
            (!query || normalizeSearch(`${item.title} ${subjectName(item)} ${item.course}`).includes(query)));
        selected.sort((a, b) => {
            if (sortInput.value === 'title') return collator.compare(a.title, b.title);
            if (sortInput.value === 'subject') {
                const bySubject = collator.compare(subjectName(a), subjectName(b));
                if (bySubject) return bySubject;
            }
            const aDue = dueTime(a), bDue = dueTime(b);
            if (Number.isFinite(aDue) !== Number.isFinite(bDue)) return Number.isFinite(aDue) ? -1 : 1;
            return (Number.isFinite(aDue) ? (filter === 'overdue' ? bDue - aDue : aDue - bDue) : 0) || collator.compare(a.title, b.title);
        });
        list.replaceChildren();
        for (const item of selected.slice(0, visible)) {
            const row = document.createElement('li');
            row.className = 'classroom-work';
            const content = document.createElement('div');
            const course = document.createElement('span');
            course.className = 'classroom-course';
            course.textContent = subjectName(item) || 'Предмет не вказано';
            course.title = `${course.textContent} · ${item.course}`;
            const link = document.createElement(item.url ? 'a' : 'span');
            link.className = 'classroom-title';
            link.textContent = item.title;
            link.title = item.title;
            if (item.url) {
                try {
                    const url = new URL(item.url);
                    if (url.protocol === 'https:' && url.hostname === 'classroom.google.com' && !url.username && !url.password) {
                        // Keep Classroom on the same account even if several Google accounts are open.
                        url.searchParams.set('authuser', identity.email);
                        link.href = url.href;
                        link.target = '_blank';
                        link.rel = 'noopener noreferrer';
                    }
                } catch { /* Leave an invalid link inert. */ }
            }
            content.append(course, link);
            const deadline = document.createElement('span');
            deadline.className = 'classroom-deadline';
            const due = dueTime(item);
            const hasDue = Number.isFinite(due);
            const date = document.createElement(hasDue ? 'time' : 'span');
            date.className = 'classroom-due-date';
            date.textContent = hasDue ? dateFormat.format(new Date(due)) : 'Без строку';
            if (hasDue) date.dateTime = item.due;
            date.insertAdjacentHTML('afterbegin', icon(hasDue ? 'clock' : 'calendar'));
            deadline.append(date);
            if (hasDue) {
                const badge = document.createElement('span');
                badge.className = 'classroom-countdown';
                deadline.append(badge);
                countdowns.push({ badge, due, deadline });
            }
            row.append(content, deadline);
            list.append(row);
        }
        more.hidden = selected.length <= visible;
        const warning = data.partial ? 'Увага: частину курсів або сторінок не вдалося прочитати; список неповний. ' : '';
        const empty = selected.length ? '' : query || subjectInput.value ? 'За вашим пошуком у цій категорії нічого не знайдено. ' : filter === 'upcoming' ? 'Немає незданих робіт із майбутнім строком. ' : 'У цій категорії немає робіт. ';
        status.textContent = `${warning}${empty}Оновлено ${new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' }).format(new Date(data.updatedAt))}. Час: ${zone}.`;
        updateCountdowns(now);
        scheduleCountdown();
    }

    async function load() {
        if (loading || !identity) return;
        const current = generation;
        loading = true;
        action.disabled = true;
        root.setAttribute('aria-busy', 'true');
        status.textContent = 'Завантажуємо курси та перевіряємо, які роботи ще не здані…';
        try {
            const result = await auth.readClassroom();
            if (current !== generation) return;
            data = result;
            connected = true;
            refreshSubjects();
            draw();
        } catch (error) {
            if (current !== generation) return;
            clear();
            if (error.message === 'login_required') { identity = null; connected = false; }
            if (error.message === 'classroom_expired') { connected = false; prepare(); }
            status.textContent = auth.errorMessage(error);
        } finally {
            if (current === generation) {
                loading = false;
                root.setAttribute('aria-busy', 'false');
                updateAction();
            }
        }
    }

    function updateAction() {
        if (pendingGrant && pendingGrant.expiresAt <= Date.now()) pendingGrant = null;
        action.textContent = !identity ? 'Увійти' : connected ? 'Оновити' : pendingGrant ? 'Повторити перевірку' : needsConsent ? 'Надати відсутній дозвіл' : 'Підключити Classroom';
        action.insertAdjacentHTML('afterbegin', icon(!identity ? 'user' : connected || pendingGrant ? 'refresh' : 'link'));
        action.disabled = loading || Boolean(identity && !connected && !tokenClient);
    }

    async function saveGrant() {
        if (!pendingGrant || !identity) return;
        const current = generation;
        loading = true;
        updateAction();
        status.textContent = 'Перевіряємо та зберігаємо підключення Classroom…';
        try {
            await auth.connectClassroom(pendingGrant.token);
            if (current !== generation) return;
            pendingGrant = null;
            needsConsent = false;
            loading = false;
            connected = true;
            await load();
        } catch (error) {
            if (current !== generation) return;
            // A transport failure does not invalidate Google's grant. Allow a user-driven
            // retry with the same short-lived token, kept only in this page's memory.
            if (!['classroom_verification_unavailable', 'unavailable', 'session_expired'].includes(error.message)) pendingGrant = null;
            needsConsent = error.message === 'classroom_scope_required';
            loading = false;
            status.textContent = auth.errorMessage(error);
            updateAction();
        }
    }

    async function prepare() {
        const current = generation;
        try {
            await auth.prepareGoogle();
            if (current !== generation || !identity) return;
            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: auth.snapshot().clientId, scope: scopes, hint: identity.id,
                include_granted_scopes: true,
                callback: async response => {
                    if (current !== generation) return;
                    if (response.error || !response.access_token) {
                        loading = false;
                        status.textContent = 'Доступ не надано. Ви можете підключити Classroom пізніше.';
                        updateAction();
                        return;
                    }
                    const ttl = Number(response.expires_in);
                    pendingGrant = { token: response.access_token, expiresAt: Date.now() + Math.min(Number.isFinite(ttl) && ttl > 0 ? ttl * 1000 : 60000, 3600000) };
                    await saveGrant();
                },
                error_callback: () => {
                    if (current !== generation) return;
                    loading = false;
                    status.textContent = 'Вікно Google закрито або заблоковано. Дозвольте спливні вікна та спробуйте ще раз.';
                    updateAction();
                }
            });
            updateAction();
        } catch (error) {
            if (current !== generation) return;
            status.textContent = auth.errorMessage(error);
            action.textContent = 'Спробувати ще раз';
            action.disabled = false;
        }
    }

    function sessionChanged(session) {
        const changed = identity?.id !== session.user?.id;
        if (changed || !session.user || (connected && !session.classroomConnected)) {
            generation++;
            loading = false;
            root.setAttribute('aria-busy', 'false');
            tokenClient = null;
            pendingGrant = null;
            needsConsent = false;
            clear();
        }
        identity = session.user;
        connected = session.classroomConnected;
        updateAction();
        if (!identity) {
            status.textContent = 'Увійдіть, щоб побачити свої роботи та строки здачі.';
            return;
        }
        if (connected) { if (!data && !loading) load(); }
        else if (changed || !tokenClient) {
            status.textContent = 'Надайте Google дозвіл на читання ваших курсів і робіт. Оберіть той самий акаунт, що й на сайті.';
            prepare();
        }
    }

    action.addEventListener('click', () => {
        if (!identity) return auth.open();
        if (connected) return load();
        if (pendingGrant && pendingGrant.expiresAt > Date.now()) return saveGrant();
        pendingGrant = null;
        if (!tokenClient) return prepare();
        loading = true;
        updateAction();
        status.textContent = 'Надайте дозвіл у вікні Google…';
        try { tokenClient.requestAccessToken({ prompt: needsConsent ? 'consent' : '' }); }
        catch {
            loading = false;
            status.textContent = 'Не вдалося відкрити Google. Спробуйте ще раз.';
            updateAction();
        }
    });
    more.addEventListener('click', () => { visible += pageSize; draw(); });
    searchInput.addEventListener('input', () => { visible = pageSize; draw(); });
    subjectInput.addEventListener('change', () => { visible = pageSize; draw(); });
    sortInput.addEventListener('change', () => { visible = pageSize; draw(); });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopCountdown();
        else tickCountdown();
    });
    // Clear private content before restoring a page from the browser's back/forward cache.
    window.addEventListener('pagehide', () => { generation++; loading = false; tokenClient = null; pendingGrant = null; identity = null; connected = false; clear(); });
    auth.subscribe(sessionChanged);
    sessionChanged(auth.snapshot());
})();
