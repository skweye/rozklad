/* Native details handles opening and keyboard activation, even without JavaScript. */
(() => {
    const menu = document.querySelector('.site-switcher');
    if (!menu) return;
    const toggle = menu.querySelector('summary');
    document.addEventListener('click', event => {
        if (menu.open && !menu.contains(event.target)) menu.open = false;
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && menu.open) {
            menu.open = false;
            toggle.focus();
        }
    });
    document.addEventListener('focusin', event => {
        if (menu.open && !menu.contains(event.target)) menu.open = false;
    });
})();
