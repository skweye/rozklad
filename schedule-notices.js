/* In-site notices for everyone; no Google login or browser push permission required. */
(() => {
    'use strict';
    const clock = window.studyScheduleTime;
    const storageKey = 'study-schedule-notices-seen-v1';
    let previous = new Map(), pending = new Map(), suppressed = new Set(), timer, loading = false;
    const shouldNotify = id => !suppressed.has(id) && !seen.has(id);
    function readSeen() {
        try { const value = JSON.parse(localStorage.getItem(storageKey) || '[]'); return new Set(Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(-256) : []); }
        catch { return new Set(); }
    }
    let seen = readSeen();
    const root = document.createElement('section'); root.className = 'schedule-notices'; root.hidden = true;
    const hasPopover = typeof root.showPopover === 'function';
    if (hasPopover) root.setAttribute('popover', 'manual');
    root.setAttribute('aria-label', 'Сповіщення про зміни розкладу');
    const heading = document.createElement('div'); heading.className = 'schedule-notices-heading';
    const announcement = document.createElement('p'); announcement.className = 'schedule-notices-title'; announcement.setAttribute('role', 'status'); announcement.setAttribute('aria-live', 'polite');
    const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.className = 'btn schedule-notices-dismiss'; dismiss.textContent = 'Зрозуміло';
    heading.append(announcement, dismiss);
    const details = document.createElement('details'); details.open = true;
    const summary = document.createElement('summary'); summary.textContent = 'Переглянути зміни';
    const list = document.createElement('ul'); list.className = 'schedule-notices-list'; details.append(summary, list);
    root.append(heading, details);
    document.body.append(root);
    // A z-index cannot cover a modal dialog. Use the browser's top layer and keep
    // the notice inside the active dialog so its dismissal button is not inert.
    function positionNotice(raise = false) {
        let dialogs;
        try { dialogs = document.querySelectorAll('dialog:modal'); }
        catch { dialogs = document.querySelectorAll('dialog[open]'); }
        const modal = [...dialogs].at(-1);
        const parent = modal || document.body;
        const moved = root.parentElement !== parent;
        if (hasPopover && (root.hidden || moved || raise) && root.matches(':popover-open')) root.hidePopover();
        if (moved) parent.append(root);
        if (hasPopover && !root.hidden && !root.matches(':popover-open')) root.showPopover();
    }
    if (typeof MutationObserver !== 'undefined') {
        new MutationObserver(changes => {
            if (changes.some(change => change.target.tagName === 'DIALOG' || [...change.removedNodes || []].some(node => node.contains?.(root)))) positionNotice(true);
        }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    }
    let audio, playing = false;
    const sounded = new Set();
    function playSound() {
        if (document.hidden || playing) return;
        const batch = [...pending.values()].map(item => item.id).filter(id => shouldNotify(id) && !sounded.has(id));
        if (!batch.length) return;
        try {
            if (!audio) { audio = new Audio('/sound.mp3'); audio.preload = 'none'; audio.volume = 0.6; }
            audio.currentTime = 0; playing = true;
            Promise.resolve(audio.play()).then(() => {
                batch.forEach(id => sounded.add(id));
                while (sounded.size > 256) sounded.delete(sounded.values().next().value);
            }).catch(() => { /* Autoplay blocked: retry only on a user gesture or return to the tab. */ })
                .finally(() => { playing = false; });
        } catch { playing = false; }
    }
    document.addEventListener('click', playSound);
    document.addEventListener('keydown', playSound);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) audio?.pause();
        else { positionNotice(); render(); }
    });
    const today = () => clock.dateKey(clock.schoolNow());
    const key = item => `${item.date}/${item.index}`;
    const title = lesson => !lesson ? 'Вікно — пари немає' : [...new Set((Array.isArray(lesson) ? lesson : [lesson]).filter(Boolean).map(item => item.s))].join(' / ');
    function render() {
        for (const [id, notice] of pending) if (!shouldNotify(notice.id) || notice.date < today()) pending.delete(id);
        const notices = [...pending.values()].sort((a, b) => a.date.localeCompare(b.date) || a.index - b.index);
        root.hidden = !notices.length;
        positionNotice();
        if (!notices.length) { announcement.textContent = ''; audio?.pause(); return; }
        announcement.textContent = notices.length === 1 ? 'Розклад змінено · є нове сповіщення' : `Розклад змінено · нових сповіщень: ${notices.length}`;
        list.replaceChildren();
        for (const notice of notices) {
            const row = document.createElement('li');
            const date = document.createElement('span'); date.className = 'schedule-notice-date';
            date.textContent = `${new Date(`${notice.date}T12:00:00`).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })} · ${notice.index + 1} пара`;
            const text = document.createElement('span');
            text.textContent = notice.removed ? 'Заміну скасовано. Діє основний розклад.' : `Заміна: ${title(notice.lesson)}`;
            row.append(date, text); list.append(row);
        }
        playSound();
        window.studyBackgroundNotifications?.show(notices);
    }
    function update(records, suppressedIds = []) {
        const previouslySuppressed = suppressed;
        suppressed = new Set(Array.isArray(suppressedIds) ? suppressedIds.filter(id => typeof id === 'string') : []);
        const current = new Map(records.filter(item => item.date >= today()).map(item => [key(item), item]));
        let changed = [...pending.values()].some(item => suppressed.has(item.id));
        for (const [id, item] of current) {
            const noticeId = `${id}@${item.revision}`;
            if (suppressed.has(noticeId)) { pending.delete(id); changed = true; continue; }
            if (previous.has(id) && previous.get(id).revision === item.revision && !previouslySuppressed.has(noticeId)) continue;
            pending.set(id, { ...item, id: `${id}@${item.revision}` }); changed = true;
        }
        for (const [id, item] of previous) if (!current.has(id) && item.date >= today()) {
            pending.set(id, { ...item, removed: true, id: `${id}@removed:${item.revision}` }); changed = true;
        }
        previous = current;
        if (changed || [...pending.values()].some(item => item.date < today())) render();
        else window.studyBackgroundNotifications?.show([...pending.values()]);
    }
    dismiss.addEventListener('click', () => {
        seen = new Set([...seen, ...readSeen(), ...[...pending.values()].map(item => item.id)].slice(-256));
        try { localStorage.setItem(storageKey, JSON.stringify([...seen])); } catch { /* keep dismissal in this tab */ }
        render();
    });
    window.addEventListener('storage', event => { if (event.key === storageKey) { seen = readSeen(); render(); } });
    window.studyScheduleNotices = { update, shouldNotify };
    window.addEventListener('study-background-notifications-change', () => render());
    // Schedule already fetches this endpoint for its cards; reports share only the notice feed.
    if (document.body.dataset.app === 'schedule') return;
    async function load() {
        if (loading || (document.hidden && !window.studyBackgroundNotifications?.enabled())) return;
        loading = true;
        const start = clock.schoolNow(), end = new Date(start); end.setDate(end.getDate() + 14);
        try {
            const response = await fetch(`/api/auth/replacements?from=${clock.dateKey(start)}&to=${clock.dateKey(end)}`, { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(15000) });
            if (!response.ok) return;
            const data = await response.json();
            if (Array.isArray(data.replacements)) update(data.replacements, data.suppressedNotificationIds);
        } catch { /* Never interpret a failed read as cancelled replacements. */ }
        finally { loading = false; }
    }
    function resume() { clearInterval(timer); if (!document.hidden || window.studyBackgroundNotifications?.enabled()) { load(); timer = setInterval(load, 60000); } }
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('study-background-notifications-change', resume);
    window.addEventListener('pagehide', () => clearInterval(timer));
    window.addEventListener('pageshow', resume);
    resume();
})();
