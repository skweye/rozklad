/* Theme-aware library dialog. User content is inserted only as text. */
(function () {
    "use strict";
    function mount({ library, getState, applyState, blankState, flush, pause, resume, notice, exportState }) {
        const dialog = document.getElementById("draftsDialog"), list = document.getElementById("draftsList");
        const name = document.getElementById("draftName"), status = document.getElementById("draftsStatus");
        const toolbarTitle = document.getElementById("currentDraftTitle");
        let busy = false;
        const message = error => error?.message === "draft_conflict"
            ? "Цю чернетку змінено в іншій вкладці. Експортуйте поточний звіт у файл, щоб не втратити зміни."
            : "Не вдалося зберегти чернетку. Форму не змінено. Експортуйте звіт у файл і перевірте вільне місце у браузері.";
        function updateTitle() {
            toolbarTitle.textContent = library.current()?.title || window.ReportDraftStore.titleFor(getState());
        }
        function setBusy(value) {
            busy = value;
            dialog.setAttribute("aria-busy", String(value));
            dialog.querySelectorAll("button,input").forEach(el => { el.disabled = value || el.dataset.current === "true"; });
        }
        async function action(fn) {
            if (busy) return;
            pause(); setBusy(true); status.textContent = "Зберігаємо…";
            try { await fn(); updateTitle(); }
            catch (error) { status.textContent = message(error); notice(status.textContent, "error"); }
            finally { setBusy(false); resume(); }
        }
        function icon(symbol) {
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("class", "ui-icon"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
            const use = document.createElementNS(svg.namespaceURI, "use");
            use.setAttribute("href", `../ui-icons.svg#${symbol}`); svg.append(use); return svg;
        }
        function button(label, symbol, handler) {
            const el = document.createElement("button"); el.type = "button"; el.className = "draft-action";
            el.append(icon(symbol), document.createTextNode(label)); el.addEventListener("click", handler); return el;
        }
        async function render() {
            const items = await library.list();
            list.replaceChildren();
            for (const item of items) {
                const current = item.id === library.current()?.id;
                const card = document.createElement("article"); card.className = "draft-card";
                if (current) card.classList.add("is-current");
                const heading = document.createElement("h3"); heading.textContent = item.title || window.ReportDraftStore.titleFor(item.state);
                const description = document.createElement("p"); description.textContent = item.state.labTheme || item.state.discipline || "Тему ще не вказано";
                const meta = document.createElement("p"); meta.className = "draft-meta";
                const date = new Date(item.updatedAt);
                meta.textContent = `${current ? "Відкрито зараз · " : ""}${date.toLocaleString("uk-UA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · ${item.state.tasks?.length || 0} блоків`;
                const actions = document.createElement("div"); actions.className = "draft-card-actions";
                const open = button(current ? "Відкрито" : "Продовжити", "file", () => action(async () => {
                    await library.save(getState(), name.value);
                    const target = await library.switchTo(item.id, getState());
                    applyState(target); dialog.close();
                }));
                open.dataset.current = String(current); open.disabled = current;
                const download = button("У файл", "download", () => exportState(item.state));
                const remove = button("Видалити", "trash", async event => {
                    if (busy) return;
                    const confirmed = await window.ReportDeleteConfirm.request({ anchor: remove, skipConfirmation: event.shiftKey,
                        title: "Видалити чернетку?", message: "Збережений звіт і його зображення буде видалено з цього браузера." });
                    if (confirmed) action(async () => { await library.remove(item.id); await render(); status.textContent = "Чернетку видалено."; });
                });
                remove.dataset.current = String(current); remove.disabled = current;
                if (current) remove.title = "Спочатку відкрийте інший звіт";
                actions.append(open, download, remove); card.append(heading, description, meta, actions); list.append(card);
            }
            document.getElementById("draftCount").textContent = String(items.length);
        }
        async function open() {
            if (dialog.open) return;
            name.value = library.current()?.title || "";
            name.placeholder = window.ReportDraftStore.titleFor(getState());
            dialog.showModal();
            await action(async () => {
                if (!await flush()) throw new Error("save_failed");
                await render(); status.textContent = "Усі зміни поточного звіту збережено.";
            });
            name.focus();
        }
        async function startNew() {
            await action(async () => {
                const next = await library.startNew(getState(), blankState(), dialog.open ? name.value : undefined);
                applyState(next); dialog.close();
                document.getElementById("disciplineInput").focus();
            });
        }
        document.getElementById("btnDraftLibrary").addEventListener("click", open);
        document.getElementById("btnNewDraft").addEventListener("click", open);
        document.getElementById("btnCloseDrafts").addEventListener("click", () => { if (!busy) dialog.close(); });
        dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
        dialog.addEventListener("click", event => { if (event.target === dialog && !busy) dialog.close(); });
        document.getElementById("btnSaveNamedDraft").addEventListener("click", () => action(async () => {
            await library.save(getState(), name.value); await render(); status.textContent = "Чернетку збережено. Можна повернутися до неї пізніше.";
        }));
        document.getElementById("btnSaveAndNewDraft").addEventListener("click", startNew);
        name.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); document.getElementById("btnSaveNamedDraft").click(); } });
        updateTitle();
        return { open, startNew, updateTitle, message };
    }
    window.ReportDrafts = { mount };
})();
