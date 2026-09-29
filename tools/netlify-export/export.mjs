// One-time, READ-ONLY extraction. This tool is not a dependency of the deployed site.
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function collectRecords(getStore, credentials) {
    const records = [];
    for (const namespace of ['schedule-replacements', 'site-permissions']) {
        const store = getStore({ name: namespace, consistency: 'strong', ...credentials });
        for await (const page of store.list({ paginate: true })) {
            for (const { key } of page.blobs) {
                if (!(namespace === 'site-permissions' ? key === 'grants-v1' : /^\d{4}-\d{2}$/.test(key))) {
                    throw new Error('Unexpected storage key; export stopped without changing the source.');
                }
                const data = await store.get(key, { type: 'json' });
                if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid record in source storage.');
                records.push({ namespace, key, data });
            }
        }
    }
    return records;
}

export function toImportSQL(records) {
    const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
    return '-- Private migration data. Never commit or publish this file. Existing records are NOT overwritten.\n' + records.map(({ namespace, key, data }) => {
        if (!['schedule-replacements', 'site-permissions'].includes(namespace)) throw new Error('Invalid namespace.');
        const sql = `INSERT INTO site_records (namespace, key, value, etag, updated_at) VALUES (${[namespace, key, JSON.stringify(data), randomUUID()].map(literal).join(', ')}, ${Date.now()}) ON CONFLICT(namespace, key) DO NOTHING;`;
        if (Buffer.byteLength(sql) > 95000) throw new Error('A record exceeds the safe D1 query size. Keep the JSON backup and split the import before continuing.');
        return sql;
    }).join('\n') + '\n';
}

async function main() {
    const siteID = process.env.NETLIFY_SITE_ID, token = process.env.NETLIFY_AUTH_TOKEN;
    if (!siteID || !token || siteID.startsWith('replace-') || token.startsWith('replace-')) throw new Error('Set NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN in a private .env.migration file.');
    const { getStore } = await import('@netlify/blobs');
    const records = await collectRecords(getStore, { siteID, token });
    const folder = new URL(`../../private-backups/export-${Date.now()}/`, import.meta.url);
    await mkdir(folder, { recursive: true });
    await writeFile(new URL('records.json', folder), JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), records }, null, 2), { flag: 'wx', mode: 0o600 });
    await writeFile(new URL('import.sql', folder), toImportSQL(records), { flag: 'wx', mode: 0o600 });
    console.log(`Exported ${records.length} records to ${fileURLToPath(folder)}. Source unchanged. Presence and OAuth tokens are not exported.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(() => {
        // Provider exceptions can contain authorization headers; never print them.
        console.error('Export failed. Check the private credentials, access to both stores, record format and network. Source data was not modified.');
        process.exitCode = 1;
    });
}
