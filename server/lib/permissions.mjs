import { randomUUID } from 'node:crypto';

const OWNER = 'ym_hryzhenko_081205@dtsepaton.ukr.education';
export const PERMISSION_KEYS = ['createReplacements', 'editReplacements', 'cancelReplacements'];
export const fullPermissions = () => Object.fromEntries(PERMISSION_KEYS.map(key => [key, true]));
export const noPermissions = () => Object.fromEntries(PERMISSION_KEYS.map(key => [key, false]));
const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
export function mainAdminEmail(env = process.env) {
    // Migration: only the FIRST legacy address becomes the owner, never the entire old list.
    return normalizeEmail(env.MAIN_ADMIN_EMAIL ?? env.SCHEDULE_ADMIN_EMAILS?.split(',')[0] ?? OWNER);
}
export function isMainAdmin(user, env = process.env) {
    const owner = mainAdminEmail(env);
    return Boolean(owner && normalizeEmail(user?.email) === owner);
}
export function createPermissionsService({ getStore, env = process.env, now = () => Date.now() }) {
    const key = 'grants-v1';
    return {
        async resolve(user) {
            if (isMainAdmin(user, env)) return { mainAdmin: true, permissions: fullPermissions() };
            if (!user?.email) return { mainAdmin: false, permissions: noPermissions() };
            const data = await getStore().get(key, { type: 'json' });
            const grant = data?.users?.find(item => item.email === normalizeEmail(user.email));
            return { mainAdmin: false, permissions: Object.fromEntries(PERMISSION_KEYS.map(name => [name, grant?.permissions?.[name] === true])) };
        },
        async list() {
            const data = await getStore().get(key, { type: 'json' });
            return { owner: mainAdminEmail(env), revision: data?.revision ?? null, users: data?.users || [] };
        },
        async change(body) {
            const email = normalizeEmail(body?.email);
            if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ||
                !['save', 'remove'].includes(body.operation) ||
                !(body.revision === null || (typeof body.revision === 'string' && body.revision.length <= 64))) throw new Error('permissions_invalid');
            if (email === mainAdminEmail(env)) throw new Error('owner_protected');
            if (body.operation === 'save' && (!body.permissions || typeof body.permissions !== 'object' ||
                Object.keys(body.permissions).some(name => !PERMISSION_KEYS.includes(name)) ||
                PERMISSION_KEYS.some(name => typeof body.permissions[name] !== 'boolean'))) throw new Error('permissions_invalid');
            const store = getStore(), saved = await store.getWithMetadata(key, { type: 'json' });
            if ((saved?.data?.revision ?? null) !== body.revision) throw new Error('permissions_conflict');
            const users = (saved?.data?.users || []).filter(item => item.email !== email);
            if (body.operation === 'save' && PERMISSION_KEYS.some(name => body.permissions[name])) users.push({ email,
                permissions: Object.fromEntries(PERMISSION_KEYS.map(name => [name, body.permissions[name]])), updatedAt: new Date(now()).toISOString() });
            if (users.length > 200) throw new Error('permissions_limit');
            users.sort((a, b) => a.email.localeCompare(b.email));
            const data = { revision: randomUUID(), users };
            const result = await store.setJSON(key, data, saved ? { onlyIfMatch: saved.etag } : { onlyIfNew: true });
            if (!result.modified) throw new Error('permissions_conflict');
            return { ...data, owner: mainAdminEmail(env) };
        }
    };
}
