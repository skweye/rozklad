/* Shared Google sign-in UI. The server is the source of truth for the session. */
(() => {
    'use strict';
    const navigation = document.querySelector('header .nav-links');
    if (!navigation) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-auth';
    const accountIcon = document.createElement('span');
    accountIcon.className = 'auth-button-icon';
    accountIcon.setAttribute('aria-hidden', 'true');
    accountIcon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="8" r="3.5"/><path d="M5 20v-1a7 7 0 0 1 14 0v1"/></svg>';
    const buttonLabel = document.createElement('span');
    buttonLabel.className = 'auth-button-label';
    buttonLabel.textContent = 'Увійти';
    const accountArrow = document.createElement('span');
    accountArrow.className = 'auth-button-arrow';
    accountArrow.setAttribute('aria-hidden', 'true');
    accountArrow.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>';
    button.append(accountIcon, buttonLabel, accountArrow);
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', 'accountDialog');
    navigation.append(button);

    const dialog = document.createElement('dialog');
    dialog.id = 'accountDialog';
    dialog.className = 'auth-dialog';
    dialog.setAttribute('aria-labelledby', 'accountTitle');
    dialog.setAttribute('aria-describedby', 'accountNote');
    // Only static markup goes through innerHTML; all profile data uses textContent.
    dialog.innerHTML = `
        <div class="auth-dialog-heading">
            <h2 id="accountTitle">Вхід до акаунта</h2>
            <button type="button" class="btn auth-close" aria-label="Закрити">×</button>
        </div>
        <p id="accountNote" class="auth-note">Вхід і перше підключення — однією кнопкою. Google підтвердить ваш акаунт і запропонує доступ лише до читання курсів та ваших робіт для найближчих здач. Сайт не здає та не змінює завдання.</p>
        <p class="auth-status" role="status" aria-live="polite" aria-atomic="true"></p>
        <div class="auth-profile" hidden><strong class="auth-name"></strong><span class="auth-email"></span></div>
        <div class="auth-provider" hidden>
            <div class="auth-google-button"></div>
            <p class="auth-provider-note">Пароль Google не передається сайту. Дозволи Classroom можна відхилити — розклад і звіти залишаться доступними.</p>
        </div>
        <p class="auth-provider-note">Чернетки залишаються в цьому браузері й не синхронізуються. Продовжуючи, ви приймаєте <a href="/terms.html">умови використання</a>. Як ми обробляємо дані: <a href="/privacy.html">політика конфіденційності</a>.</p>
        <p class="auth-provider-note">Коли сайт відкритий у видимій вкладці, головний адміністратор бачить ваш онлайн-статус, ім’я, email і розділ сайту. Вміст звітів та завдання Classroom йому не передаються.</p>
        <button type="button" class="btn auth-logout" hidden>Вийти з акаунта</button>
        <button type="button" class="btn auth-retry" hidden>Спробувати ще раз</button>`;
    document.body.append(dialog);
    const status = dialog.querySelector('.auth-status');
    const profile = dialog.querySelector('.auth-profile');
    const googleContainer = dialog.querySelector('.auth-google-button');
    const provider = dialog.querySelector('.auth-provider');
    const logout = dialog.querySelector('.auth-logout');
    const retry = dialog.querySelector('.auth-retry');
    const title = dialog.querySelector('h2');
    const syncKey = 'study-account-changed';
    let session = null;
    let sessionStatus = 'checking';
    let presenceCsrf = '';
    let sdkPromise = null;
    let busy = false;
    let revision = 0;
    let tokenClient = null;
    let popupPending = false;
    let oauthAttempt = 0;
    let sessionEpoch = 0;
    const sessionListeners = new Set();
    const snapshot = () => ({ status: sessionStatus, user: session?.user || null, clientId: session?.clientId, classroomConnected: Boolean(session?.classroomConnected), scheduleAdmin: Boolean(session?.scheduleAdmin), mainAdmin: Boolean(session?.mainAdmin), permissions: session?.permissions ? { ...session.permissions } : null });

    const messages = {
        owner_required: 'Керувати правами може лише головний адміністратор.',
        permission_required: 'У вас немає права на цю дію. Зверніться до головного адміністратора.',
        permissions_invalid: 'Перевірте email і вибрані права.',
        permissions_conflict: 'Права вже змінено в іншій вкладці. Оновіть список перед збереженням.',
        permissions_unavailable: 'Не вдалося прочитати або зберегти права. Спробуйте ще раз.',
        presence_unavailable: 'Не вдалося оновити список онлайн. Спробуйте ще раз.',
        owner_protected: 'Головний адміністратор задається лише в конфігурації сервера.',
        permissions_limit: 'Досягнуто ліміту: 200 користувачів із додатковими правами.',
        admin_required: 'Змінювати розклад може лише адміністратор.',
        replacement_invalid: 'Перевірте дату та вибрану пару. Минулі дати змінювати не можна.',
        replacement_conflict: 'Цю заміну вже змінено в іншій вкладці. Закрийте вікно, оновіть заміни та спробуйте знову.',
        replacements_unavailable: 'Не вдалося зберегти заміну. Перевірте з’єднання та сховище даних.',
        session_expired: 'Час входу минув. Оновіть вікно кнопкою нижче та повторіть вхід.',
        invalid_google_token: 'Не вдалося підтвердити акаунт Google. Спробуйте увійти ще раз.',
        not_configured: 'Вхід через Google ще не підключено власником сайту.',
        wrong_origin: 'Вхід не налаштовано для цієї адреси сайту. Відкрийте основну адресу або зверніться до власника.',
        unavailable: 'Не вдалося з’єднатися із сервером входу. Перевірте інтернет або налаштування сервера.',
        google_unavailable: 'Не вдалося завантажити кнопку Google. Перевірте інтернет і блокувальник вмісту.',
        login_required: 'Увійдіть на сайт, щоб побачити свої завдання.',
        classroom_expired: 'Короткостроковий сеанс Classroom завершився. Оновіть підключення; раніше надані дозволи Google зберігаються.',
        classroom_verification_unavailable: 'Сайт не зміг завершити перевірку входу через Google. Повторіть спробу; якщо помилка повторюється, передайте власнику код діагностики. Надавати дозволи заново не потрібно.',
        classroom_storage_failed: 'Google підтвердив доступ, але браузер не зберіг підключення. Дозвольте cookie для цього сайту та відкрийте його основну адресу. Повторна видача дозволів Google не допоможе.',
        classroom_wrong_account: 'Оберіть той самий Google-акаунт, з яким ви увійшли на сайт.',
        classroom_scope_required: 'Потрібен дозвіл на читання курсів і ваших робіт. Підключіть Classroom повторно та надайте обидва дозволи.',
        classroom_api_disabled: 'Власник сайту має увімкнути Google Classroom API у Google Cloud.',
        classroom_forbidden: 'Google не дозволив прочитати ці курси. Перевірте дозволи або зверніться до адміністратора навчального закладу.',
        classroom_quota: 'Перевищено ліміт запитів Classroom. Спробуйте оновити пізніше.',
        classroom_unavailable: 'Не вдалося завантажити роботи з Classroom. Спробуйте оновити ще раз.'
    };

    function updateButton() {
        buttonLabel.textContent = session?.user ? session.user.name : 'Увійти';
        button.setAttribute('data-signed-in', String(Boolean(session?.user)));
        button.setAttribute('aria-label', session?.user ? `Акаунт: ${session.user.name}` : 'Увійти через Google');
        button.title = session?.user ? 'Відкрити акаунт' : 'Увійти через Google';
        sessionListeners.forEach(listener => listener(snapshot()));
    }

    function drawGoogleButton() {
        const googleButton = document.createElement('button');
        googleButton.type = 'button';
        googleButton.className = 'auth-google-continue';
        // Use Google's current brand asset, without recoloring it with the site accent.
        googleButton.innerHTML = '<img src="https://developers.google.com/static/identity/images/g-logo.png" width="20" height="20" alt="" referrerpolicy="no-referrer"><span>Продовжити з Google</span>';
        googleButton.addEventListener('click', () => {
            if (busy || !tokenClient) return;
            popupPending = true;
            setBusy(true);
            status.textContent = 'Оберіть акаунт і дозволи у вікні Google…';
            // Must run synchronously from the click so browsers allow the popup.
            try { tokenClient.requestAccessToken({ prompt: 'select_account' }); }
            catch { popupPending = false; setBusy(false); showError(new Error('google_unavailable')); }
        });
        googleContainer.append(googleButton);
    }

    async function api(action, data, csrf = session?.csrf || '') {
        try {
            const response = await fetch(`/api/auth/${action}`, {
                method: data ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
                headers: data ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {},
                body: data ? JSON.stringify(data) : undefined,
                signal: AbortSignal.timeout(action === 'classroom' ? 30000 : 20000)
            });
            if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('unavailable');
            const result = await response.json();
            if (!response.ok) {
                const error = new Error(result.error || 'unavailable');
                error.diagnostic = safeDiagnostic(result.diagnostic);
                error.missingPermissions = Array.isArray(result.missingPermissions) ? result.missingPermissions.filter(value => ['courses', 'coursework'].includes(value)) : [];
                throw error;
            }
            return result;
        } catch (error) {
            if (messages[error.message]) throw error;
            throw new Error('unavailable');
        }
    }

    function loadGoogle() {
        if (window.google?.accounts?.oauth2) return Promise.resolve();
        if (sdkPromise) return sdkPromise;
        sdkPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            const fail = () => {
                clearTimeout(timeout);
                script.remove();
                sdkPromise = null;
                reject(new Error('google_unavailable'));
            };
            const timeout = setTimeout(fail, 15000);
            script.src = 'https://accounts.google.com/gsi/client';
            script.async = true;
            script.onload = () => {
                if (!window.google?.accounts?.oauth2) return fail();
                clearTimeout(timeout);
                resolve();
            };
            script.onerror = fail;
            document.head.append(script);
        });
        return sdkPromise;
    }

    function safeDiagnostic(value) {
        if (!value || typeof value.id !== 'string' || !/^google-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.id) ||
            !['token', 'profile'].includes(value.stage) || !['http', 'unknown', 'timeout', 'network', 'runtime', 'invalid_response'].includes(value.category)) return null;
        return { id: value.id, stage: value.stage, category: value.category,
            upstreamStatus: Number.isInteger(value.upstreamStatus) && value.upstreamStatus >= 100 && value.upstreamStatus <= 599 ? value.upstreamStatus : null };
    }

    function diagnosticMessage(error) {
        const detail = error.message === 'classroom_verification_unavailable' ? safeDiagnostic(error.diagnostic) : null;
        const message = messages[error.message] || messages.unavailable;
        return detail ? `${message} Код: ${detail.id} · ${detail.stage}/${detail.category}${detail.upstreamStatus ? `/${detail.upstreamStatus}` : ''}.` : message;
    }

    function showError(error) {
        status.textContent = diagnosticMessage(error);
        retry.hidden = false;
    }

    function setBusy(value) {
        busy = value;
        button.disabled = value;
        logout.disabled = value;
        retry.disabled = value;
        dialog.setAttribute('aria-busy', String(value));
        googleContainer.inert = value;
    }

    function notifyTabs() {
        // No token or personal information is written to browser storage.
        try { localStorage.setItem(syncKey, String(Date.now())); } catch { /* Storage may be disabled. */ }
    }

    async function renderAccount() {
        const currentRevision = ++revision;
        googleContainer.replaceChildren();
        provider.hidden = true;
        profile.hidden = true;
        logout.hidden = true;
        retry.hidden = true;
        title.textContent = session?.user ? 'Ваш акаунт' : 'Вхід до акаунта';
        if (session?.user) {
            dialog.querySelector('.auth-name').textContent = session.user.name;
            dialog.querySelector('.auth-email').textContent = session.user.email;
            profile.hidden = false;
            logout.hidden = false;
            status.textContent = session.classroomConnected ? 'Ви увійшли. Classroom підключено — найближчі роботи доступні на сторінці розкладу.' : 'Ви увійшли. Classroom не підключено: дозвіл можна надати в блоці «Найближчі здачі» на сторінці розкладу.';
            return;
        }
        if (!session?.configured) {
            status.textContent = messages.not_configured;
            retry.hidden = false;
            return;
        }
        status.textContent = 'Завантаження кнопки Google…';
        try {
            await loadGoogle();
            if (!dialog.open || currentRevision !== revision) return;
            const epoch = sessionEpoch;
            const attempt = ++oauthAttempt;
            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: session.clientId,
                scope: 'openid email profile https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.coursework.me.readonly',
                include_granted_scopes: true,
                callback: result => {
                    if (attempt !== oauthAttempt || epoch !== sessionEpoch || !popupPending) return;
                    popupPending = false;
                    if (result.error || !result.access_token) {
                        setBusy(false);
                        status.textContent = 'Вхід скасовано або доступ не надано. Ви можете спробувати ще раз.';
                        return;
                    }
                    return signIn(result.access_token, epoch);
                },
                error_callback: () => {
                    if (attempt !== oauthAttempt || epoch !== sessionEpoch || !popupPending) return;
                    popupPending = false;
                    setBusy(false);
                    status.textContent = 'Вікно Google закрито або заблоковано. Натисніть кнопку ще раз, щоб продовжити.';
                }
            });
            provider.hidden = false;
            drawGoogleButton();
            status.textContent = 'Вхід через Google та підключення найближчих здач — в одному вікні.';
        } catch (error) {
            if (currentRevision === revision) showError(error);
        }
    }

    async function refresh(showDialog = false) {
        if (busy) return;
        const epoch = sessionEpoch;
        setBusy(true);
        sessionStatus = 'checking';
        updateButton();
        if (showDialog) {
            status.textContent = 'Перевіряємо акаунт…';
            retry.hidden = true;
            googleContainer.replaceChildren();
            provider.hidden = true;
        }
        try {
            const nextSession = await api('session');
            if (epoch !== sessionEpoch) return;
            session = nextSession;
            sessionStatus = 'ready';
            updateButton();
            if (showDialog && dialog.open) await renderAccount();
        } catch (error) {
            if (epoch !== sessionEpoch) return;
            sessionStatus = 'error';
            updateButton();
            if (showDialog) showError(error);
        } finally {
            setBusy(false);
            if (epoch !== sessionEpoch) refresh(dialog.open);
        }
    }

    async function signIn(accessToken, epoch) {
        setBusy(true);
        status.textContent = 'Підтверджуємо вхід…';
        try {
            const response = await api('google-connect', { accessToken });
            if (epoch !== sessionEpoch) return;
            const savedSession = await api('session');
            if (epoch !== sessionEpoch) return;
            if (savedSession.user?.id !== response.user.id || (response.classroomConnected && !savedSession.classroomConnected)) {
                throw new Error('classroom_storage_failed');
            }
            session = savedSession;
            sessionStatus = 'ready';
            updateButton();
            notifyTabs();
            if (dialog.open) await renderAccount();
        } catch (error) {
            googleContainer.replaceChildren();
            provider.hidden = true;
            showError(error);
        } finally {
            setBusy(false);
            if (epoch !== sessionEpoch) refresh(dialog.open);
        }
    }

    logout.addEventListener('click', async () => {
        if (busy) return;
        setBusy(true);
        status.textContent = 'Виходимо з акаунта…';
        try {
            // Login consumes its challenge, so obtain a fresh CSRF token before logout.
            session = await api('session');
            await api('logout', {});
            session = null;
            sessionStatus = 'ready';
            window.google?.accounts?.id?.disableAutoSelect();
            updateButton();
            notifyTabs();
            dialog.close();
        } catch (error) { showError(error); }
        finally { setBusy(false); }
    });
    button.addEventListener('click', () => { dialog.showModal(); refresh(true); });
    retry.addEventListener('click', () => refresh(true));
    dialog.querySelector('.auth-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
        revision++;
        if (popupPending) { oauthAttempt++; popupPending = false; setBusy(false); }
    });
    dialog.addEventListener('click', event => {
        if (event.target !== dialog) return;
        const bounds = dialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    });
    window.addEventListener('storage', event => {
        if (event.key !== syncKey) return;
        sessionEpoch++;
        oauthAttempt++;
        if (popupPending) { popupPending = false; setBusy(false); }
        session = null;
        sessionStatus = 'checking';
        updateButton();
        refresh(dialog.open);
    });
    window.addEventListener('pageshow', event => { if (event.persisted) refresh(dialog.open); });
    async function ownerRequest(data, action = 'permissions') {
        const epoch = sessionEpoch;
        const fresh = await api('session');
        if (epoch !== sessionEpoch) throw new Error('login_required');
        session = fresh; sessionStatus = 'ready'; updateButton();
        if (!fresh.user) throw new Error('login_required');
        if (!fresh.mainAdmin) throw new Error('owner_required');
        const result = await api(action, data);
        if (epoch !== sessionEpoch || !session?.mainAdmin) throw new Error('login_required');
        return result;
    }
    window.studyAuth = {
        snapshot,
        subscribe(listener) { sessionListeners.add(listener); return () => sessionListeners.delete(listener); },
        open() { if (!dialog.open) dialog.showModal(); refresh(true); },
        prepareGoogle: loadGoogle,
        errorMessage(error) {
            if (error.message === 'classroom_scope_required' && error.missingPermissions?.length) {
                const labels = { courses: 'читання курсів', coursework: 'читання ваших робіт і статусів здачі' };
                return `Google не повернув дозвіл: ${error.missingPermissions.map(key => labels[key]).join(', ')}. Натисніть кнопку нижче та відмітьте цей доступ у вікні Google.`;
            }
            return diagnosticMessage(error);
        },
        readClassroom: () => api('classroom'),
        readPermissions: () => ownerRequest(),
        readPresence: () => ownerRequest(undefined, 'presence'),
        async sendPresence(page) {
            // Presence never changes UI auth state or requests Google consent.
            // Reuse a short-lived CSRF token; refresh it only when necessary.
            const epoch = sessionEpoch;
            let csrf = presenceCsrf || session?.csrf;
            if (!csrf) {
                const fresh = await api('session');
                if (epoch !== sessionEpoch || !fresh.configured) return;
                csrf = presenceCsrf = fresh.csrf;
            }
            try { await api('presence', { page }, csrf); }
            catch (error) {
                if (error.message !== 'session_expired' || epoch !== sessionEpoch) throw error;
                const fresh = await api('session');
                if (epoch !== sessionEpoch || !fresh.configured) return;
                presenceCsrf = fresh.csrf;
                await api('presence', { page }, presenceCsrf);
            }
        },
        changePermissions: data => ownerRequest(data),
        async changeReplacement(data) {
            const epoch = sessionEpoch;
            const fresh = await api('session');
            if (epoch !== sessionEpoch) throw new Error('login_required');
            session = fresh;
            updateButton();
            if (!fresh.user) throw new Error('login_required');
            if (!fresh.scheduleAdmin) throw new Error('admin_required');
            const needed = data.operation === 'remove' ? 'cancelReplacements' : data.revision === null ? 'createReplacements' : 'editReplacements';
            if (fresh.permissions && !fresh.permissions[needed]) throw new Error('permission_required');
            return api('replacements', data);
        },
        async connectClassroom(accessToken) {
            const epoch = sessionEpoch;
            const nextSession = await api('session');
            if (epoch !== sessionEpoch) throw new Error('login_required');
            session = nextSession;
            if (!session.user) { updateButton(); throw new Error('login_required'); }
            await api('classroom-connect', { accessToken });
            if (epoch !== sessionEpoch || !session?.user) throw new Error('login_required');
            // A successful POST alone does not prove that the browser accepted Set-Cookie.
            const savedSession = await api('session');
            if (epoch !== sessionEpoch || savedSession.user?.id !== session.user.id) throw new Error('login_required');
            if (!savedSession.classroomConnected) throw new Error('classroom_storage_failed');
            session = savedSession;
            updateButton();
            notifyTabs();
        }
    };
    refresh();
})();
