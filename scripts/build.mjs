import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Only public assets are published, never .env, dependencies or server sources.
const root = new URL('../', import.meta.url);
const output = new URL('dist/', root);
await mkdir(output, { recursive: true });
const assets = [
    '_headers',
    'index.html', 'styles.css', 'workspace.css', 'frosted-glass.css',
    'appearance.css', 'neumorphism.css', 'site-appearance.js', 'schedule-time.js', 'schedule-replacements.js', 'schedule-notices.js',
    'site-notifications.js', 'background-notifications.js', 'schedule-notification-sw.js', 'site-permissions.js', 'site-presence.js',
    'site-admin.js', 'admin/index.html', 'admin/style.css', 'admin/online.js', 'admin/settings.js',
    'privacy.html', 'terms.html', 'legal.css',
    'background-particles.js', 'site-navigation.js', 'site-branding.js', 'site-auth.js', 'site-classroom.js',
    'brand-icon.svg', 'ui-icons.svg', 'icon.png', 'sound.mp3', 'schedule.json', 'announcement.json',
    'reports/index.html', 'reports/style.css', 'reports/script.js', 'reports/blocks.js', 'reports/blocks.css', 'reports/delete-confirm.js',
    'reports/drafts-store.js', 'reports/drafts.js', 'reports/drafts.css',
    'reports/sound.mp3', 'reports/templates/oop-lab1.js', 'reports/assets/libs/docx.umd.js'
];
for (const asset of assets) {
    const target = new URL(asset, output);
    await mkdir(new URL('./', target), { recursive: true });
    await cp(new URL(asset, root), target);
}
console.log(`Built ${assets.length} public assets in ${fileURLToPath(output)}`);
