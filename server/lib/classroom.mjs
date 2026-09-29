import { subjectForWork } from './classroom-subjects.mjs';

export const CLASSROOM_SCOPES = [
    'https://www.googleapis.com/auth/classroom.courses.readonly',
    'https://www.googleapis.com/auth/classroom.coursework.me.readonly'
];

export function missingClassroomPermissions(scopes) {
    const granted = new Set(Array.isArray(scopes) ? scopes : []);
    // Google documents both names for reading the student's own coursework/grades.
    // Only accept these explicit read-only variants, never unrelated Classroom scopes.
    const missing = [];
    if (!granted.has(CLASSROOM_SCOPES[0])) missing.push('courses');
    if (!(
        granted.has(CLASSROOM_SCOPES[1]) ||
        granted.has('https://www.googleapis.com/auth/classroom.student-submissions.me.readonly')
    )) missing.push('coursework');
    return missing;
}

export function dueTimestamp(work) {
    const date = work.dueDate;
    if (!date?.year || !date.month || !date.day) return null;
    const time = work.dueTime || {};
    const value = Date.UTC(date.year, date.month - 1, date.day, time.hours || 0, time.minutes || 0, time.seconds || 0);
    return Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function classroomLink(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.hostname === 'classroom.google.com' && !url.username && !url.password ? url.href : null;
    } catch { return null; }
}

export function pendingWork(course, works, submissions) {
    const mine = new Map(submissions.map(item => [item.courseWorkId, item]));
    return works.flatMap(work => {
        const submission = mine.get(work.id);
        if (work.state !== 'PUBLISHED' || !submission) return [];
        const returned = submission.state === 'RETURNED' && submission.assignedGrade == null;
        if (!returned && !['NEW', 'CREATED', 'RECLAIMED_BY_STUDENT'].includes(submission.state)) return [];
        return [{
            id: `${course.id}:${work.id}`, title: String(work.title || 'Без назви').slice(0, 500),
            course: String(course.name || 'Курс').slice(0, 300), due: dueTimestamp(work),
            subject: subjectForWork(course, work),
            url: classroomLink(work.alternateLink), review: returned
        }];
    });
}

export async function loadClassroom(accessToken, { fetcher = fetch, now = Date.now, signal = AbortSignal.timeout(22000) } = {}) {
    let budget = 100;
    let partial = false;
    let skipped = 0;
    const list = async (path, field, parameters) => {
        const items = [];
        let pageToken = '';
        const seen = new Set();
        do {
            if (--budget < 0) { partial = true; break; }
            const url = new URL(`https://classroom.googleapis.com/v1/${path}`);
            url.search = new URLSearchParams({ pageSize: '100', ...parameters, ...(pageToken ? { pageToken } : {}) });
            const response = await fetcher(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal });
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                const disabled = error.error?.details?.some(item => item.reason === 'SERVICE_DISABLED');
                throw new Error(response.status === 401 ? 'classroom_expired' : disabled ? 'classroom_api_disabled' :
                    response.status === 403 ? 'classroom_forbidden' : response.status === 429 ? 'classroom_quota' : 'classroom_unavailable');
            }
            const data = await response.json();
            items.push(...(data[field] || []));
            pageToken = data.nextPageToken || '';
            if (pageToken && seen.has(pageToken)) { partial = true; break; }
            seen.add(pageToken);
        } while (pageToken);
        return items;
    };
    const courses = await list('courses', 'courses', {
        studentId: 'me', courseStates: 'ACTIVE', fields: 'courses(id,name),nextPageToken'
    });
    // Bound fan-out for the function's execution budget; incomplete data is always labelled.
    if (courses.length > 50) partial = true;
    const queue = courses.slice(0, 50);
    const assignments = [];
    let completed = 0;
    let firstError = null;
    const worker = async () => {
        while (queue.length) {
            const course = queue.shift();
            try {
                const path = `courses/${encodeURIComponent(course.id)}/courseWork`;
                const [works, submissions] = await Promise.all([
                    list(path, 'courseWork', { courseWorkStates: 'PUBLISHED', fields: 'courseWork(id,title,topicId,state,dueDate,dueTime,alternateLink),nextPageToken' }),
                    list(`${path}/-/studentSubmissions`, 'studentSubmissions', { userId: 'me', fields: 'studentSubmissions(courseWorkId,state,assignedGrade),nextPageToken' })
                ]);
                assignments.push(...pendingWork(course, works, submissions));
                completed++;
            } catch (error) {
                if (['classroom_expired', 'classroom_api_disabled', 'classroom_quota'].includes(error.message)) throw error;
                firstError ||= error;
                skipped++;
                partial = true;
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
    if (courses.length && !completed) throw firstError || new Error('classroom_unavailable');
    assignments.sort((a, b) => (a.due ? Date.parse(a.due) : Infinity) - (b.due ? Date.parse(b.due) : Infinity) || a.title.localeCompare(b.title));
    return { assignments, partial, skippedCourses: skipped, courseCount: courses.length, updatedAt: new Date(now()).toISOString() };
}
