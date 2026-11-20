(() => {
    'use strict';

    const header = document.querySelector('body > header');
    const navigation = document.querySelector('.schedule-day-navigation');
    const grid = document.getElementById('scheduleGrid');
    if (!header || !navigation || !grid) return;

    const links = [...navigation.querySelectorAll('a[href^="#"]')];
    let days = [];
    let activeDay = null;
    let frame = 0;
    let readingLine = 0;

    function setActiveDay(day) {
        if (activeDay === day) return;
        activeDay?.link.removeAttribute('aria-current');
        activeDay?.card.removeAttribute('data-day-in-view');
        day?.link.setAttribute('aria-current', 'location');
        day?.card.setAttribute('data-day-in-view', '');
        activeDay = day;
    }

    function update() {
        frame = 0;
        const viewportHeight = document.documentElement.clientHeight;
        const week = grid.getBoundingClientRect();

        // The bar is full once the end of the last day is in view.
        const visibleHeight = Math.max(0, viewportHeight - readingLine - 24);
        const distance = Math.max(1, week.height - visibleHeight);
        const progress = Math.min(1, Math.max(0, (readingLine - week.top) / distance));
        navigation.style.setProperty('--week-progress', days.length ? progress : 0);

        if (!days.length || week.top >= viewportHeight || week.bottom <= readingLine) {
            setActiveDay(null);
            return;
        }
        const nextIndex = days.findIndex(({ card }) => card.getBoundingClientRect().top > readingLine);
        const index = progress === 1 || nextIndex === -1 ? days.length - 1 : Math.max(0, nextIndex - 1);
        setActiveDay(days[index]);
    }

    function requestUpdate() {
        if (!frame) frame = requestAnimationFrame(update);
    }

    function measureDock() {
        const top = header.offsetHeight + 20;
        const height = navigation.offsetHeight;
        readingLine = top + height + 18;
        const pane = navigation.parentElement;
        pane.style.setProperty('--schedule-dock-top', `${top}px`);
        pane.style.setProperty('--schedule-dock-height', `${height}px`);
        requestUpdate();
    }

    function collectDays() {
        days = links.map(link => ({ link, card: document.getElementById(link.hash.slice(1)) }))
            .filter(({ card }) => card && grid.contains(card));
        requestUpdate();
    }

    // Schedule updates replace the cards, including when a replacement is refreshed.
    new MutationObserver(collectDays).observe(grid, { childList: true });
    if ('ResizeObserver' in window) {
        const resize = new ResizeObserver(measureDock);
        resize.observe(header);
        resize.observe(grid);
        resize.observe(navigation);
    }
    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', measureDock);
    window.addEventListener('pageshow', measureDock);
    measureDock();
    collectDays();
})();
