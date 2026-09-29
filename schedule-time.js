/* Date-aware timetable helpers shared by the live status and upcoming lesson. */
(() => {
    'use strict';
    // A wall-clock Date for the school timezone, independent of a visitor's device timezone.
    function schoolNow(instant = new Date()) {
        const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
        const part = name => Number(parts.find(item => item.type === name).value);
        return new Date(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
    }
    function weekType(date = new Date()) {
        const start = new Date(date.getFullYear(), 0, 1);
        // Calendar-day arithmetic avoids drift across daylight-saving transitions.
        const days = (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 1)) / 86400000;
        return Math.ceil((days + start.getDay() + 1) / 7) % 2 !== 0 ? 'denominator' : 'numerator';
    }
    function lessonAt(schedule, day, index, week) {
        const slot = schedule[day]?.[index];
        const lesson = slot?.common ?? slot?.[week === 'numerator' ? 'num' : 'den'];
        if (Array.isArray(lesson)) { const valid = lesson.filter(item => item?.s?.trim()); return valid.length ? valid : null; }
        return lesson?.s?.trim() ? lesson : null;
    }
    function dateKey(date = new Date()) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    function dateForDay(day, now = new Date()) {
        const date = new Date(now);
        date.setDate(date.getDate() - ((date.getDay() || 7) - 1) + day - 1);
        date.setHours(0, 0, 0, 0);
        return date;
    }
    function replacementAt(replacements, date, index) {
        const key = dateKey(date);
        return replacements.find(item => item.date === key && item.index === index) || null;
    }
    function effectiveLesson(schedule, date, index, replacements = []) {
        const replacement = replacementAt(replacements, date, index);
        return replacement ? replacement.lesson : lessonAt(schedule, date.getDay(), index, weekType(date));
    }
    function nextLesson(schedule, slots, now = new Date(), replacements = []) {
        for (let offset = 0; offset <= 14; offset++) {
            const date = new Date(now); date.setDate(date.getDate() + offset); date.setHours(0, 0, 0, 0);
            const day = date.getDay(), week = weekType(date);
            if (day === 0 || day === 6) continue;
            for (let index = 0; index < slots.length; index++) {
                const lesson = effectiveLesson(schedule, date, index, replacements);
                const [hours, minutes] = slots[index].start.split(':').map(Number);
                const start = new Date(date); start.setHours(hours, minutes, 0, 0);
                if (lesson && start > now) return { lesson, day, index, week, start: start.getTime(), end: slots[index].end };
            }
        }
        return null;
    }
    window.studyScheduleTime = { weekType, lessonAt, nextLesson, dateKey, dateForDay, replacementAt, effectiveLesson, schoolNow };
})();
