import { randomUUID } from 'node:crypto';

const DAY = 86400000;
const notificationId = entry => `${entry.date}/${entry.index}@${entry.removed ? `removed:${entry.removedRevision}` : entry.revision}`;
const publicReplacement = entry => Object.fromEntries(['date', 'index', 'lesson', 'source', 'revision', 'updatedAt'].filter(key => key in entry).map(key => [key, entry[key]]));
const invalid = () => { throw new Error('replacement_invalid'); };
function dateStamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid();
    const stamp = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== value) return invalid();
    return stamp;
}
function todayStamp(now) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
    const part = name => parts.find(item => item.type === name).value;
    return dateStamp(`${part('year')}-${part('month')}-${part('day')}`);
}
function selectLesson(schedule, source) {
    // A window is an explicit date-scoped replacement, not removal of a replacement.
    if (source?.kind === 'window' && Object.keys(source).length === 1) return null;
    if (source?.kind !== undefined) return invalid();
    if (!source || !Number.isInteger(source.day) || source.day < 1 || source.day > 5 ||
        !Number.isInteger(source.index) || source.index < 0 || source.index > 4 ||
        !['common', 'num', 'den'].includes(source.variant)) return invalid();
    const lesson = schedule[source.day]?.[source.index]?.[source.variant];
    const items = Array.isArray(lesson) ? lesson : [lesson];
    if (!items.length || items.some(item => !item?.s?.trim())) return invalid();
    // Copy only public display data from the trusted base schedule, never client HTML or URLs.
    const clean = item => Object.fromEntries(['s', 't', 'r', 'g', 'note'].filter(key => typeof item[key] === 'string').map(key => [key, item[key]]));
    return Array.isArray(lesson) ? items.map(clean) : clean(lesson);
}

export function createReplacementService({ getStore, schedule, now = () => Date.now() }) {
    return {
        async list(from, to, viewerKey = null) {
            const start = dateStamp(from), end = dateStamp(to), today = todayStamp(now());
            if (end < start || end - start > 31 * DAY || start < today - 7 * DAY || end > today + 366 * DAY) return invalid();
            const months = new Set();
            for (let stamp = start; stamp <= end; stamp += DAY) months.add(new Date(stamp).toISOString().slice(0, 7));
            const store = getStore();
            const pages = await Promise.all([...months].map(month => store.get(month, { type: 'json' })));
            const rows = pages.flatMap(page => Object.values(page || {})).filter(item => item.date >= from && item.date <= to);
            return {
                replacements: rows.filter(item => !item.removed).map(publicReplacement),
                suppressedNotificationIds: rows.filter(item => viewerKey && item._actor === viewerKey).map(notificationId)
            };
        },
        async change(body, actorKey = null) {
            const stamp = dateStamp(body?.date), today = todayStamp(now());
            const day = new Date(stamp).getUTCDay();
            if (stamp < today || stamp > today + 365 * DAY || day === 0 || day === 6 ||
                !Number.isInteger(body.index) || body.index < 0 || body.index > 4 ||
                !['set', 'remove'].includes(body.operation) ||
                !(body.revision === null || (typeof body.revision === 'string' && body.revision.length <= 64))) return invalid();
            const lesson = body.operation === 'set' ? selectLesson(schedule, body.source) : null;
            const store = getStore(), month = body.date.slice(0, 7), key = `${body.date}/${body.index}`;
            // Compare-and-swap protects other pairs and prevents stale tabs overwriting a newer edit.
            for (let attempt = 0; attempt < 3; attempt++) {
                const saved = await store.getWithMetadata(month, { type: 'json' });
                const data = { ...(saved?.data || {}) };
                const active = data[key]?.removed ? null : data[key];
                if ((active?.revision ?? null) !== body.revision) throw new Error('replacement_conflict');
                if (body.operation === 'remove' && !active) return { replacement: null, date: body.date, index: body.index, notificationId: null };
                const common = { date: body.date, index: body.index, revision: randomUUID(), updatedAt: new Date(now()).toISOString(), _actor: actorKey };
                const replacement = body.operation === 'set' ? { ...common, lesson, source: body.source.kind === 'window' ? { kind: 'window' } : { day: body.source.day, index: body.source.index, variant: body.source.variant } } : null;
                // Keep only a cancellation marker so the cancelling admin is quiet in other tabs/devices too.
                data[key] = replacement || { ...common, removed: true, removedRevision: active.revision };
                const result = await store.setJSON(month, data, saved ? { onlyIfMatch: saved.etag } : { onlyIfNew: true });
                if (result.modified) return { replacement: replacement ? publicReplacement(replacement) : null, date: body.date, index: body.index, notificationId: notificationId(data[key]) };
            }
            throw new Error('replacement_conflict');
        }
    };
}
