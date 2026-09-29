import { randomUUID } from 'node:crypto';

const networkCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT']);

// Never serialize an exception: Google errors may contain tokens, headers and profiles.
export function googleFailureDiagnostic(stage, error) {
    if (!['token', 'profile'].includes(stage)) throw new Error('invalid_diagnostic_stage');
    const status = error?.response?.status;
    const upstreamStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
    let category = upstreamStatus ? 'http' : 'unknown';
    let code = null;
    if (!upstreamStatus) {
        let current = error;
        for (let depth = 0; current && depth < 3; depth++, current = current.cause) {
            if (current.name === 'TimeoutError' || current.name === 'AbortError') { category = 'timeout'; break; }
            if (networkCodes.has(current.code)) { category = 'network'; code = current.code; break; }
            if (current.name === 'SyntaxError') category = 'invalid_response';
            else if (current.name === 'TypeError' && category === 'unknown') category = 'runtime';
        }
    }
    return { id: `google-${randomUUID()}`, stage, category, upstreamStatus, code };
}
