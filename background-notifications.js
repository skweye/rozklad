/* Opt-in system notifications while a page is open. No Push API or server subscription. */
(() => {
    'use strict';
    const preferenceKey = 'study-background-notifications-v2';
    const deliveredKey = 'study-background-notifications-delivered-v1';
    const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
    const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* session-only fallback */ } };
    const supported = window.isSecureContext && 'Notification' in window && 'serviceWorker' in navigator;
    let optedIn = read(preferenceKey) === 'true', working = false, registrationPromise;
    const memoryDelivered = new Set();
    const inFlight = new Set();
    const enabled = () => Boolean(supported && optedIn && Notification.permission === 'granted');
    const section = document.createElement('fieldset'); section.className = 'appearance-section background-notification-settings';
    const legend = document.createElement('legend'); legend.textContent = 'Фонові сповіщення';
    const button = document.createElement('button'); button.type = 'button';
    const hint = document.createElement('p'); hint.className = 'appearance-hint'; hint.setAttribute('role', 'status');
    section.append(legend, button, hint);
    const mount = () => (document.querySelector('[data-notification-settings]') || document.querySelector('[data-appearance-settings]'))?.append(section);
    if (document.readyState === 'loading' || document.readyState === 'interactive') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
    function paint(message) {
        button.disabled = !supported || working;
        button.textContent = working ? 'Підключаємо…' : enabled() ? 'Вимкнути фонові сповіщення' : 'Увімкнути фонові сповіщення';
        button.setAttribute('aria-pressed', String(enabled()));
        hint.textContent = message || (!supported ? 'Цей браузер не підтримує системні сповіщення. Відкрийте сайт через HTTPS у підтримуваному браузері.' : Notification.permission === 'denied' ? 'Сповіщення заблоковано. Дозвольте їх у налаштуваннях цього сайту в браузері.' : enabled() ? 'Увімкнено для відкритої фонової вкладки. Закрита або призупинена браузером вкладка не перевіряє зміни. Звук залежить від налаштувань системи.' : 'Отримуйте сповіщення про заміни, коли вкладка відкрита у фоні. Браузер може затримувати перевірки. Після закриття вкладки сповіщень не буде.');
    }
    function changed() { paint(); window.dispatchEvent(new Event('study-background-notifications-change')); }
    async function registration() {
        if (!registrationPromise) registrationPromise = (async () => {
            await navigator.serviceWorker.register('/schedule-notification-sw.js', { scope: '/' });
            let timeout;
            try {
                return await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('worker_timeout')), 15000); })]);
            } finally { clearTimeout(timeout); }
        })().catch(error => { registrationPromise = null; throw error; });
        return registrationPromise;
    }
    button.addEventListener('click', async () => {
        if (!supported || working) return;
        if (optedIn) { optedIn = false; write(preferenceKey, 'false'); changed(); return; }
        working = true; paint();
        try {
            // Permission is requested synchronously from this explicit user click only.
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') { optedIn = false; write(preferenceKey, 'false'); working = false; changed(); return; }
            await registration();
            optedIn = true; write(preferenceKey, 'true');
        } catch {
            optedIn = false; write(preferenceKey, 'false');
            working = false; changed(); paint('Не вдалося підключити сповіщення. Перевірте інтернет і повторіть спробу.'); return;
        } finally { working = false; }
        changed();
    });
    function delivered() {
        try { const data = JSON.parse(read(deliveredKey) || '[]'); return new Set([...memoryDelivered, ...(Array.isArray(data) ? data.filter(id => typeof id === 'string') : [])].slice(-256)); }
        catch { return new Set(memoryDelivered); }
    }
    async function show(notices) {
        if (!enabled() || !document.hidden || !notices.length) return;
        const send = async () => {
            const sent = delivered();
            const pending = notices.filter(item => !sent.has(item.id) && !inFlight.has(item.id) && window.studyScheduleNotices?.shouldNotify(item.id) !== false);
            if (!pending.length) return;
            pending.forEach(item => inFlight.add(item.id));
            try {
                const worker = await registration();
                for (const item of pending) {
                    if (!enabled() || !document.hidden) break;
                    if (window.studyScheduleNotices?.shouldNotify(item.id) === false) continue;
                    const subjects = !item.lesson ? 'Вікно — пари немає' : [...new Set((Array.isArray(item.lesson) ? item.lesson : [item.lesson]).filter(Boolean).map(lesson => lesson.s))].join(' / ');
                    await worker.showNotification(item.removed ? 'Заміну скасовано' : 'Заміна в розкладі', {
                        body: `${item.date} · ${item.index + 1} пара\n${item.removed ? 'Діє основний розклад' : subjects}`,
                        icon: '/icon.png', tag: `study-schedule-${item.date}-${item.index}`, renotify: false,
                        silent: !window.studyNotifications?.enabled('sound'),
                        data: { url: '/index.html#weeklySchedule' }
                    });
                    sent.add(item.id); memoryDelivered.add(item.id);
                    while (memoryDelivered.size > 256) memoryDelivered.delete(memoryDelivered.values().next().value);
                    write(deliveredKey, JSON.stringify([...sent].slice(-256)));
                }
            } catch { paint('Не вдалося показати системне сповіщення. Перевірте дозволи браузера. Зміни залишаються на сайті.'); }
            finally { pending.forEach(item => inFlight.delete(item.id)); }
        };
        // Serialize multiple schedule/report tabs; fallback tags replace duplicates without re-alerting.
        try { if (navigator.locks?.request) await navigator.locks.request('study-schedule-notification-delivery', send); else await send(); }
        catch { /* In-page notifications remain available if system delivery fails. */ }
    }
    window.addEventListener('storage', event => { if (event.key === preferenceKey || event.key === null) { optedIn = read(preferenceKey) === 'true'; changed(); } });
    window.addEventListener('pageshow', () => { mount(); optedIn = read(preferenceKey) === 'true'; changed(); });
    window.addEventListener('focus', () => changed());
    window.studyBackgroundNotifications = { enabled, show };
    paint();
})();
