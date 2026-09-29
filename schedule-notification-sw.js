/* Notification display/click support only: no polling, push subscription, or offline caching. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil((async () => {
        const target = new URL('/index.html#weeklySchedule', self.location.origin).href;
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
        if (existing) {
            const focused = await existing.focus();
            // Never navigate away from a report draft: open the schedule separately if needed.
            const path = new URL(existing.url).pathname;
            if (path === '/' || path === '/index.html') await focused.navigate(target);
            else await self.clients.openWindow(target);
        } else await self.clients.openWindow(target);
    })());
});
