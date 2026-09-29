/* Same floating settings surface as the schedule and reports. */
(() => {
    'use strict';
    const fab = document.getElementById('adminSettingsFab');
    const menu = document.getElementById('adminSettingsMenu');
    if (!fab || !menu) return;
    function setOpen(open, restoreFocus = false) {
        fab.classList.toggle('active', open);
        menu.classList.toggle('active', open);
        fab.setAttribute('aria-expanded', String(open));
        menu.setAttribute('aria-hidden', String(!open));
        menu.inert = !open;
        if (restoreFocus) fab.focus();
    }
    fab.addEventListener('click', () => {
        const open = !menu.classList.contains('active');
        setOpen(open);
        if (open) menu.querySelector('button, input, select')?.focus();
    });
    document.addEventListener('click', event => {
        if (!menu.contains(event.target) && !fab.contains(event.target)) setOpen(false);
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && menu.classList.contains('active')) setOpen(false, true);
    });
    document.addEventListener('focusin', event => {
        if (!menu.contains(event.target) && !fab.contains(event.target)) setOpen(false);
    });
    const test = document.getElementById('adminTestSound'), status = document.getElementById('adminSoundStatus');
    const sound = new Audio('/sound.mp3');
    test.addEventListener('click', async () => {
        if (test.disabled) return;
        test.disabled = true; status.textContent = '';
        try { sound.currentTime = 0; await sound.play(); }
        catch { status.textContent = 'Не вдалося відтворити звук. Перевірте дозвіл браузера та спробуйте ще раз.'; }
        finally { test.disabled = false; }
    });
    window.addEventListener('pagehide', () => { setOpen(false); sound.pause(); });
})();
