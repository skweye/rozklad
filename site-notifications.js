/* Shared opt-in preferences. No browser permission is requested by this module. */
(() => {
    'use strict';
    const prefix = 'study-notification-';
    const labels = {
        replacements: 'Заміни в розкладі — на сайті',
        lessonStart: 'Початок пари',
        lessonEnd: 'Завершення пари',
        nextLesson: 'Нагадування про наступну пару',
        announcements: 'Оголошення',
        success: 'Повідомлення про успішні дії',
        sound: 'Звук сповіщень'
    };
    const key = kind => `${prefix}${kind}-v1`;
    const read = kind => { try { return localStorage.getItem(key(kind)) === 'true'; } catch { return false; } };
    const state = Object.fromEntries(Object.keys(labels).map(kind => [kind, read(kind)]));
    const controls = new Map();
    let status;
    const enabled = kind => state[kind] === true;
    function changed() {
        for (const [kind, input] of controls) input.checked = enabled(kind);
        window.dispatchEvent(new Event('study-notifications-change'));
    }
    function set(kind, value) {
        if (!Object.hasOwn(labels, kind)) return;
        state[kind] = value === true;
        if (status) status.textContent = '';
        try { localStorage.setItem(key(kind), String(state[kind])); }
        catch { if (status) status.textContent = 'Налаштування діє лише в цій вкладці: браузер не дозволив збереження.'; }
        changed();
    }
    function init() {
        const appearance = document.querySelector('[data-appearance-settings]');
        if (!appearance) return;
        const section = document.createElement('fieldset');
        section.className = 'appearance-section notification-settings';
        section.setAttribute('data-notification-settings', '');
        const legend = document.createElement('legend'); legend.textContent = 'Сповіщення';
        const hint = document.createElement('p'); hint.className = 'appearance-hint';
        hint.textContent = 'За замовчуванням усе вимкнено. Вибір спільний для розкладу, звітів і адмін-панелі в цьому браузері. Нагадування — за 10 хв до першої пари та за 5 хв до наступних. Помилки та підтвердження видалення залишаються видимими.';
        section.append(legend, hint);
        for (const [kind, text] of Object.entries(labels)) {
            const label = document.createElement('label'); label.className = 'notification-setting';
            const span = document.createElement('span'); span.textContent = text;
            const input = document.createElement('input'); input.type = 'checkbox';
            input.checked = enabled(kind); input.setAttribute('data-notification-kind', kind);
            input.addEventListener('change', () => set(kind, input.checked));
            controls.set(kind, input); label.append(span, input); section.append(label);
        }
        status = document.createElement('p'); status.className = 'appearance-notice'; status.setAttribute('role', 'status');
        const disableAll = document.createElement('button'); disableAll.type = 'button'; disableAll.textContent = 'Вимкнути всі сповіщення';
        disableAll.addEventListener('click', () => {
            for (const kind of Object.keys(labels)) set(kind, false);
            window.studyBackgroundNotifications?.disable();
        });
        section.append(disableAll);
        section.append(status); appearance.insertAdjacentElement('afterend', section);
    }
    window.studyNotifications = { enabled, set };
    window.addEventListener('storage', event => {
        if (event.key !== null && !Object.keys(labels).some(kind => event.key === key(kind))) return;
        for (const kind of Object.keys(labels)) state[kind] = read(kind);
        changed();
    });
    window.addEventListener('pageshow', () => { for (const kind of Object.keys(labels)) state[kind] = read(kind); changed(); });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
