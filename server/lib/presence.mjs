export const ONLINE_WINDOW_MS = 120000;
const KEY = 'active-v1';
const LIMIT = 500;

// Bounded, short-lived presence snapshot, not a history of visits.
export function createPresenceService({ getStore, now = () => Date.now() }) {
    async function update(change) {
        const store = getStore();
        for (let attempt = 0; attempt < 4; attempt++) {
            const saved = await store.getWithMetadata(KEY, { type: 'json' });
            const timestamp = now();
            const entries = Object.fromEntries(Object.entries(saved?.data || {}).filter(([, row]) =>
                Number.isFinite(row.seenAt) && row.seenAt > timestamp - ONLINE_WINDOW_MS && row.seenAt <= timestamp));
            change(entries, timestamp);
            const result = await store.setJSON(KEY, entries, saved ? { onlyIfMatch: saved.etag } : { onlyIfNew: true });
            if (result.modified) return { entries, timestamp };
        }
        throw new Error('presence_unavailable');
    }
    return {
        async ping({ key, user, page }) {
            await update((entries, timestamp) => {
                if (!entries[key] && Object.keys(entries).length >= LIMIT) throw new Error('presence_unavailable');
                entries[key] = { seenAt: timestamp, page, ...(user ? { user: { id: user.id, name: user.name, email: user.email } } : {}) };
            });
        },
        async remove(key) { await update(entries => { delete entries[key]; }); },
        async list() {
            const { entries, timestamp } = await update(() => {});
            const accounts = new Map(); let guests = 0;
            for (const row of Object.values(entries)) {
                if (!row.user) { guests++; continue; }
                const previous = accounts.get(row.user.id);
                if (!previous || row.seenAt > previous.seenAt) accounts.set(row.user.id, row);
            }
            return { users: [...accounts.values()].sort((a, b) => b.seenAt - a.seenAt).map(row => ({
                name: row.user.name, email: row.user.email, page: row.page, lastSeen: new Date(row.seenAt).toISOString()
            })), guests, updatedAt: new Date(timestamp).toISOString(), windowSeconds: ONLINE_WINDOW_MS / 1000 };
        }
    };
}
