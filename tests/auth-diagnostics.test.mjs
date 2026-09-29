import test from 'node:test';
import assert from 'node:assert/strict';
import { googleFailureDiagnostic } from '../server/lib/auth-diagnostics.mjs';

test('diagnostics classify bounded error chains without copying private exception fields', () => {
    for (const [error, category, code] of [
        [{ cause: { name: 'TimeoutError' } }, 'timeout', null],
        [{ cause: { code: 'ECONNRESET' } }, 'network', 'ECONNRESET'],
        [new SyntaxError('private response'), 'invalid_response', null],
        [new TypeError('private URL'), 'runtime', null],
        [{ name: 'private name', code: 'private code', response: { status: 'secret' } }, 'unknown', null],
        [null, 'unknown', null]
    ]) {
        const detail = googleFailureDiagnostic('token', error);
        assert.equal(detail.category, category);
        assert.equal(detail.code, code);
        assert.equal(detail.upstreamStatus, null);
        assert.doesNotMatch(JSON.stringify(detail), /private|secret/);
    }
    const circular = {}; circular.cause = circular;
    assert.equal(googleFailureDiagnostic('profile', circular).category, 'unknown');
    assert.notEqual(googleFailureDiagnostic('token', null).id, googleFailureDiagnostic('token', null).id);
    assert.throws(() => googleFailureDiagnostic('private-stage', null));
});
