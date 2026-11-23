(() => {
    'use strict';

    const header = document.querySelector('body > header');
    const dock = document.querySelector('.week-dock');
    const navigation = document.querySelector('.schedule-day-navigation');
    const grid = document.getElementById('scheduleGrid');
    const story = grid?.closest('.week-story');
    const stage = story?.querySelector('.week-stage');
    if (!header || !dock || !navigation || !stage) return;

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
    let stageTop = 0;
    let storyLength = 0;
    let steps = [];
    const clamp = (value, max) => Math.min(max, Math.max(0, value));

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
        const direction = day && shownDay ? Math.sign(day.number - shownDay.number) : 0;
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

        if (direction && scene.offsetWidth && !reduceMotion.matches && document.body.dataset.lowPower !== 'true') {
            sceneAnimation = sceneCopy.animate(
                [{ opacity: .45, translate: `0 ${direction * 6}px`, filter: 'blur(3px)' },
                 { opacity: 1, translate: '0 0', filter: 'none' }],
                { duration: 200, easing: 'ease-out' }
            );
        }
    }

    function updateStory(viewportHeight) {
        const bounds = story.getBoundingClientRect();
        const offset = clamp(stageTop - bounds.top, storyLength);
        const step = steps.findLast(item => offset >= item.start);
        const progress = step.travel ? clamp((offset - step.transitionStart) / step.travel, 1) : 0;
        const blend = progress * progress * (3 - 2 * progress);
        stage.toggleAttribute('data-week-transition', blend > 0 && blend < 1);
        for (const { day, index, start, overflow } of steps) {
            const distance = index - step.index - blend;
            const opacity = 1 - Math.abs(distance);
            day.card.toggleAttribute('data-week-visible', opacity > 0);
            if (opacity <= 0) continue;
            // Read a tall card to the bottom before fading it out.
            const y = distance * 42 - clamp(offset - start, overflow);
            day.card.style.setProperty('--week-day-y', `${y}px`);
            day.card.style.setProperty('--week-day-opacity', opacity);
        }
        dock.style.setProperty('--week-progress', offset / storyLength);
        const day = steps[step.index + Number(blend >= .5)].day;
        setActiveDay(bounds.top < viewportHeight && bounds.bottom > stageTop ? day : null);
        showDay(day);
    }

    function updateStack(viewportHeight) {
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

    function update() {
        frame = 0;
        const viewportHeight = document.documentElement.clientHeight;
        if (steps.length) updateStory(viewportHeight);
        else updateStack(viewportHeight);
    }

    function requestUpdate() {
        if (!frame) frame = requestAnimationFrame(update);
    }

    function measure() {
        const top = header.offsetHeight + 8;
        pane.style.setProperty('--schedule-dock-top', `${top}px`);
        pane.style.setProperty('--schedule-dock-height', `${dock.offsetHeight}px`);
        const dockTop = parseFloat(getComputedStyle(dock).top);
        readingLine = dockTop + dock.offsetHeight + 18;
        stageTop = readingLine - 8;
        const available = document.documentElement.clientHeight - stageTop - 12;
        const enabled = !reduceMotion.matches && document.body.dataset.lowPower !== 'true' &&
            Number.isFinite(available) && available >= 180 && days.length > 1;
        pane.toggleAttribute('data-week-story', enabled);
        steps = [];
        if (enabled) {
            const stageHeight = Math.min(available, Math.max(...days.map(({ card }) => card.offsetHeight)));
            const travel = Math.min(260, Math.max(128, Math.round(stageHeight * .42)));
            let start = 0;
            steps = days.map((day, index) => {
                const overflow = Math.max(0, day.card.offsetHeight - stageHeight);
                const transitionStart = start + overflow + 48;
                const duration = index === days.length - 1 ? 0 : travel;
                const step = { day, index, start, overflow, transitionStart, travel: duration };
                start = transitionStart + duration;
                return step;
            });
            storyLength = start;
            story.style.setProperty('--week-stage-top', `${stageTop}px`);
            story.style.setProperty('--week-stage-height', `${stageHeight}px`);
            story.style.setProperty('--week-story-height', `${stageHeight + storyLength}px`);
        }
        requestUpdate();
    }

    function scrollToTarget(target) {
        const step = steps.find(({ day }) => day.card.contains(target));
        if (!step) return false;
        const depth = target.getBoundingClientRect().top - step.day.card.getBoundingClientRect().top;
        const start = window.scrollY + story.getBoundingClientRect().top - stageTop;
        const top = Math.ceil(start + step.start + clamp(depth - 12, step.overflow));
        window.scrollTo({ top, behavior: 'instant' });
        requestUpdate();
        return true;
    }

    function followHash() {
        const target = document.getElementById(location.hash.slice(1));
        if (target) scrollToTarget(target);
    }

    dock.addEventListener('click', event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = event.target.closest('a[href^="#"]');
        if (!link) return;
        const target = document.getElementById(link.hash.slice(1));
        if (!target || !scrollToTarget(target)) return;
        event.preventDefault();
        if (location.hash !== link.hash) history.pushState(null, '', link.hash);
        target.focus({ preventScroll: true });
    });

    grid.addEventListener('focusin', ({ target }) => {
        const card = target.closest('.day-card');
        if (!steps.length || !card || target === card) return;
        const content = target.getBoundingClientRect();
        const viewport = stage.getBoundingClientRect();
        if (card !== activeDay?.card || content.top < viewport.top || content.bottom > viewport.bottom) {
            scrollToTarget(target);
        }
    });

    const resize = 'ResizeObserver' in window ? new ResizeObserver(measure) : null;
    function collectDays() {
        const firstRender = !days.length;
        for (const { card } of days) resize?.unobserve(card);
        days = links.flatMap((link, index) => {
            const card = document.getElementById(link.hash.slice(1));
            if (!card || !grid.contains(card)) return [];
            resize?.observe(card);
            const date = card.querySelector('.day-date').dateTime;
            const lessons = [...card.querySelectorAll('.lesson-item[id] .lesson-hours[data-start]')].map(hours => ({
                id: hours.closest('.lesson-item').id,
                start: hours.dataset.start,
                hours: hours.textContent.trim()
            }));
            return [{ link, card, date, lessons, number: index + 1, name: card.querySelector('.day-name').textContent.trim(), dateParts: dateFormat.formatToParts(new Date(date)) }];
        });
        if (firstRender && days.length) showDay(days[0]);
        measure();
        if (firstRender && days.length) followHash();
    }

    // Schedule updates replace the cards, including when a replacement is refreshed.
    new MutationObserver(collectDays).observe(grid, { childList: true });
    resize?.observe(header);
    resize?.observe(grid);
    resize?.observe(dock);
    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', measure);
    window.addEventListener('pageshow', measure);
    window.addEventListener('hashchange', followHash);
    reduceMotion.addEventListener('change', () => {
        const card = activeDay?.card;
        sceneAnimation?.cancel();
        measure();
        if (card && !scrollToTarget(card)) card.scrollIntoView({ block: 'start' });
    });
    collectDays();
})();
