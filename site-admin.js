/* Shared owner navigation and the private page's sign-in/access gate. */
(() => {
    'use strict';
    const auth = window.studyAuth;
    if (!auth) return;
    const navigation = document.querySelector('.site-switcher-panel');
    const link = document.createElement('a');
    link.className = 'site-switcher-link'; link.href = '/admin/'; link.textContent = 'Адмін-панель'; link.hidden = true;
    if (document.body.dataset.app === 'admin') link.setAttribute('aria-current', 'page');
    navigation?.append(link);
    const content = document.querySelector('[data-admin-content]');
    const gate = document.querySelector('[data-admin-gate]');
    const message = document.querySelector('[data-admin-message]');
    const signIn = document.querySelector('[data-admin-login]');
    let redirecting = false;
    signIn?.addEventListener('click', () => auth.open());
    function update(session) {
        const verified = session?.status === 'ready';
        const owner = Boolean(verified && session?.user && session.mainAdmin);
        link.hidden = !owner;
        if (!content) return;
        content.hidden = !owner; gate.hidden = owner;
        if (!owner) {
            signIn.hidden = session?.status !== 'error';
            signIn.textContent = 'Повторити перевірку';
            message.textContent = session?.status === 'error'
                ? 'Не вдалося перевірити доступ. Перевірте з’єднання та повторіть спробу.'
                : verified ? 'Немає доступу. Переходимо до розкладу…' : 'Перевіряємо ваш акаунт…';
            if (verified && !redirecting) { redirecting = true; window.location.replace('/'); }
        }
    }
    window.addEventListener('pagehide', () => { link.hidden = true; if (content) { content.hidden = true; gate.hidden = false; } });
    window.addEventListener('pageshow', () => update(auth.snapshot()));
    auth.subscribe(update); update(auth.snapshot());
})();
