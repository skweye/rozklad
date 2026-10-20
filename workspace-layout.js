/* Presentation-only views. Existing schedule, Classroom and auth nodes stay mounted. */
(() => {
    'use strict';
    const workspace = document.querySelector('[data-workspace-views]');
    if (!workspace) return;
    const navigation = workspace.querySelector('.workspace-view-navigation');
    const links = [...navigation.querySelectorAll('[data-workspace-view]')];
    const panels = links.map(link => document.getElementById(link.dataset.workspaceView));
    if (panels.some(panel => !panel)) return;
    navigation.setAttribute('role', 'tablist');
    links.forEach((link, index) => {
        link.id = `workspaceTab${index}`;
        link.setAttribute('role', 'tab');
        link.setAttribute('aria-controls', panels[index].id);
        panels[index].setAttribute('role', 'tabpanel');
        panels[index].setAttribute('aria-labelledby', link.id);
        panels[index].tabIndex = 0;
    });
    function select(index) {
        links.forEach((link, i) => {
            link.setAttribute('aria-selected', String(i === index));
            link.tabIndex = i === index ? 0 : -1;
            panels[i].hidden = i !== index;
        });
    }
    function fromHash() {
        if (!location.hash) { select(0); return 0; }
        const target = document.getElementById(location.hash.slice(1));
        const index = panels.findIndex(panel => panel === target || (target && panel.contains(target)));
        if (index >= 0) select(index);
        return index;
    }
    links.forEach((link, index) => {
        link.addEventListener('click', () => select(index));
        link.addEventListener('keydown', event => {
            let next;
            if (event.key === 'ArrowRight') next = (index + 1) % links.length;
            else if (event.key === 'ArrowLeft') next = (index + links.length - 1) % links.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = links.length - 1;
            else return;
            event.preventDefault();
            links[next].focus();
            links[next].click();
        });
    });
    // Reveal before the browser scrolls to a cross-section anchor.
    document.addEventListener('click', event => {
        const anchor = event.target.closest?.('a[href^="#"]');
        if (!anchor) return;
        const target = document.getElementById(anchor.getAttribute('href').slice(1));
        const index = panels.findIndex(panel => panel === target || (target && panel.contains(target)));
        if (index >= 0) select(index);
    });
    select(0);
    fromHash();
    window.addEventListener('hashchange', fromHash);
    window.addEventListener('pageshow', fromHash);
})();
