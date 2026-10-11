/* Navigation only: report data, templates, persistence and export stay in the editor. */
(() => {
    'use strict';
    const sections = [...document.querySelectorAll('.studio-section')];
    const steps = [...document.querySelectorAll('.report-steps a')];
    function mark(section) {
        for (const link of steps) {
            if (link.getAttribute('href') === `#${section.id}`) link.setAttribute('aria-current', 'step');
            else link.removeAttribute('aria-current');
        }
    }
    function reveal(hash, focus = false) {
        const section = sections.find(item => `#${item.id}` === hash);
        if (!section) return;
        section.open = true;
        mark(section);
        section.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        if (focus) section.querySelector('summary').focus({ preventScroll: true });
    }
    for (const link of document.querySelectorAll('.report-steps a, .studio-navigation a, .studio-skip')) {
        link.addEventListener('click', event => {
            const hash = link.getAttribute('href');
            if (!sections.some(section => `#${section.id}` === hash)) return;
            event.preventDefault(); reveal(hash, true);
        });
    }
    for (const section of sections) {
        section.addEventListener('toggle', () => { if (section.open) mark(section); });
        section.addEventListener('focusin', () => mark(section));
    }
    const initial = sections.find(section => section.open);
    if (initial) mark(initial);
    if (location.hash) reveal(location.hash);
    window.addEventListener('hashchange', () => reveal(location.hash));
    const help = document.getElementById('studioHelpDialog');
    document.getElementById('btnStudioHelp').addEventListener('click', () => help.showModal());
    document.getElementById('btnCloseStudioHelp').addEventListener('click', () => help.close());
})();
