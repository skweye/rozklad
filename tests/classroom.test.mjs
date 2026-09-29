import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthHandler } from '../server/lib/auth.mjs';
import { loadClassroom, pendingWork, dueTimestamp, CLASSROOM_SCOPES } from '../server/lib/classroom.mjs';

const origin = 'https://study.example';
const env = { AUTH_SITE_ORIGIN: origin, AUTH_SESSION_SECRET: 'classroom-test-secret-01234567890123456789', GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com' };

async function fixture(subject = 'student-id') {
    let now = Date.now(), nonce, info, fail = null, verificationError = null, calls = 0;
    const jar = {};
    const handle = createAuthHandler({ env, now: () => now,
        verifyGoogle: async () => ({ sub: subject, name: 'Student', email: 'student@example.com', email_verified: true, nonce }),
        verifyAccessToken: async () => { if (verificationError) throw verificationError; return info; },
        getClassroom: async token => { calls++; if (fail) throw new Error(fail); assert.equal(token, 'secret-access-token'); return { assignments: [] }; }
    });
    const request = async (action, body, headers = {}) => {
        const result = await handle(new Request(`${origin}/api/auth/${action}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { origin, cookie: Object.values(jar).join('; '), 'content-type': 'application/json', ...headers },
            body: body === undefined ? undefined : JSON.stringify(body)
        }));
        for (const cookie of result.headers.getSetCookie()) {
            const pair = cookie.split(';')[0];
            const name = pair.split('=')[0];
            if (cookie.includes('Max-Age=0')) delete jar[name]; else jar[name] = pair;
        }
        return result;
    };
    const challenge = await (await request('session')).json();
    nonce = challenge.nonce;
    await request('google', { credential: 'id-token' }, { 'x-csrf-token': challenge.csrf });
    const current = await (await request('session')).json();
    info = { aud: env.GOOGLE_CLIENT_ID, sub: subject, scopes: CLASSROOM_SCOPES, expiry_date: now + 3600000 };
    return {
        request, handle, jar, get calls() { return calls; },
        connect: (headers = {}) => request('classroom-connect', { accessToken: 'secret-access-token' }, { 'x-csrf-token': current.csrf, ...headers }),
        configure(value) { info = { ...info, ...value }; },
        verificationFails(error) { verificationError = error; },
        async loginAgain() {
            const challenge = await (await request('session')).json();
            nonce = challenge.nonce;
            return request('google', { credential: 'id-token' }, { 'x-csrf-token': challenge.csrf });
        },
        fail(value) { fail = value; }, advance(seconds) { now += seconds * 1000; }, csrf: current.csrf
    };
}

test('Classroom requires login and stores a short-lived encrypted HttpOnly access cookie', async () => {
    const f = await fixture();
    const anonymous = await f.handle(new Request(`${origin}/api/auth/classroom`));
    assert.equal(anonymous.status, 401);
    assert.equal((await f.request('classroom')).status, 401);
    const response = await f.connect();
    assert.equal(response.status, 200);
    const cookie = response.headers.getSetCookie()[0];
    assert.match(cookie, /HttpOnly; SameSite=Lax; Max-Age=3570; Secure/);
    assert.ok(!cookie.includes('secret-access-token'));
    assert.ok(!Buffer.from(cookie.split(';')[0].split('=')[1], 'base64url').toString().includes('secret-access-token'));
    assert.equal((await (await f.request('session')).json()).classroomConnected, true);
    assert.equal((await f.request('classroom')).status, 200);
    assert.equal(f.calls, 1);
    f.advance(3571);
    assert.equal((await f.request('classroom')).status, 401);
    assert.equal((await (await f.request('session')).json()).classroomConnected, false);
});

test('wrong account/client, missing scope, expired tokens and CSRF are rejected', async () => {
    for (const patch of [{ sub: 'other' }, { aud: 'other' }, { scopes: [] }, { expiry_date: 1 }]) {
        const f = await fixture();
        f.configure(patch);
        assert.ok((await f.connect()).status >= 400);
        assert.equal(f.jar['__Host-study-classroom'], undefined);
    }
    const f = await fixture();
    assert.equal((await f.connect({ 'x-csrf-token': 'bad' })).status, 403);
    assert.equal((await f.connect({ origin: 'https://attacker.example' })).status, 403);
});

test('Google equivalent read-only scope name does not trigger another consent request', async () => {
    const f = await fixture();
    f.configure({ scopes: [CLASSROOM_SCOPES[0], 'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly'] });
    const response = await f.connect();
    assert.equal(response.status, 200);
    assert.equal((await f.request('classroom')).status, 200);
});

test('temporary token verification failure is not labelled expired permission', async () => {
    const f = await fixture();
    f.verificationFails(new Error('Temporary connection failure'));
    const response = await f.connect();
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.error, 'classroom_verification_unavailable');
    assert.equal(body.diagnostic.stage, 'token');
    assert.equal(body.diagnostic.category, 'unknown');
    assert.match(body.diagnostic.id, /^google-/);
});

test('same-account reauthentication preserves the valid Classroom connection', async () => {
    const f = await fixture();
    await f.connect();
    const previous = f.jar['__Host-study-classroom'];
    assert.equal((await (await f.loginAgain()).json()).classroomConnected, true);
    assert.equal(f.jar['__Host-study-classroom'], previous);
    assert.equal((await f.request('classroom')).status, 200);
});

test('Google user_id is accepted as the stable identity but a missing identity is rejected', async () => {
    const f = await fixture();
    f.configure({ sub: undefined, user_id: 'student-id' });
    assert.equal((await f.connect()).status, 200);
    f.configure({ user_id: undefined });
    assert.equal((await f.connect()).status, 403);
});

test('missing permissions are specific and invalid Google tokens still fail closed', async () => {
    const f = await fixture();
    f.configure({ scopes: [CLASSROOM_SCOPES[0]] });
    assert.deepEqual(await (await f.connect()).json(), { error: 'classroom_scope_required', missingPermissions: ['coursework'] });
    f.verificationFails({ response: { status: 400, data: { error: 'invalid_token' } } });
    assert.equal((await f.connect()).status, 401);
});

test('tampered cookies are rejected; logout removes all Classroom access', async () => {
    const f = await fixture();
    await f.connect();
    const original = f.jar['__Host-study-classroom'];
    f.jar['__Host-study-classroom'] = original + 'changed';
    assert.equal((await f.request('classroom')).status, 401);
    f.jar['__Host-study-classroom'] = original;
    assert.equal((await f.request('logout', {}, { 'x-csrf-token': f.csrf })).status, 200);
    assert.equal(f.jar['__Host-study-classroom'], undefined);
    assert.equal((await f.request('classroom')).status, 401);
});

test('revoked access clears cookie and API errors do not expose tokens', async () => {
    const f = await fixture();
    await f.connect();
    f.fail('classroom_expired');
    const response = await f.request('classroom');
    assert.equal(response.status, 401);
    assert.equal(f.jar['__Host-study-classroom'], undefined);
    await f.connect();
    f.fail('secret-access-token internal server details');
    assert.deepEqual(await (await f.request('classroom')).json(), { error: 'classroom_unavailable' });
});

test('an encrypted Classroom cookie from another signed-in account cannot be reused', async () => {
    const first = await fixture('first-student');
    await first.connect();
    const second = await fixture('second-student');
    second.jar['__Host-study-classroom'] = first.jar['__Host-study-classroom'];
    assert.equal((await second.request('classroom')).status, 401);
    assert.equal(second.calls, 0);
    assert.equal((await (await second.request('session')).json()).classroomConnected, false);
});

test('deadlines use UTC; only outstanding or ungraded returned submissions are shown', () => {
    const base = { state: 'PUBLISHED', dueDate: { year: 2026, month: 9, day: 25 }, dueTime: { hours: 12, minutes: 30 } };
    assert.equal(dueTimestamp(base), '2026-09-25T12:30:00.000Z');
    assert.equal(dueTimestamp({}), null);
    const states = ['NEW', 'CREATED', 'TURNED_IN', 'RETURNED', 'RECLAIMED_BY_STUDENT', 'RETURNED'];
    const works = states.map((state, index) => ({ ...base, id: String(index), title: state, alternateLink: index === 0 ? 'javascript:alert(1)' : 'https://classroom.google.com/c/123/a/456' }));
    works.push({ ...base, id: 'not-assigned' }, { ...base, state: 'DRAFT', id: 'draft' });
    const submissions = states.map((state, index) => ({ courseWorkId: String(index), state, ...(index === 5 ? { assignedGrade: 0 } : {}) }));
    submissions.push({ courseWorkId: 'draft', state: 'NEW' });
    const result = pendingWork({ id: 'course', name: '<b>Course</b>' }, works, submissions);
    assert.deepEqual(result.map(item => item.title), ['NEW', 'CREATED', 'RETURNED', 'RECLAIMED_BY_STUDENT']);
    assert.equal(result[0].url, null);
    assert.equal(result[2].review, true);
    assert.equal(result[0].course, '<b>Course</b>');
});

test('API pagination loads all courses, works and own submissions and sorts by due date', async () => {
    const calls = [];
    const fetcher = async (url, options) => {
        calls.push(url);
        assert.equal(options.headers.Authorization, 'Bearer access');
        const second = url.searchParams.get('pageToken') === 'page2';
        if (url.pathname === '/v1/courses') {
            assert.equal(url.searchParams.get('studentId'), 'me');
            assert.equal(url.searchParams.get('courseStates'), 'ACTIVE');
            return Response.json({ courses: [{ id: second ? 'c2' : 'c1', name: 'Course' }], ...(!second ? { nextPageToken: 'page2' } : {}) });
        }
        if (url.pathname.endsWith('/studentSubmissions')) {
            assert.equal(url.searchParams.get('userId'), 'me');
            return Response.json({ studentSubmissions: [{ courseWorkId: second ? 'w2' : 'w1', state: 'NEW' }], ...(!second ? { nextPageToken: 'page2' } : {}) });
        }
        assert.match(url.searchParams.get('fields'), /topicId/);
        assert.doesNotMatch(url.searchParams.get('fields'), /description/);
        return Response.json({ courseWork: [{ id: second ? 'w2' : 'w1', state: 'PUBLISHED', title: 'Work', dueDate: { year: 2026, month: 9, day: second ? 24 : 25 } }], ...(!second ? { nextPageToken: 'page2' } : {}) });
    };
    const result = await loadClassroom('access', { fetcher });
    assert.equal(result.assignments.length, 4);
    assert.equal(result.assignments[0].due, '2026-09-24T00:00:00.000Z');
    assert.equal(result.partial, false);
    assert.equal(calls.length, 10);
});

test('subject comes from the configured topic, not the common group or guessed title', () => {
    const works = [
        { id: '1', state: 'PUBLISHED', title: 'Лабораторна робота №2', topicId: '876788317170', description: '<b>Умова</b>\nДругий рядок' },
        { id: '2', state: 'PUBLISHED', title: 'Inside the computer', topicId: '826148783033' },
        { id: '3', state: 'PUBLISHED', title: 'ООП — невідомий розділ', topicId: 'unknown' }
    ];
    const submissions = works.map(work => ({ courseWorkId: work.id, state: 'NEW' }));
    const result = pendingWork({ id: '876536762480', name: 'ПЗ-24-1/9' }, works, submissions);
    assert.deepEqual(result.map(item => item.subject), ['Бази даних', 'Іноземна мова (Мормуль)', '']);
    assert.equal(result[0].description, undefined);
    assert.equal(pendingWork({ id: 'other', name: 'Дискретна математика' }, works, submissions)[0].subject, 'Дискретна математика');
});

test('partial course access is labelled rather than presented as a complete empty list', async () => {
    const fetcher = async url => {
        if (url.pathname === '/v1/courses') return Response.json({ courses: [{ id: 'ok' }, { id: 'denied' }] });
        if (url.pathname.includes('/denied/')) return Response.json({ error: {} }, { status: 403 });
        return Response.json({});
    };
    const result = await loadClassroom('access', { fetcher });
    assert.equal(result.partial, true);
    assert.equal(result.skippedCourses, 1);
});

test('disabled Classroom API and expired access produce actionable errors', async () => {
    await assert.rejects(loadClassroom('token', { fetcher: async () => Response.json({ error: { details: [{ reason: 'SERVICE_DISABLED' }] } }, { status: 403 }) }), /classroom_api_disabled/);
    await assert.rejects(loadClassroom('token', { fetcher: async () => new Response('', { status: 401 }) }), /classroom_expired/);
});
