/* Visible-tab presence only; private online lists live exclusively on /admin/. */
(() => {
    'use strict';
    const auth = window.studyAuth;
    if (!auth) return;
    const page = ['schedule', 'reports', 'admin'].includes(document.body.dataset.app) ? document.body.dataset.app : 'schedule';
    let busy = false, timer, stopped = false, account;
    async function heartbeat() {
        if (busy || document.hidden || stopped) return;
        busy = true;
        try { await auth.sendPresence(page); } catch { /* A presence outage must not interrupt studying. */ }
        finally { busy = false; }
    }
    function resume() {
        clearInterval(timer);
        if (document.hidden || stopped) return;
        heartbeat(); timer = setInterval(heartbeat, 45000);
    }
    auth.subscribe(session => {
        const next = session?.user?.id || '';
        if (next !== account) { account = next; heartbeat(); }
    });
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pagehide', () => { stopped = true; clearInterval(timer); });
    window.addEventListener('pageshow', () => { stopped = false; resume(); });
    resume();
})();
