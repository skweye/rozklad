/* One state owner for the library and editor. Save before switching documents. */
(() => {
    'use strict';
    function mount({ library, getState, applyState, blankState, flush, pause, resume, notice, exportState }) {
        const el = id => document.getElementById(id);
        const dialog = el('draftsDialog'), list = el('draftsList'), name = el('draftName');
        const search = el('draftSearch'), filter = el('draftDiscipline'), status = el('draftsStatus');
        let busy = false, items = [], renameId = null;
        const title = item => item.title || window.ReportDraftStore.titleFor(item.state);
        const message = error => window.ReportAccount?.id && window.studyAuth ? window.studyAuth.errorMessage(error) : error?.message === 'draft_conflict'
            ? 'Цей звіт змінено в іншій вкладці. Експортуйте поточну роботу, щоб не втратити зміни.'
            : 'Не вдалося зберегти зміни. Експортуйте чернетку та перевірте вільне місце у браузері.';
        function updateTitle() {
            el('currentDraftTitle').textContent = library.current()?.title || window.ReportDraftStore.titleFor(getState());
        }
        function setBusy(value) {
            busy = value;
            el('workspaceWrapper').inert = value;
            el('reportsLibrary').setAttribute('aria-busy', String(value));
            for (const node of document.querySelectorAll('#reportsLibrary button, #draftsDialog button, #draftsDialog input, #btnDraftLibrary, #btnRenameReport, #btnDuplicateReport')) {
                node.disabled = value || node.dataset.current === 'true';
            }
        }
        async function action(fn) {
            if (busy) return;
            pause(); setBusy(true);
            try { await fn(); updateTitle(); }
            catch (error) {
                status.textContent = message(error); notice(status.textContent, 'error');
                if (el('reportsEditor').hidden) editor();
            }
            finally { setBusy(false); resume(); }
        }
        function button(label, handler, className = '') {
            const button = document.createElement('button'); button.type = 'button';
            button.className = `draft-action ${className}`; button.textContent = label;
            button.addEventListener('click', handler); return button;
        }
        function editor(section = '#reportDetails') { window.ReportStudio.showEditor(section); updateTitle(); }
        function isBlank(state) {
            return !state.discipline?.trim() && !state.labTheme?.trim() && !state.labGoal?.trim()
                && !state.labEquipment?.trim() && !state.cipher?.trim() && !state.studentTeacher?.trim()
                && !state.tasks?.length && !state.questions?.length && !state.conclusionText?.trim();
        }
        async function continueReport(item, download = false) {
            await action(async () => {
                applyState(await library.switchTo(item.id, getState())); editor();
                if (download) el('btnDownloadReport').click();
            });
        }
        function rename(item) {
            renameId = item.id; name.value = title(item); dialog.showModal(); name.focus(); name.select();
        }
        async function duplicate(item) {
            await action(async () => { applyState(await library.duplicate(item.id, getState())); editor(); });
        }
        function renderCards() {
            const query = search.value.trim().toLocaleLowerCase('uk');
            const visible = items.filter(item => (!filter.value || item.state.discipline?.trim() === filter.value)
                && `${title(item)} ${item.state.labTheme || ''} ${item.state.discipline || ''}`.toLocaleLowerCase('uk').includes(query));
            list.replaceChildren();
            for (const item of visible) {
                const current = item.id === library.current()?.id;
                const card = document.createElement('article'); card.className = 'draft-card';
                const subject = document.createElement('p'); subject.className = 'draft-subject'; subject.textContent = item.state.discipline || 'Без дисципліни';
                const heading = document.createElement('h3'); heading.textContent = title(item);
                const description = document.createElement('p'); description.className = 'draft-description'; description.textContent = item.state.labTheme || 'Тему ще не вказано';
                const meta = document.createElement('p'); meta.className = 'draft-meta';
                meta.textContent = `Змінено ${new Date(item.updatedAt).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
                const actions = document.createElement('div'); actions.className = 'draft-card-actions';
                const menu = document.createElement('details'); menu.className = 'report-file-menu';
                const summary = document.createElement('summary'); summary.textContent = '⋯'; summary.setAttribute('aria-label', `Дії: ${title(item)}`);
                const options = document.createElement('div'); options.className = 'report-file-actions';
                const remove = button('Видалити', async event => {
                    if (busy) return;
                    const confirmed = await window.ReportDeleteConfirm.request({ anchor: remove, skipConfirmation: event.shiftKey,
                        title: 'Видалити звіт?', message: 'Звіт і його зображення буде видалено з цього браузера.' });
                    if (confirmed) await action(async () => { await library.remove(item.id); await render(); status.textContent = 'Звіт видалено.'; });
                }, 'btn-danger-nav');
                remove.dataset.current = String(current); remove.disabled = current;
                if (current) remove.title = 'Спочатку відкрий інший звіт';
                options.append(button('Перейменувати', () => rename(item)), button('Створити копію', () => duplicate(item)),
                    button('Скачати DOCX', () => continueReport(item, true)), button('Експорт чернетки', () => exportState(item.state)), remove);
                menu.append(summary, options);
                actions.append(button('Продовжити →', () => continueReport(item), 'draft-continue'), menu);
                card.append(subject, heading, description, meta, actions); list.append(card);
            }
            el('draftCount').textContent = String(visible.length);
            el('draftsEmpty').hidden = visible.length > 0;
            el('draftsEmpty').querySelector('h2').textContent = items.length ? 'Нічого не знайдено' : 'Тут будуть твої звіти';
            el('draftsEmpty').querySelector('p').textContent = items.length ? 'Спробуй іншу назву або обери всі дисципліни.' : 'Створи першу роботу — оформлення документа вже підготовлено.';
            el('btnEmptyNew').hidden = items.length > 0;
        }
        async function render() {
            items = await library.list();
            if (items.length === 1 && !items[0].title && isBlank(items[0].state)) items = [];
            const selected = filter.value;
            filter.replaceChildren(new Option('Усі дисципліни', ''));
            [...new Set(items.map(item => item.state.discipline?.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'uk')).forEach(value => filter.add(new Option(value, value)));
            filter.value = [...filter.options].some(option => option.value === selected) ? selected : '';
            renderCards();
        }
        async function open(focus = true) {
            await action(async () => {
                if (!await flush()) throw new Error('save_failed');
                await render(); status.textContent = ''; window.ReportStudio.showLibrary(focus);
            });
        }
        async function startNew() {
            await action(async () => {
                if (!library.current()?.title && isBlank(getState())) {
                    if (!await flush()) throw new Error('save_failed');
                } else applyState(await library.startNew(getState(), blankState()));
                editor(); el('disciplineInput').focus();
            });
        }
        el('btnDraftLibrary').addEventListener('click', () => open());
        el('btnNewDraft').addEventListener('click', startNew);
        el('btnEmptyNew').addEventListener('click', startNew);
        el('btnCloseDrafts').addEventListener('click', () => { if (!busy) dialog.close(); });
        dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
        el('btnSaveNamedDraft').addEventListener('click', () => action(async () => {
            if (!await flush()) throw new Error('save_failed');
            await library.rename(renameId, name.value); dialog.close(); await render();
        }));
        name.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); el('btnSaveNamedDraft').click(); } });
        el('btnRenameReport').addEventListener('click', () => rename({ ...library.current(), state: getState() }));
        el('btnDuplicateReport').addEventListener('click', () => duplicate({ ...library.current(), state: getState() }));
        search.addEventListener('input', renderCards); filter.addEventListener('change', renderCards);
        updateTitle(); setBusy(false);
        return { open, startNew, updateTitle, message };
    }
    window.ReportDrafts = { mount };
})();
