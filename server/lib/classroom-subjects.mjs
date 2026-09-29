// Exact course/topic IDs from the subject links supplied for this timetable.
// No extra OAuth scope or guessed subject based on a work's title is needed.
const courseId = '876536762480';
const subjects = new Map([
    ['886155429933', 'Виховна година'],
    ['877914169077', 'Дискретна математика'],
    ['877865093829', 'Операційні системи'],
    ['877604404996', 'Фізичне виховання'],
    ['826148783033', 'Іноземна мова (Мормуль)'],
    ['877287724918', 'Об’єктно-орієнтоване програмування'],
    ['877032829612', 'Arduino'],
    ['876788317170', 'Бази даних'],
    ['876669879582', 'Алгоритми та структури даних'],
    ['877571148764', 'Іноземна мова (Донець)']
]);

export function subjectForWork(course, work) {
    if (String(course.id) === courseId) return subjects.get(String(work.topicId)) || '';
    return String(course.name || '').slice(0, 300);
}
