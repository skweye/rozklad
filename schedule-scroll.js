(() => {
    'use strict';

    const header = document.querySelector('body > header');
    const dock = document.querySelector('.week-dock');
    const navigation = document.querySelector('.schedule-day-navigation');
    const grid = document.getElementById('scheduleGrid');
    if (!header || !dock || !navigation || !grid) return;

    const pane = dock.parentElement;
    const links = [...navigation.querySelectorAll('a[href^="#"]')];
    const scene = dock.querySelector('.week-scene');
    const sceneCopy = scene.querySelector('.week-scene-copy');
    const sceneDay = scene.querySelector('.week-scene-day');
    const sceneDate = scene.querySelector('.week-scene-date');
    const sceneNumber = scene.querySelector('.week-scene-number');
    const sceneMonth = scene.querySelector('.week-scene-month');
    const lessonIndex = dock.querySelector('.week-lesson-index');
    const lessonLinks = lessonIndex.querySelector('.week-lesson-links');
    const dateFormat = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long', timeZone: 'UTC' });
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let days = [];
    let activeDay = null;
    let shownDay;
    let sceneAnimation;
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

    function showDay(day) {
        if (shownDay === day) return;
        const dayChanged = shownDay && day && shownDay.link !== day.link;
        shownDay = day;
        scene.hidden = !day;
        lessonIndex.hidden = !day?.lessons.length;
        sceneAnimation?.cancel();
        if (!day) return;

        scene.dataset.weekDay = String(day.number);
        sceneDay.textContent = day.name;
        sceneDate.dateTime = day.date;
        sceneNumber.textContent = day.dateParts.find(part => part.type === 'day').value;
        sceneMonth.textContent = day.dateParts.find(part => part.type === 'month').value;
        lessonLinks.replaceChildren(...day.lessons.map(lesson => {
            const link = document.createElement('a');
            link.href = `#${lesson.id}`;
            link.textContent = lesson.start;
            link.setAttribute('aria-label', lesson.hours);
            return link;
        }));

        if (dayChanged && scene.offsetWidth && !reduceMotion.matches && document.body.dataset.lowPower !== 'true') {
            sceneAnimation = sceneCopy.animate(
                [{ opacity: .25, translate: '0 14px' }, { opacity: 1, translate: '0 0' }],
                { duration: 320, easing: 'cubic-bezier(.2,.75,.2,1)' }
            );
        }
    }

    function update() {
        frame = 0;
        const viewportHeight = document.documentElement.clientHeight;
        const week = grid.getBoundingClientRect();

        // The bar is full once the end of the last day is in view.
        const visibleHeight = Math.max(0, viewportHeight - readingLine - 24);
        const distance = Math.max(1, week.height - visibleHeight);
        const progress = Math.min(1, Math.max(0, (readingLine - week.top) / distance));
        dock.style.setProperty('--week-progress', days.length ? progress : 0);

        if (!days.length || week.top >= viewportHeight || week.bottom <= readingLine) {
            setActiveDay(null);
            showDay(week.bottom <= readingLine ? days.at(-1) : days[0]);
            return;
        }
        const nextIndex = days.findIndex(({ card }) => card.getBoundingClientRect().top > readingLine);
        const atDocumentEnd = window.scrollY + viewportHeight >= document.documentElement.scrollHeight - 2;
        const index = nextIndex === -1 || (progress === 1 && atDocumentEnd) ? days.length - 1 : Math.max(0, nextIndex - 1);
        setActiveDay(days[index]);
        showDay(days[index]);
    }

    function requestUpdate() {
        if (!frame) frame = requestAnimationFrame(update);
    }

    function measureDock() {
        const top = header.offsetHeight + 8;
        pane.style.setProperty('--schedule-dock-top', `${top}px`);
        pane.style.setProperty('--schedule-dock-height', `${dock.offsetHeight}px`);
        const dockTop = parseFloat(getComputedStyle(dock).top);
        readingLine = dockTop + dock.offsetHeight + 18;
        requestUpdate();
    }

    function collectDays() {
        days = links.flatMap((link, index) => {
            const card = document.getElementById(link.hash.slice(1));
            if (!card || !grid.contains(card)) return [];
            const date = card.querySelector('.day-date').dateTime;
            const lessons = [...card.querySelectorAll('.lesson-item[id] .lesson-hours[data-start]')].map(hours => ({
                id: hours.closest('.lesson-item').id,
                start: hours.dataset.start,
                hours: hours.textContent.trim()
            }));
            return [{ link, card, date, lessons, number: index + 1, name: card.querySelector('.day-name').textContent.trim(), dateParts: dateFormat.formatToParts(new Date(date)) }];
        });
        requestUpdate();
    }

    // Schedule updates replace the cards, including when a replacement is refreshed.
    new MutationObserver(collectDays).observe(grid, { childList: true });
    if ('ResizeObserver' in window) {
        const resize = new ResizeObserver(measureDock);
        resize.observe(header);
        resize.observe(grid);
        resize.observe(dock);
    }
    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', measureDock);
    window.addEventListener('pageshow', measureDock);
    measureDock();
    collectDays();
})();
