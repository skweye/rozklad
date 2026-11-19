/* Shared, non-modal settings panel. */
(() => {
    'use strict';
    const trigger = document.querySelector('[data-settings-trigger]');
    const panel = trigger && document.getElementById(trigger.getAttribute('aria-controls'));
    if (!panel) return;
    const close = panel.querySelector('[data-settings-close]');
    const isOpen = () => panel.classList.contains('active');

    function setOpen(open) {
        trigger.classList.toggle('active', open);
        panel.classList.toggle('active', open);
        trigger.setAttribute('aria-expanded', String(open));
        panel.setAttribute('aria-hidden', String(!open));
        panel.inert = !open;
    }

    function dismiss() {
        trigger.focus({ preventScroll: true });
        setOpen(false);
    }

    trigger.addEventListener('click', () => {
        if (isOpen()) { dismiss(); return; }
        setOpen(true);
        close?.focus();
    });
    close?.addEventListener('click', dismiss);
    const dismissOutside = event => {
        if (isOpen() && !panel.contains(event.target) && !trigger.contains(event.target)) setOpen(false);
    };
    document.addEventListener('click', dismissOutside);
    document.addEventListener('focusin', dismissOutside);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && isOpen() && !event.defaultPrevented) dismiss();
    });
    window.addEventListener('pagehide', () => setOpen(false));
})();
