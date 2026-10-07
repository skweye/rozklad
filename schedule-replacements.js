/* Public, date-scoped substitutions. All write permissions are enforced by the API. */
(() => {
    'use strict';
    const grid = document.getElementById('scheduleGrid');
    if (!grid) return;
    const clock = window.studyScheduleTime, auth = window.studyAuth;
    const status = document.getElementById('replacementStatus');
    const refreshButton = document.getElementById('refreshReplacements');
    const editToggle = document.getElementById('toggleReplacementEditing');
    let records = [], suppressedIds = [], ready = false, stale = false, loading = false, generation = 0;
    let admin = Boolean(auth?.snapshot().scheduleAdmin), timer, editing = null, busy = false, editMode = false;
    const readRights = session => session?.permissions || { createReplacements: Boolean(session?.scheduleAdmin), editReplacements: Boolean(session?.scheduleAdmin), cancelReplacements: Boolean(session?.scheduleAdmin) };
    let rights = readRights(auth?.snapshot());
    const entries = () => records;
    const canEdit = () => admin && ready && !stale && editMode;
    const canEditSlot = replacement => canEdit() && (replacement ? rights.editReplacements || rights.cancelReplacements : rights.createReplacements);
    const redraw = () => window.scheduleReplacementView?.refresh();
    const label = lesson => !lesson ? 'Вікно — пари немає' : (Array.isArray(lesson) ? lesson : [lesson]).map(item => [item.s.trim(), item.g ? `гр. ${item.g}` : '', item.t, item.r && item.r !== '-' ? `ауд. ${item.r}` : '', item.note].filter(Boolean).join(' · ')).join(' / ');
    const now = () => clock.schoolNow();
    const dialog = document.createElement('dialog');
    dialog.className = 'replacement-dialog';
    dialog.setAttribute('aria-labelledby', 'replacementDialogTitle');
    dialog.innerHTML = `
        <form class="replacement-form">
            <div class="replacement-dialog-heading"><div><p class="replacement-eyebrow">Керування розкладом</p><h2 id="replacementDialogTitle">Заміна пари</h2></div><button type="button" class="btn replacement-close" aria-label="Закрити">×</button></div>
            <p class="replacement-date"></p>
            <div class="replacement-before"><span class="replacement-eyebrow">За основним розкладом</span><p class="replacement-base"></p></div>
            <div class="replacement-picker"><label class="replacement-search-label" for="replacementSearch">На яку пару замінити?</label>
            <input type="search" id="replacementSearch" class="replacement-search" placeholder="Предмет, викладач або вікно…" autocomplete="off">
            <fieldset class="replacement-options"><legend class="replacement-sr-only">Виберіть нову пару</legend><div class="replacement-choices"></div></fieldset>
            <p class="replacement-empty" hidden>Нічого не знайдено. Спробуйте іншу назву або прізвище.</p>
            <div class="replacement-after"><span class="replacement-eyebrow">Буде замість неї</span><p class="replacement-selection">Оберіть пару зі списку</p></div></div>
            <p class="replacement-help">Лише на цю дату · для всіх відвідувачів. Наступного тижня — основний розклад. Обрані підгрупи замінюються разом.</p>
            <p class="replacement-message" role="status" aria-live="polite"></p>
            <div class="replacement-actions"><button type="submit" class="btn replacement-save">Зберегти для всіх</button><button type="button" class="btn replacement-remove">Скасувати заміну</button><button type="button" class="btn replacement-cancel">Закрити</button></div>
        </form>`;
    document.body.append(dialog);
    const form = dialog.querySelector('form'), search = dialog.querySelector('.replacement-search');
    const choiceList = dialog.querySelector('.replacement-choices');
    const selection = dialog.querySelector('.replacement-selection');
    const message = dialog.querySelector('.replacement-message');
    const remove = dialog.querySelector('.replacement-remove');
    let choices = [], selectedIndex = -1;

    function syncToolbar() {
        editToggle.hidden = !admin;
        editToggle.disabled = !ready || stale || busy;
        editToggle.textContent = editMode ? 'Завершити редагування' : 'Редагувати розклад';
        editToggle.setAttribute('aria-pressed', String(editMode));
    }

    function filterChoices() {
        const query = search.value.trim().toLocaleLowerCase('uk-UA');
        let visible = 0;
        choices.forEach(choice => { choice.node.hidden = !label(choice.lesson).toLocaleLowerCase('uk-UA').includes(query); if (!choice.node.hidden) visible++; });
        dialog.querySelector('.replacement-empty').hidden = visible > 0;
    }

    function choose(index) {
        selectedIndex = index;
        choices.forEach((choice, i) => { choice.radio.checked = i === index; });
        selection.textContent = choices[index] ? label(choices[index].lesson) : 'Оберіть пару зі списку';
        message.textContent = '';
    }

    function paintStatus(text) {
        status.textContent = text || (admin && editMode ? 'Режим редагування · оберіть пару для заміни.' : 'Заміни актуальні · дати й час за Києвом.');
        syncToolbar();
    }
    async function load() {
        if (loading || busy || (document.hidden && !window.studyBackgroundNotifications?.enabled())) return;
        loading = true; refreshButton.disabled = true;
        const epoch = ++generation;
        const current = now(), from = clock.dateKey(clock.dateForDay(1, current));
        const end = new Date(current); end.setDate(end.getDate() + 14);
        try {
            const response = await fetch(`/api/auth/replacements?from=${from}&to=${clock.dateKey(end)}`, {
                credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000)
            });
            if (!response.ok) throw new Error('read_failed');
            const data = await response.json();
            if (!Array.isArray(data.replacements)) throw new Error('read_failed');
            if (epoch !== generation) return;
            const changed = JSON.stringify(records) !== JSON.stringify(data.replacements) || !ready || stale;
            records = data.replacements; ready = true; stale = false;
            suppressedIds = Array.isArray(data.suppressedNotificationIds) ? data.suppressedNotificationIds : [];
            window.studyScheduleNotices?.update(records, suppressedIds);
            paintStatus();
            if (changed) redraw();
        } catch {
            if (epoch !== generation) return;
            stale = true;
            paintStatus(ready ? 'Не вдалося оновити заміни. Показано останні отримані дані — перевірте з’єднання.' : 'Не вдалося перевірити заміни. Показано основний розклад; заміни можуть бути відсутні.');
            redraw();
        } finally {
            loading = false; refreshButton.disabled = false;
        }
    }
    function close() { if (!busy) dialog.close(); }
    function open(date, index) {
        if (!canEdit() || date < clock.dateKey(now())) return;
        const schedule = window.scheduleReplacementView.schedule();
        const current = records.find(item => item.date === date && item.index === index);
        if (!canEditSlot(current)) return;
        editing = { date, index, revision: current?.revision ?? null };
        const parsed = new Date(`${date}T12:00:00`);
        dialog.querySelector('.replacement-date').textContent = `${parsed.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · пара ${index + 1}`;
        const base = clock.lessonAt(schedule, parsed.getDay(), index, clock.weekType(parsed));
        dialog.querySelector('.replacement-base').textContent = base ? label(base) : 'Вікно — пари немає';
        choices = []; choiceList.replaceChildren(); search.value = '';
        const windowNode = document.createElement('label'); windowNode.className = 'replacement-choice';
        const windowRadio = document.createElement('input'); windowRadio.type = 'radio'; windowRadio.name = 'replacement-choice'; windowRadio.value = '0';
        const windowCopy = document.createElement('span'); windowCopy.className = 'replacement-choice-copy';
        const windowTitle = document.createElement('strong'); windowTitle.textContent = 'Вікно';
        const windowDetails = document.createElement('span'); windowDetails.className = 'replacement-choice-details'; windowDetails.textContent = 'Пари не буде лише на обрану дату';
        windowCopy.append(windowTitle, windowDetails); windowNode.append(windowRadio, windowCopy);
        windowRadio.addEventListener('change', () => choose(0));
        choices.push({ source: { kind: 'window' }, lesson: null, node: windowNode, radio: windowRadio });
        choiceList.append(windowNode);
        const seen = new Set();
        for (let day = 1; day <= 5; day++) (schedule[day] || []).forEach((slot, slotIndex) => {
            for (const variant of ['common', 'num', 'den']) {
                const lesson = slot[variant];
                const items = Array.isArray(lesson) ? lesson : [lesson];
                // Debt/make-up sessions stay in the timetable, but are not replacement choices.
                if (!items.length || items.some(item => !item?.s?.trim() || /борги/iu.test(item.note || ''))) continue;
                const text = label(lesson);
                if (seen.has(text)) continue;
                seen.add(text);
                const choiceIndex = choices.length;
                const node = document.createElement('label'); node.className = 'replacement-choice';
                const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'replacement-choice'; radio.value = String(choiceIndex);
                const copy = document.createElement('span'); copy.className = 'replacement-choice-copy';
                const title = document.createElement('strong');
                title.textContent = [...new Set(items.map(item => item.s.trim()))].join(' / ');
                const details = document.createElement('span'); details.className = 'replacement-choice-details';
                details.textContent = items.map(item => [item.g ? `Група ${item.g}` : '', item.t, item.r && item.r !== '-' ? `Ауд. ${item.r}` : '', item.note].filter(Boolean).join(' · ')).join(' / ');
                copy.append(title, details); node.append(radio, copy);
                radio.addEventListener('change', () => choose(choiceIndex));
                choices.push({ source: { day, index: slotIndex, variant }, lesson, node, radio });
                choiceList.append(node);
            }
        });
        const selected = current ? choices.findIndex(choice => label(choice.lesson) === label(current.lesson)) : -1;
        choose(selected); filterChoices();
        remove.hidden = !current || !rights.cancelReplacements;
        const maySave = current ? rights.editReplacements : rights.createReplacements;
        dialog.querySelector('.replacement-save').hidden = !maySave;
        dialog.querySelector('.replacement-picker').hidden = !maySave;
        message.textContent = '';
        dialog.showModal(); if (maySave) search.focus(); else remove.focus();
    }
    async function save(operation) {
        if (busy || !editing || !canEdit()) return;
        const needed = operation === 'remove' ? 'cancelReplacements' : editing.revision === null ? 'createReplacements' : 'editReplacements';
        if (!rights[needed]) return;
        const choice = choices[selectedIndex];
        if (operation === 'set' && !choice) { message.textContent = 'Оберіть нову пару перед збереженням.'; search.focus(); return; }
        busy = true; generation++;
        form.querySelectorAll('button, input').forEach(node => { node.disabled = true; });
        message.textContent = 'Зберігаємо…';
        try {
            const result = await auth.changeReplacement({ ...editing, operation, ...(operation === 'set' ? { source: choice.source } : {}) });
            records = records.filter(item => item.date !== result.date || item.index !== result.index);
            if (result.replacement) records.push(result.replacement);
            if (result.notificationId) suppressedIds.push(result.notificationId);
            window.studyScheduleNotices?.update(records, suppressedIds);
            redraw();
            dialog.close();
            paintStatus(operation === 'set' ? 'Заміну збережено для всіх лише на вибрану дату.' : 'Заміну скасовано. Відновлено основну пару.');
        } catch (error) {
            message.textContent = auth.errorMessage(error);
        } finally {
            busy = false;
            form.querySelectorAll('button, input').forEach(node => { node.disabled = false; });
            syncToolbar();
        }
    }
    form.addEventListener('submit', event => { event.preventDefault(); save('set'); });
    search.addEventListener('input', filterChoices);
    remove.addEventListener('click', () => save('remove'));
    dialog.querySelector('.replacement-close').addEventListener('click', close);
    dialog.querySelector('.replacement-cancel').addEventListener('click', close);
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('close', () => { editing = null; });
    grid.addEventListener('click', event => {
        const button = event.target.closest('[data-replacement-date]');
        if (button && grid.contains(button)) open(button.dataset.replacementDate, Number(button.dataset.replacementIndex));
    });
    auth?.subscribe(session => {
        const nextRights = readRights(session);
        const changed = admin !== Boolean(session.scheduleAdmin) || JSON.stringify(rights) !== JSON.stringify(nextRights);
        admin = Boolean(session.scheduleAdmin);
        rights = nextRights;
        if (!admin) editMode = false;
        if (changed && dialog.open) dialog.close();
        syncToolbar();
        if (changed) { redraw(); if (ready && !stale) paintStatus(); }
    });
    refreshButton.addEventListener('click', load);
    editToggle.addEventListener('click', () => {
        if (!admin || !ready || stale || busy) return;
        editMode = !editMode; paintStatus(); redraw();
    });
    function resume() { clearInterval(timer); if (!document.hidden || window.studyBackgroundNotifications?.enabled()) { load(); timer = setInterval(load, 60000); } }
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('study-background-notifications-change', resume);
    window.addEventListener('pagehide', () => { clearInterval(timer); generation++; });
    window.addEventListener('pageshow', resume);
    window.studyReplacements = { entries, canEdit, canEditSlot };
    syncToolbar();
    resume();
})();
