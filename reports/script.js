/**
 * Генератор звітів з лабораторних робіт коледжу
 * Параметри сторінки та шрифти налаштовані за інструкцією коледжу Патона.
 * Зміст і послідовність блоків визначає автор звіту.
 */

(function () {
    "use strict";

    // Стан додатку
    const state = {
        labNumber: 1,
        studentName: "",
        studentGroup: "ПЗ-24-1/9",
        studentTeacher: "Логвіненко В.В.",
        reportYear: "2026 – 2027 н.р.",
        discipline: "",
        cipher: "",
        labTheme: "",
        labGoal: "",
        labEquipment: "",
        tasks: [],
        questions: [],
        conclusionText: ""
    };

    const STORAGE_KEY = "lab_report_generator_state_v3";
    let autoSaveTimer = null;

    // DOM Елементи
    const dom = {
        studentName: document.getElementById("studentName"),
        studentGroup: document.getElementById("studentGroup"),
        studentTeacher: document.getElementById("studentTeacher"),
        reportYear: document.getElementById("reportYear"),
        labTitleDisplay: document.getElementById("labTitleDisplay"),
        labNumberInput: document.getElementById("labNumberInput"),
        disciplineInput: document.getElementById("disciplineInput"),
        cipherInput: document.getElementById("cipherInput"),
        labTheme: document.getElementById("labTheme"),
        labGoal: document.getElementById("labGoal"),
        labEquipment: document.getElementById("labEquipment"),
        tasksContainer: document.getElementById("tasksContainer"),
        questionsContainer: document.getElementById("questionsContainer"),
        btnAddQuestion: document.getElementById("btnAddQuestion"),
        btnAddQuestionBottom: document.getElementById("btnAddQuestionBottom"),
        questionImportPanel: document.getElementById("questionImportPanel"),
        questionListInput: document.getElementById("questionListInput"),
        btnImportQuestionList: document.getElementById("btnImportQuestionList"),
        conclusionText: document.getElementById("conclusionText"),
        btnAddCustomTask: document.getElementById("btnAddCustomTask"),
        btnAutoConclusion: document.getElementById("btnAutoConclusion"),
        btnOpenPreview: document.getElementById("btnOpenPreview"),
        btnGenerateDocx: document.getElementById("btnGenerateDocx"),
        btnGenerateFromPreview: document.getElementById("btnGenerateFromPreview"),
        previewModal: document.getElementById("previewModal"),
        previewContainer: document.getElementById("previewContainer"),
        btnClosePreview: document.getElementById("btnClosePreview"),
        btnClosePreviewBottom: document.getElementById("btnClosePreviewBottom"),
        successModal: document.getElementById("successModal"),
        successFileNameDisplay: document.getElementById("successFileNameDisplay"),
        btnCloseSuccess: document.getElementById("btnCloseSuccess"),
        btnNewReport: document.getElementById("btnNewReport"),
        btnExportDraft: document.getElementById("btnExportDraft"),
        btnImportDraft: document.getElementById("btnImportDraft"),
        draftFileInput: document.getElementById("draftFileInput"),
        btnClearForm: document.getElementById("btnClearForm"),
        saveStatusIndicator: document.getElementById("saveStatusIndicator"),
        workspaceWrapper: document.getElementById("workspaceWrapper"),
        livePreviewPane: document.getElementById("livePreviewPane"),
        livePreviewViewport: document.getElementById("livePreviewViewport"),
        livePreviewScaler: document.getElementById("livePreviewScaler"),
        livePreviewContent: document.getElementById("livePreviewContent"),
        btnToggleSplitView: document.getElementById("btnToggleSplitView"),
        btnFloatingPreview: document.getElementById("btnFloatingPreview"),
        btnZoomIn: document.getElementById("btnZoomIn"),
        btnZoomOut: document.getElementById("btnZoomOut"),
        btnZoomFit: document.getElementById("btnZoomFit"),
        zoomBadge: document.getElementById("zoomBadge"),
        btnLiveDocx: document.getElementById("btnLiveDocx"),
        splitViewIcon: document.getElementById("splitViewIcon"),
        splitViewText: document.getElementById("splitViewText"),
        appDialog: document.getElementById("appDialog"),
        appDialogIcon: document.getElementById("appDialogIcon"),
        appDialogTitle: document.getElementById("appDialogTitle"),
        appDialogMessage: document.getElementById("appDialogMessage"),
        appDialogCancel: document.getElementById("appDialogCancel"),
        appDialogConfirm: document.getElementById("appDialogConfirm"),
        appNoticeStack: document.getElementById("appNoticeStack")
    };

    const AUTO_GROW_TEXTAREA_SELECTOR = "textarea.form-control, textarea.code-editor-textarea";

    function resizeTextArea(textarea) {
        if (!(textarea instanceof HTMLTextAreaElement)) return;

        if (!textarea.dataset.minAutoHeight) {
            textarea.dataset.minAutoHeight = String(textarea.offsetHeight);
        }

        textarea.style.height = "auto";
        textarea.style.height = `${Math.max(textarea.scrollHeight, Number(textarea.dataset.minAutoHeight))}px`;
    }

    function resizeReportTextAreas(scope = document) {
        scope.querySelectorAll(AUTO_GROW_TEXTAREA_SELECTOR).forEach(resizeTextArea);
    }

    function showAppNotice(message, type = "info") {
        if (!dom.appNoticeStack) return;

        const icons = { success: "✓", error: "!", info: "i" };
        const notice = document.createElement("div");
        notice.className = `app-notice app-notice-${type}`;
        notice.setAttribute("role", type === "error" ? "alert" : "status");

        const icon = document.createElement("span");
        icon.className = "app-notice-icon";
        icon.textContent = icons[type] || icons.info;
        const text = document.createElement("span");
        text.className = "app-notice-text";
        text.textContent = message;
        const close = document.createElement("button");
        close.type = "button";
        close.className = "app-notice-close";
        close.setAttribute("aria-label", "Закрити повідомлення");
        close.textContent = "×";

        const dismiss = () => {
            notice.classList.remove("visible");
            setTimeout(() => notice.remove(), 180);
        };

        close.addEventListener("click", dismiss);
        notice.append(icon, text, close);
        dom.appNoticeStack.appendChild(notice);
        requestAnimationFrame(() => notice.classList.add("visible"));
        setTimeout(dismiss, type === "error" ? 6500 : 3600);
    }

    function showAppConfirm({ title, message, confirmLabel = "Продовжити", tone = "primary" }) {
        return new Promise((resolve) => {
            if (!dom.appDialog) {
                resolve(false);
                return;
            }

            const isDanger = tone === "danger";
            dom.appDialogIcon.textContent = isDanger ? "!" : "?";
            dom.appDialogIcon.className = `app-dialog-icon ${isDanger ? "danger" : ""}`;
            dom.appDialogTitle.textContent = title;
            dom.appDialogMessage.textContent = message;
            dom.appDialogConfirm.textContent = confirmLabel;
            dom.appDialogConfirm.classList.toggle("btn-danger-dialog", isDanger);
            dom.appDialog.classList.add("active");

            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                dom.appDialog.classList.remove("active");
                dom.appDialogConfirm.onclick = null;
                dom.appDialogCancel.onclick = null;
                document.removeEventListener("keydown", onKeyDown);
                resolve(value);
            };
            const onKeyDown = (event) => {
                if (event.key === "Escape") finish(false);
            };

            dom.appDialogConfirm.onclick = () => finish(true);
            dom.appDialogCancel.onclick = () => finish(false);
            document.addEventListener("keydown", onKeyDown);
            requestAnimationFrame(() => dom.appDialogConfirm.focus());
        });
    }

    // Ініціалізація
    async function init() {
        const hasLoadedSaved = loadFromStorage();
        if (!hasLoadedSaved) {
            loadInitialDefaults(false);
        }

        // Відновлення налаштувань режиму розділеного екрану
        if (dom.workspaceWrapper) {
            const savedSplit = localStorage.getItem("reportsSplitView");
            if (savedSplit === "single") {
                dom.workspaceWrapper.classList.add("single-column");
                if (dom.btnToggleSplitView) dom.btnToggleSplitView.setAttribute("aria-pressed", "false");
                if (dom.splitViewText) dom.splitViewText.textContent = "Показати перегляд";
            }
        }

        bindEvents();
        resizeReportTextAreas();
        document.addEventListener("input", (event) => {
            if (event.target.matches(AUTO_GROW_TEXTAREA_SELECTOR)) {
                resizeTextArea(event.target);
            }
        });
        triggerLivePreview();
        setTimeout(fitZoom, 200);
    }

    // Початкові дані за замовчуванням
    function loadInitialDefaults(resetStudentData = false) {
        state.labNumber = 1;
        state.discipline = "";
        state.cipher = "";
        state.labTheme = "";
        state.labGoal = "";
        state.labEquipment = "";

        if (resetStudentData) {
            state.studentName = "";
            state.studentGroup = "ПЗ-24-1/9";
            state.studentTeacher = "";
            state.reportYear = "2026 – 2027 н.р.";

            dom.studentName.value = "";
            dom.studentGroup.value = state.studentGroup;
            dom.studentTeacher.value = state.studentTeacher;
            dom.reportYear.value = state.reportYear;
        }

        dom.labNumberInput.value = state.labNumber;
        dom.labTitleDisplay.textContent = `Лабораторна робота №${state.labNumber}`;
        dom.disciplineInput.value = state.discipline;
        dom.cipherInput.value = state.cipher;
        dom.labTheme.value = state.labTheme;
        dom.labGoal.value = state.labGoal;
        dom.labEquipment.value = state.labEquipment;

        state.tasks = [];
        state.questions = [];
        state.conclusionText = "";
        dom.conclusionText.value = state.conclusionText;

        renderTasks();
        renderQuestions();
        triggerAutoSave();
    }

    let blockEditor = null;
    function renderTasks() {
        if (!blockEditor) blockEditor = window.ReportBlocks.editor({
            container: dom.tasksContainer, getItems: () => state.tasks,
            onChange: triggerAutoSave, confirm: window.ReportDeleteConfirm.request, notice: showAppNotice,
            resize: resizeReportTextAreas
        });
        blockEditor.render();
        triggerLivePreview();
    }

    function addNewQuestion() {
        const nextNum = (state.questions && state.questions.length > 0) ? state.questions.length + 1 : 1;
        if (!state.questions) state.questions = [];
        state.questions.push({
            id: nextNum,
            question: "",
            answer: ""
        });
        renderQuestions();
        triggerAutoSave();

        setTimeout(() => {
            const inputs = dom.questionsContainer.querySelectorAll(".question-title-input");
            if (inputs.length > 0) {
                const last = inputs[inputs.length - 1];
                last.focus();
                last.setSelectionRange(last.value.length, last.value.length);
            }
        }, 50);
    }

    function questionText(text) {
        // Strip copied list markers, not meaningful numbers such as "32 біти" or "3.14".
        return String(text || "").trim().replace(/^\d+[.)](?:\s+|$)/u, "").trim();
    }

    function numberedQuestion(question, index) {
        return `${index + 1} ${questionText(question) || "(Запитання не заповнено)"}`;
    }

    function parseQuestionLines(text) {
        return text.split(/\r\n|[\n\r\u2028\u2029]/).map(questionText).filter(Boolean);
    }

    function focusQuestion(index) {
        const input = dom.questionsContainer.querySelector(`.question-title-input[data-index="${index}"]`);
        if (input) {
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
        }
    }

    function importQuestionList() {
        const lines = parseQuestionLines(dom.questionListInput.value);
        if (!lines.length) {
            showAppNotice("Вставте список питань — одне на рядок.", "info");
            dom.questionListInput.focus();
            return;
        }
        const firstIndex = state.questions.length;
        state.questions.push(...lines.map(question => ({ question, answer: "" })));
        renderQuestions();
        triggerAutoSave();
        dom.questionListInput.value = "";
        resizeTextArea(dom.questionListInput);
        dom.questionImportPanel.open = false;
        focusQuestion(firstIndex);
        showAppNotice(`Додано питань: ${lines.length}.`, "success");
    }

    function pasteQuestionList(event) {
        const text = event.clipboardData?.getData("text/plain") || "";
        if (parseQuestionLines(text).length < 2) return;
        const input = event.currentTarget;
        const index = Number(input.dataset.index);
        const current = state.questions[index];
        if (!current) return;
        // Respect the selection just like a normal paste; keep the existing answer.
        const combined = input.value.slice(0, input.selectionStart) + text + input.value.slice(input.selectionEnd);
        const lines = parseQuestionLines(combined);
        event.preventDefault();
        event.stopPropagation();
        current.question = lines[0];
        state.questions.splice(index + 1, 0, ...lines.slice(1).map(question => ({ question, answer: "" })));
        renderQuestions();
        triggerAutoSave();
        focusQuestion(index + lines.length - 1);
    }

    function renderQuestions() {
        dom.questionsContainer.innerHTML = "";

        if (!state.questions || state.questions.length === 0) {
            dom.questionsContainer.innerHTML = `
                <div class="empty-questions-box">
                    <p style="margin-bottom: 0.75rem; font-size: 0.9rem;">Контрольні запитання наразі відсутні.</p>
                    <button type="button" class="btn btn-secondary btn-sm" id="btnEmptyAddQuestion">
                        + Додати перше контрольне питання
                    </button>
                </div>
            `;
            const btnEmpty = dom.questionsContainer.querySelector("#btnEmptyAddQuestion");
            if (btnEmpty) {
                btnEmpty.addEventListener("click", addNewQuestion);
            }
            return;
        }

        state.questions.forEach((q, index) => {
            const qDiv = document.createElement("div");
            qDiv.className = "question-item";
            qDiv.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.45rem;">
                    <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-primary);">Запитання ${index + 1}:</label>
                    <button type="button" class="btn btn-danger-outline btn-sm btn-remove-question" data-index="${index}" style="padding: 0.15rem 0.55rem; font-size: 0.78rem;">Видалити</button>
                </div>
                <textarea class="form-control question-title-input" data-index="${index}" rows="1" aria-label="Запитання ${index + 1}" placeholder="Введіть формулювання без номера...">${escapeHtml(questionText(q.question))}</textarea>
                <div class="form-group" style="margin-top: 0.6rem;">
                    <label style="font-size: 0.8rem; color: var(--text-secondary);">Відповідь:</label>
                    <textarea class="form-control question-textarea" data-index="${index}" rows="2" placeholder="Введіть змістовну відповідь...">${escapeHtml(q.answer || "")}</textarea>
                </div>
            `;
            dom.questionsContainer.appendChild(qDiv);
        });

        // Слухач для редагування тексту запитання
        dom.questionsContainer.querySelectorAll(".question-title-input").forEach(input => {
            input.addEventListener("paste", pasteQuestionList);
            input.addEventListener("input", (e) => {
                const idx = parseInt(e.target.dataset.index, 10);
                if (state.questions[idx]) {
                    state.questions[idx].question = e.target.value;
                    triggerAutoSave();
                }
            });
        });

        // Слухач для відповідей
        dom.questionsContainer.querySelectorAll(".question-textarea").forEach(textarea => {
            textarea.addEventListener("input", (e) => {
                const idx = parseInt(e.target.dataset.index, 10);
                if (state.questions[idx]) {
                    state.questions[idx].answer = e.target.value;
                    triggerAutoSave();
                }
            });
        });

        // Слухач для видалення запитання
        dom.questionsContainer.querySelectorAll(".btn-remove-question").forEach(btn => {
            btn.addEventListener("click", async (event) => {
                const idx = parseInt(btn.dataset.index, 10);
                const question = state.questions[idx];
                if (!question || !await window.ReportDeleteConfirm.request({ anchor: btn, skipConfirmation: event.shiftKey, title: "Видалити запитання?", message: "Запитання та відповідь буде видалено." })) return;
                const currentIndex = state.questions.indexOf(question);
                if (currentIndex < 0) return;
                state.questions.splice(currentIndex, 1);
                renderQuestions();
                triggerAutoSave();
                (dom.questionsContainer.querySelector(".btn-remove-question") || dom.btnAddQuestion)?.focus();
            });
        });
        resizeReportTextAreas(dom.questionsContainer);
        triggerLivePreview();
    }

    function conclusionFromGoal(value) {
        const goal = String(value || "").trim()
            .replace(/^мета(?:\s+(?:лабораторної\s+)?роботи)?\s*[:—–-]\s*/iu, "")
            .replace(/\r\n?/g, "\n").split(/\n+/)
            .map(line => line.trim().replace(/^(?:[-•]|\d+[.)])\s+/u, "").replace(/[.;\s]+$/u, ""))
            .filter(Boolean).join("; ");
        if (!goal) return "";
        const forms = {
            "навчитися": "набуто вміння", "навчитись": "набуто вміння",
            "ознайомитися": "проведено ознайомлення", "ознайомитись": "проведено ознайомлення",
            "вивчити": "вивчено", "дослідити": "досліджено", "опанувати": "опановано",
            "освоїти": "освоєно", "закріпити": "закріплено", "отримати": "отримано",
            "набути": "набуто", "сформувати": "сформовано", "удосконалити": "удосконалено",
            "поглибити": "поглиблено", "розглянути": "розглянуто", "засвоїти": "засвоєно",
            "перевірити": "перевірено", "визначити": "визначено", "виконати": "виконано",
            "розробити": "розроблено", "реалізувати": "реалізовано", "створити": "створено"
        };
        // Convert goal clauses, not dependent infinitives ("навчитися створити програму").
        const starts = new RegExp(`(^|[;.!?]\\s+|,\\s+|\\s+(?:і|й|та|а також)\\s+)(${Object.keys(forms).join("|")})(?![\\p{L}\\p{N}_])`, "giu");
        const text = goal.replace(starts, (_, prefix, verb) => `${prefix}${forms[verb.toLocaleLowerCase("uk-UA")]}`);
        const beginsWithResult = Object.values(forms).some(form => text.startsWith(form));
        return beginsWithResult
            ? `У ході виконання лабораторної роботи було ${text}.`
            : `У ході виконання лабораторної роботи було опрацьовано тему: «${goal}».`;
    }

    async function fillConclusionFromGoal() {
        const formulated = conclusionFromGoal(dom.labGoal.value);
        if (!formulated) {
            showAppNotice("Спочатку заповніть мету роботи.", "info");
            dom.labGoal.focus();
            return;
        }
        if (dom.conclusionText.value.trim() && dom.conclusionText.value.trim() !== formulated) {
            const confirmed = await showAppConfirm({
                title: "Замінити висновок?",
                message: "Поточний текст буде замінено висновком, сформованим із мети роботи.",
                confirmLabel: "Замінити"
            });
            if (!confirmed) return;
        }
        dom.conclusionText.value = formulated;
        state.conclusionText = formulated;
        resizeTextArea(dom.conclusionText);
        triggerAutoSave();
    }

    function bindEvents() {
        dom.studentName.addEventListener("input", (e) => {
            state.studentName = e.target.value;
            triggerAutoSave();
        });
        dom.studentGroup.addEventListener("input", (e) => {
            state.studentGroup = e.target.value;
            triggerAutoSave();
        });
        dom.studentTeacher.addEventListener("input", (e) => {
            state.studentTeacher = e.target.value;
            triggerAutoSave();
        });
        dom.reportYear.addEventListener("input", (e) => {
            state.reportYear = e.target.value;
            triggerAutoSave();
        });

        dom.labNumberInput.addEventListener("input", (e) => {
            state.labNumber = parseInt(e.target.value, 10) || 1;
            dom.labTitleDisplay.textContent = `Лабораторна робота №${state.labNumber}`;
            triggerAutoSave();
        });

        dom.disciplineInput.addEventListener("input", (e) => {
            state.discipline = e.target.value;
            triggerAutoSave();
        });
        dom.cipherInput.addEventListener("input", (e) => {
            state.cipher = e.target.value;
            triggerAutoSave();
        });
        dom.labTheme.addEventListener("input", (e) => {
            state.labTheme = e.target.value;
            triggerAutoSave();
        });
        dom.labGoal.addEventListener("input", (e) => {
            state.labGoal = e.target.value;
            triggerAutoSave();
        });
        dom.labEquipment.addEventListener("input", (e) => {
            state.labEquipment = e.target.value;
            triggerAutoSave();
        });

        dom.conclusionText.addEventListener("input", (e) => {
            state.conclusionText = e.target.value;
            triggerAutoSave();
        });

        dom.btnAutoConclusion.addEventListener("click", fillConclusionFromGoal);

        dom.btnAddCustomTask.addEventListener("click", () => blockEditor.open());

        if (dom.btnAddQuestion) {
            dom.btnAddQuestion.addEventListener("click", addNewQuestion);
        }
        if (dom.btnAddQuestionBottom) {
            dom.btnAddQuestionBottom.addEventListener("click", addNewQuestion);
        }
        dom.btnImportQuestionList.addEventListener("click", importQuestionList);

        dom.btnOpenPreview.addEventListener("click", openPreview);
        dom.btnClosePreview.addEventListener("click", closePreview);
        dom.btnClosePreviewBottom.addEventListener("click", closePreview);
        dom.previewModal.addEventListener("click", (e) => {
            if (e.target === dom.previewModal) closePreview();
        });

        dom.btnGenerateDocx.addEventListener("click", () => generateDocxDocument());
        dom.btnGenerateFromPreview.addEventListener("click", () => {
            closePreview();
            generateDocxDocument();
        });

        dom.btnCloseSuccess.addEventListener("click", () => dom.successModal.classList.remove("active"));
        dom.btnNewReport.addEventListener("click", async (event) => {
            const confirmed = await window.ReportDeleteConfirm.request({
                anchor: dom.btnNewReport, skipConfirmation: event.shiftKey,
                title: "Створити новий звіт?",
                message: "Поточні дані форми буде очищено.",
                confirmLabel: "Створити",
                tone: "danger"
            });
            if (confirmed) {
                dom.successModal.classList.remove("active");
                clearAllData();
                dom.studentName.focus();
            }
        });

        dom.btnExportDraft.addEventListener("click", exportDraft);
        dom.btnImportDraft.addEventListener("click", () => dom.draftFileInput.click());
        dom.draftFileInput.addEventListener("change", importDraft);

        dom.btnClearForm.addEventListener("click", async (event) => {
            const confirmed = await window.ReportDeleteConfirm.request({
                anchor: dom.btnClearForm, skipConfirmation: event.shiftKey,
                title: "Очистити форму?",
                message: "Будуть видалені введені дані, завдання та додані зображення.",
                confirmLabel: "Очистити",
                tone: "danger"
            });
            if (confirmed) {
                clearAllData();
            }
        });

        // Слухачі для живого перегляду праворуч
        if (dom.btnToggleSplitView) {
            dom.btnToggleSplitView.addEventListener("click", toggleSplitView);
        }
        if (dom.btnFloatingPreview) {
            dom.btnFloatingPreview.addEventListener("click", () => {
                if (dom.livePreviewPane) {
                    dom.livePreviewPane.scrollIntoView({ behavior: "smooth" });
                }
            });
        }
        if (dom.btnZoomIn) {
            dom.btnZoomIn.addEventListener("click", () => applyZoom(currentZoom + 0.08));
        }
        if (dom.btnZoomOut) {
            dom.btnZoomOut.addEventListener("click", () => applyZoom(currentZoom - 0.08));
        }
        if (dom.btnZoomFit) {
            dom.btnZoomFit.addEventListener("click", fitZoom);
        }
        if (dom.btnLiveDocx) {
            dom.btnLiveDocx.addEventListener("click", () => generateDocxDocument());
        }

        window.addEventListener("resize", () => {
            if (autoFitZoom) {
                fitZoom();
            }
        });
    }

    function setSaveStatus(text, statusType = "saved") {
        if (!dom.saveStatusIndicator) return;
        const textEl = dom.saveStatusIndicator.querySelector(".save-status-text");
        if (textEl) {
            textEl.textContent = text;
        } else {
            dom.saveStatusIndicator.textContent = text;
        }

        if (statusType === "saved") {
            dom.saveStatusIndicator.classList.remove("saving");
            dom.saveStatusIndicator.classList.add("saved");
        } else if (statusType === "saving") {
            dom.saveStatusIndicator.classList.remove("saved");
            dom.saveStatusIndicator.classList.add("saving");
        } else {
            dom.saveStatusIndicator.classList.remove("saved", "saving");
        }
    }

    function triggerAutoSave() {
        triggerLivePreview();

        setSaveStatus("Збереження...", "saving");

        clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(() => {
            const saved = saveToStorage();
            setSaveStatus(saved ? "Збережено локально" : "Не збережено — експортуйте чернетку", saved ? "saved" : "neutral");
        }, 350);
    }

    function saveToStorage() {
        try {
            const dataToSave = {
                labNumber: state.labNumber,
                studentName: state.studentName,
                studentGroup: state.studentGroup,
                studentTeacher: state.studentTeacher,
                reportYear: state.reportYear,
                discipline: state.discipline,
                cipher: state.cipher,
                labTheme: state.labTheme,
                labGoal: state.labGoal,
                labEquipment: state.labEquipment,
                tasks: state.tasks,
                questions: state.questions,
                conclusionText: state.conclusionText
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
            return true;
        } catch (err) {
            console.warn("Помилка збереження у localStorage:", err);
            return false;
        }
    }

    function loadFromStorage() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return false;
            const saved = JSON.parse(raw);
            if (!saved) return false;

            state.labNumber = saved.labNumber || 1;
            state.studentName = saved.studentName || "";
            state.studentGroup = saved.studentGroup || "ПЗ-24-1/9";
            state.studentTeacher = saved.studentTeacher ?? "викладач Логвіненко В.В.";
            state.reportYear = saved.reportYear || "2026 – 2027 н.р.";
            state.discipline = saved.discipline ?? "ОБ’ЄКТНО-ОРІЄНТОВАНЕ ПРОГРАМУВАННЯ";
            state.cipher = saved.cipher ?? "ФКЗЕ. 121ООП12. 01ЛР / ФКЗЕ. F2ПЗ24. 01ЛР";
            state.labTheme = saved.labTheme || "";
            state.labGoal = saved.labGoal || "";
            state.labEquipment = saved.labEquipment || "";
            state.tasks = window.ReportBlocks.normalize(saved.tasks);
            if (typeof saved.workSequenceText === "string" && saved.workSequenceText.trim()) {
                state.tasks.unshift(window.ReportBlocks.create("text", { text: saved.workSequenceText }));
            }
            state.questions = saved.questions || [];
            state.conclusionText = saved.conclusionText || "";

            dom.studentName.value = state.studentName;
            dom.studentGroup.value = state.studentGroup;
            dom.studentTeacher.value = state.studentTeacher;
            dom.reportYear.value = state.reportYear;
            dom.labNumberInput.value = state.labNumber;
            dom.labTitleDisplay.textContent = `Лабораторна робота №${state.labNumber}`;
            dom.disciplineInput.value = state.discipline;
            dom.cipherInput.value = state.cipher;
            dom.labTheme.value = state.labTheme;
            dom.labGoal.value = state.labGoal;
            dom.labEquipment.value = state.labEquipment;
            dom.conclusionText.value = state.conclusionText;

            renderTasks();
            renderQuestions();
            resizeReportTextAreas();
            setSaveStatus("Збережено локально", "saved");
            return true;
        } catch (err) {
            console.error("Помилка читання localStorage:", err);
            return false;
        }
    }

    function clearAllData() {
        clearTimeout(autoSaveTimer);
        localStorage.removeItem(STORAGE_KEY);
        loadInitialDefaults(true);
        setSaveStatus("Форма очищена", "neutral");
        showAppNotice("Форму очищено. Можна починати новий звіт.", "success");
        setTimeout(() => {
            setSaveStatus("Збережено локально", "saved");
        }, 1500);
    }

    function exportDraft() {
        const draftObj = {
            version: 4,
            exportDate: new Date().toISOString(),
            state: state
        };
        const blob = new Blob([JSON.stringify(draftObj, null, 2)], { type: "application/json" });
        const filename = getDocxFileName().replace(".docx", "_чернетка.json");
        downloadBlob(blob, filename);
    }

    function importDraft(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const parsed = JSON.parse(event.target.result);
                const loadedState = parsed.state || parsed;

                if (!loadedState || typeof loadedState !== "object" || Array.isArray(loadedState)) throw new Error("Невірний формат чернетки");
                const blocks = window.ReportBlocks.normalize(loadedState.tasks);
                for (const key of Object.keys(state)) {
                    if (["tasks", "questions"].includes(key)) continue;
                    if (key === "labNumber") state[key] = Number(loadedState[key]) || 1;
                    else state[key] = typeof loadedState[key] === "string" ? loadedState[key] : "";
                }
                state.tasks = blocks;
                if (typeof loadedState.workSequenceText === "string" && loadedState.workSequenceText.trim()) {
                    state.tasks.unshift(window.ReportBlocks.create("text", { text: loadedState.workSequenceText }));
                }
                state.questions = Array.isArray(loadedState.questions) ? loadedState.questions.filter(q => q && typeof q === "object").map((q, i) => ({
                    id: i + 1, question: typeof q.question === "string" ? q.question : "", answer: typeof q.answer === "string" ? q.answer : ""
                })) : [];
                delete state.includeEmblem; // Ignore this retired option in older drafts.

                dom.studentName.value = state.studentName || "";
                dom.studentGroup.value = state.studentGroup || "";
                dom.studentTeacher.value = state.studentTeacher || "";
                dom.reportYear.value = state.reportYear || "2026 – 2027 н.р.";
                dom.labNumberInput.value = state.labNumber || 1;
                dom.labTitleDisplay.textContent = `Лабораторна робота №${state.labNumber || 1}`;
                dom.disciplineInput.value = state.discipline || "";
                dom.cipherInput.value = state.cipher || "";
                dom.labTheme.value = state.labTheme || "";
                dom.labGoal.value = state.labGoal || "";
                dom.labEquipment.value = state.labEquipment || "";
                dom.conclusionText.value = state.conclusionText || "";

                renderTasks();
                renderQuestions();
                resizeReportTextAreas();
                triggerAutoSave();
                showAppNotice("Чернетку успішно завантажено.", "success");
            } catch (err) {
                showAppNotice("Не вдалося прочитати чернетку: " + err.message, "error");
            }
        };
        reader.readAsText(file);
        dom.draftFileInput.value = "";
    }

    // =========================================================================
    // ПОПЕРЕДНІЙ ПЕРЕГЛЯД ТА LIVE REAL-TIME RENDERER (A4 PREVIEW)
    // РІК ЗНАХОДИТЬСЯ СТРОГО ВНИЗУ ПО СЕРЕДИНІ СТОРІНКИ
    // =========================================================================
    function generateReportPreviewHtml() {

        let html = `
            <div class="preview-page">
                <!-- ТИТУЛЬНИЙ АРКУШ (без номера сторінки) -->
                <div class="preview-title-section">
                    <div class="preview-title-top">
                        <div style="font-weight: bold;">Міністерство освіти і науки України</div>
                        <div style="margin-top: 6px;">Фаховий коледж зварювання та електроніки імені Є.О. Патона</div>
                    </div>

                    <div style="height: 110px;"></div>

                    <div class="preview-title-middle" style="margin: 1.5rem 0;">
                        <h2>ЗВІТ</h2>
                        <h3>З ЛАБОРАТОРНОЇ РОБОТИ №${state.labNumber || 1}</h3>
                        <div style="margin: 0.5rem 0; font-size: 14pt;">навчальної дисципліни</div>
                        <h3 style="text-transform: uppercase;">${escapeHtml(state.discipline || 'ДИСЦИПЛІНА')}</h3>
                        <div class="cipher" style="margin-top: 0.6rem; font-size: 14pt;">${escapeHtml(state.cipher || '________________________')}</div>
                    </div>

                    <!-- Блок студента (відступ зліва 8.5 см з лініями підкреслення) -->
                    <div class="preview-student-box">
                        <div class="field-row">
                            <span class="field-label">Студент &nbsp;&nbsp;&nbsp;&nbsp;</span>
                            <span class="field-val">${escapeHtml(state.studentName || '________________________')}</span>
                        </div>
                        <div class="field-row">
                            <span class="field-label">Група &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
                            <span class="field-val">${escapeHtml(state.studentGroup || '________________________')}</span>
                        </div>
                        <div class="field-row">
                            <span class="field-label">Перевірив &nbsp;</span>
                            <span class="field-val">${escapeHtml(state.studentTeacher || '________________________')}</span>
                        </div>
                    </div>

                    <!-- Рік строго внизу по середині титульної сторінки -->
                    <div class="preview-title-bottom">
                        ${escapeHtml(state.reportYear || '2026 – 2027 н.р.')}
                    </div>
                </div>

                <div class="preview-page-break-divider"></div>

                <!-- СТОРІНКА 2 (Номер сторінки справа в кутку) -->
                <div class="preview-page-number">2</div>

                <div class="preview-para">
                    <b>Тема роботи:</b> ${escapeHtml(state.labTheme || '')}
                </div>
                <div class="preview-para">
                    <b>Мета роботи:</b> ${escapeHtml(state.labGoal || '')}
                </div>
                <div class="preview-para">
                    <b>Обладнання:</b> ${escapeHtml(state.labEquipment || '')}
                </div>

                <div class="preview-heading-center" style="margin-top: 1.5rem;">
                    Хід роботи
                </div>
        `;

        html += window.ReportBlocks.preview(state.tasks);

        // Відповіді на контрольні питання
        if (state.questions && state.questions.length > 0) {
            html += `
                <div class="preview-heading-center" style="margin-top: 2rem; font-weight: bold;">
                    Відповіді на контрольні питання
                </div>
            `;

            state.questions.forEach((q, index) => {
                html += `
                    <div class="preview-para" style="font-weight: normal; margin-top: 0.6rem;">
                        ${escapeHtml(numberedQuestion(q.question, index))}
                    </div>
                    <div class="preview-para">
                        <b>Відповідь:</b> ${escapeHtml(q.answer || "(Відповідь не заповнено)")}
                    </div>
                `;
            });
        }

        // Висновок
        let cleanConclusion = (state.conclusionText || "").trim();
        if (cleanConclusion.toLowerCase().startsWith("висновок:")) {
            cleanConclusion = cleanConclusion.substring("висновок:".length).trim();
        } else if (cleanConclusion.toLowerCase().startsWith("висновок -")) {
            cleanConclusion = cleanConclusion.substring("висновок -".length).trim();
        }

        html += `
            <div class="preview-para" style="margin-top: 1.5rem;">
                <b>Висновок:</b> ${escapeHtml(cleanConclusion || '')}
            </div>
        `;

        html += `</div>`;
        return html;
    }

    function openPreview() {
        dom.previewContainer.innerHTML = generateReportPreviewHtml();
        dom.previewModal.classList.add("active");
    }

    // =========================================================================
    // LIVE PREVIEW REAL-TIME ENGINE
    // =========================================================================
    let livePreviewTimer = null;
    let livePreviewDebounce = null;
    let currentZoom = 0.72;
    let autoFitZoom = true;

    function triggerLivePreview(immediate = false) {
        if (!dom.livePreviewContent) return;
        if (livePreviewDebounce) clearTimeout(livePreviewDebounce);
        if (livePreviewTimer) cancelAnimationFrame(livePreviewTimer);

        const render = () => {
            livePreviewTimer = requestAnimationFrame(() => {
                dom.livePreviewContent.innerHTML = generateReportPreviewHtml();
                if (autoFitZoom) {
                    fitZoom();
                } else {
                    adjustScalerHeight();
                }
            });
        };

        if (immediate) {
            render();
        } else {
            // 350ms debounce eliminates synchronous layout thrashing and prevents caret freezing while typing
            livePreviewDebounce = setTimeout(render, 350);
        }
    }

    function adjustScalerHeight() {
        if (!dom.livePreviewScaler || !dom.livePreviewContent) return;
        const unscaledHeight = dom.livePreviewContent.offsetHeight;
        dom.livePreviewScaler.style.height = `${unscaledHeight}px`;
        dom.livePreviewScaler.style.marginBottom = `${(unscaledHeight * currentZoom - unscaledHeight)}px`;
    }

    function calculateFitZoom() {
        if (!dom.livePreviewViewport) return 0.72;
        const availableWidth = dom.livePreviewViewport.clientWidth - 28;
        const targetWidth = 800; // standard width of .preview-page
        let scale = availableWidth / targetWidth;
        if (scale > 1) scale = 1;
        if (scale < 0.35) scale = 0.35;
        return parseFloat(scale.toFixed(2));
    }

    function applyZoom(newZoom, isAuto = false) {
        if (newZoom !== undefined) currentZoom = newZoom;
        if (!isAuto) autoFitZoom = false;
        currentZoom = Math.max(0.3, Math.min(1.4, currentZoom));

        if (dom.livePreviewScaler) {
            dom.livePreviewScaler.style.transform = `scale(${currentZoom})`;
            adjustScalerHeight();
        }
        if (dom.zoomBadge) {
            dom.zoomBadge.textContent = `${Math.round(currentZoom * 100)}%`;
        }
    }

    function fitZoom() {
        autoFitZoom = true;
        const fitScale = calculateFitZoom();
        applyZoom(fitScale, true);
    }

    function toggleSplitView() {
        if (!dom.workspaceWrapper) return;
        const isCurrentlySingle = dom.workspaceWrapper.classList.contains("single-column");
        if (isCurrentlySingle) {
            dom.workspaceWrapper.classList.remove("single-column");
            if (dom.btnToggleSplitView) dom.btnToggleSplitView.setAttribute("aria-pressed", "true");
            if (dom.splitViewText) dom.splitViewText.textContent = "Перегляд наживо";
            localStorage.setItem("reportsSplitView", "split");
            triggerLivePreview();
            setTimeout(fitZoom, 150);
        } else {
            dom.workspaceWrapper.classList.add("single-column");
            if (dom.btnToggleSplitView) dom.btnToggleSplitView.setAttribute("aria-pressed", "false");
            if (dom.splitViewText) dom.splitViewText.textContent = "Показати перегляд";
            localStorage.setItem("reportsSplitView", "single");
        }
    }

    function closePreview() {
        dom.previewModal.classList.remove("active");
    }

    function getDocxFileName() {
        const labPrefix = `ЛР${state.labNumber || 1}`;

        if (!state.studentName || state.studentName.trim().length === 0) {
            return `${labPrefix}_Звіт.docx`;
        }

        const parts = state.studentName.trim().split(/\s+/);
        const surname = parts[0];
        let initials = "";
        if (parts.length > 1) {
            initials += "_" + parts.slice(1).map(p => p[0].toUpperCase()).join("");
        }
        const cleanSurname = surname.replace(/[/\\?%*:|"<>]/g, "");
        return `${labPrefix}_${cleanSurname}${initials}.docx`;
    }

    // =========================================================================
    // ГЕНЕРАЦІЯ DOCX З РІЧНОЮ МІТКОЮ СТРОГО ВНИЗУ
    // =========================================================================
    async function generateDocxDocument() {
        if (!window.docx) {
            showAppNotice("Бібліотека DOCX ще не завантажена. Оновіть сторінку та спробуйте знову.", "error");
            return;
        }

        if (!state.studentName || state.studentName.trim().length === 0) {
            const proceed = await showAppConfirm({
                title: "ПІБ студента не вказано",
                message: "Сформувати звіт із порожнім полем, щоб заповнити його вручну?",
                confirmLabel: "Сформувати"
            });
            if (!proceed) {
                dom.studentName.focus();
                return;
            }
        }

        try {
        const {
            Document, Paragraph, TextRun, ImageRun, PageBreak,
            AlignmentType, LineRuleType, Footer, PageNumber, UnderlineType
        } = window.docx;

        const children = [];

        // -------------------------------------------------------------
        // ТИТУЛЬНИЙ АРКУШ
        // -------------------------------------------------------------

        // 1. Міністерство освіти і науки України (14 Times Roman всі жирні, по центру)
        children.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { line: 360, lineRule: LineRuleType.AUTO, after: 0 },
            children: [
                new TextRun({
                    text: "Міністерство освіти і науки України",
                    font: "Times New Roman",
                    size: 28,
                    bold: true
                })
            ]
        }));

        // 2. Фаховий коледж... (14 Times Roman, по центру)
        children.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { line: 360, lineRule: LineRuleType.AUTO, after: 0 },
            children: [
                new TextRun({
                    text: "Фаховий коледж зварювання та електроніки імені Є.О. Патона",
                    font: "Times New Roman",
                    size: 28
                })
            ]
        }));

        // 3. Відступ: 5 Enter (1,5 інтервал, вирівнювання по центру)
        for (let e = 0; e < 5; e++) {
            children.push(createEmptyParagraph());
        }

        // 4. ЗВІТ (14 Times New Roman всі заглавні, по центру)
        children.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { line: 360, lineRule: LineRuleType.AUTO, after: 0 },
            children: [
                new TextRun({
                    text: "ЗВІТ",
                    font: "Times New Roman",
                    size: 28,
                    bold: true
                })
            ]
        }));

        // 5. З ЛАБОРАТОРНОЇ РОБОТИ №X (Enter 1,5 інтервал, 14 Times New Roman всі заглавні)
        children.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { line: 360, lineRule: LineRuleType.AUTO, before: 60, after: 0 },
            children: [
                new TextRun({
                    text: `З ЛАБОРАТОРНОЇ РОБОТИ №${state.labNumber || 1}`,
                    font: "Times New Roman",
                    size: 28,
                    bold: true
                })
            ]
        }));

        // 6. навчальної дисципліни (Enter 1,5 інтервал, 14 Times Roman всі маленькі)
        children.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { line: 360, lineRule: LineRuleType.AUTO, before: 60, after: 0 },
            children: [
                new TextRun({
                    text: "навчальної дисципліни",
                    font: "Times New Roman",
                    size: 28
                })
            ]
        }));

        // 7. НАЗВА ДИСЦИПЛІНИ (14 Times Roman всі заглавні, без крапки вкінці та лапок)
        const cleanDiscipline = (state.discipline || "ДИСЦИПЛІНА").replace(/[«»"]/g, "").trim();
        children.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { line: 360, lineRule: LineRuleType.AUTO, after: 0 },
            children: [
                new TextRun({
                    text: cleanDiscipline.toUpperCase(),
                    font: "Times New Roman",
                    size: 28,
                    bold: true
                })
            ]
        }));

        // 8. Шифр
        children.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { line: 240, lineRule: LineRuleType.AUTO, before: 60, after: 0 },
            children: [
                new TextRun({
                    text: state.cipher || "________________________",
                    font: "Times New Roman",
                    size: 28
                })
            ]
        }));

        // Відступ до блоку студента згідно примітки інструкції:
        let disciplineLines = 1;
        if (cleanDiscipline.length > 70) disciplineLines = 3;
        else if (cleanDiscipline.length > 35) disciplineLines = 2;

        const entersToStudent = disciplineLines === 1 ? 5 : (disciplineLines === 2 ? 4 : 3);
        for (let k = 0; k < entersToStudent; k++) {
            children.push(createEmptyParagraph());
        }

        // 9. Блок даних студента (відступ 8.5 см зліва)
        const sName = state.studentName || "________________________";
        const sGroup = state.studentGroup || "________________________";
        const sTeacher = state.studentTeacher || "________________________";

        children.push(new Paragraph({
            alignment: AlignmentType.LEFT,
            indent: { firstLine: 4820 },
            spacing: { line: 360, lineRule: LineRuleType.AUTO, after: 0 },
            children: [
                new TextRun({
                    text: "Студент    ",
                    font: "Times New Roman",
                    size: 28
                }),
                new TextRun({
                    text: sName,
                    font: "Times New Roman",
                    size: 28,
                    underline: state.studentName ? { type: UnderlineType.SINGLE } : undefined
                })
            ]
        }));

        children.push(new Paragraph({
            alignment: AlignmentType.LEFT,
            indent: { firstLine: 4820 },
            spacing: { line: 360, lineRule: LineRuleType.AUTO, after: 0 },
            children: [
                new TextRun({
                    text: "Група        ",
                    font: "Times New Roman",
                    size: 28
                }),
                new TextRun({
                    text: sGroup,
                    font: "Times New Roman",
                    size: 28,
                    underline: state.studentGroup ? { type: UnderlineType.SINGLE } : undefined
                })
            ]
        }));

        children.push(new Paragraph({
            alignment: AlignmentType.LEFT,
            indent: { firstLine: 4820 },
            spacing: { line: 360, lineRule: LineRuleType.AUTO, after: 0 },
            children: [
                new TextRun({
                    text: "Перевірив ",
                    font: "Times New Roman",
                    size: 28
                }),
                new TextRun({
                    text: sTeacher,
                    font: "Times New Roman",
                    size: 28,
                    underline: state.studentTeacher ? { type: UnderlineType.SINGLE } : undefined
                })
            ]
        }));

        // 10. РІК У САМОМУ НИЗУ СТОРІНКИ ПО СЕРЕДИНІ:
        // Використовуємо точний розрахунок twips щоб розмістити рік на останньому рядку аркуша А4
        let beforeYearTwips = 4800;
        if (disciplineLines === 2) beforeYearTwips = 4440;
        else if (disciplineLines === 3) beforeYearTwips = 4080;

        children.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: beforeYearTwips, line: 360, lineRule: LineRuleType.AUTO, after: 0 },
            children: [
                new TextRun({
                    text: state.reportYear || "2026 – 2027 н.р.",
                    font: "Times New Roman",
                    size: 28
                })
            ]
        }));

        // РОЗРИВ СТОРІНКИ ПІСЛЯ ТИТУЛКИ
        children.push(new Paragraph({
            children: [new PageBreak()]
        }));

        // -------------------------------------------------------------
        // ОСНОВНА ЧАСТИНА (СТОРІНКИ 2+)
        // Нумерація в правому нижньому кутку, на титулці відсутня
        // -------------------------------------------------------------

        children.push(new Paragraph({
            alignment: AlignmentType.BOTH,
            indent: { firstLine: 720 },
            spacing: { line: 360, lineRule: LineRuleType.AUTO, after: 0 },
            children: [
                new TextRun({ text: "Тема роботи: ", font: "Times New Roman", size: 28, bold: true }),
                new TextRun({ text: state.labTheme || "", font: "Times New Roman", size: 28 })
            ]
        }));

        children.push(new Paragraph({
            alignment: AlignmentType.BOTH,
            indent: { firstLine: 720 },
            spacing: { line: 360, lineRule: LineRuleType.AUTO, after: 0 },
            children: [
                new TextRun({ text: "Мета роботи: ", font: "Times New Roman", size: 28, bold: true }),
                new TextRun({ text: state.labGoal || "", font: "Times New Roman", size: 28 })
            ]
        }));

        children.push(new Paragraph({
            alignment: AlignmentType.BOTH,
            indent: { firstLine: 720 },
            spacing: { line: 360, lineRule: LineRuleType.AUTO, after: 0 },
            children: [
                new TextRun({ text: "Обладнання: ", font: "Times New Roman", size: 28, bold: true }),
                new TextRun({ text: state.labEquipment || "", font: "Times New Roman", size: 28 })
            ]
        }));

        // Хід роботи
        children.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { line: 360, lineRule: LineRuleType.AUTO, before: 180, after: 120 },
            children: [
                new TextRun({
                    text: "Хід роботи",
                    font: "Times New Roman",
                    size: 28,
                    bold: true
                })
            ]
        }));

        children.push(...await window.ReportBlocks.toDocx(state.tasks, window.docx, processImageForDocx));

        // Відповіді на контрольні питання
        if (state.questions && state.questions.length > 0) {
            children.push(new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { line: 360, lineRule: LineRuleType.AUTO, before: 200, after: 60 },
                children: [
                    new TextRun({
                        text: "Відповіді на контрольні питання",
                        font: "Times New Roman",
                        size: 28,
                        bold: true
                    })
                ]
            }));

            state.questions.forEach((q, index) => {
                children.push(new Paragraph({
                    alignment: AlignmentType.BOTH,
                    indent: { firstLine: 720 },
                    spacing: { line: 360, lineRule: LineRuleType.AUTO, before: 60, after: 0 },
                    children: [
                        new TextRun({
                            text: numberedQuestion(q.question, index),
                            font: "Times New Roman",
                            size: 28,
                            bold: false
                        })
                    ]
                }));

                const ansText = q.answer && q.answer.trim().length > 0 ? q.answer.trim() : "";
                children.push(new Paragraph({
                    alignment: AlignmentType.BOTH,
                    indent: { firstLine: 720 },
                    spacing: { line: 360, lineRule: LineRuleType.AUTO, after: 0 },
                    children: [
                        new TextRun({ text: "Відповідь: ", font: "Times New Roman", size: 28, bold: true }),
                        new TextRun({ text: ansText || " ", font: "Times New Roman", size: 28 })
                    ]
                }));
            });
        }

        // Висновок
        let cleanConclusionDocx = (state.conclusionText || "").trim();
        if (cleanConclusionDocx.toLowerCase().startsWith("висновок:")) {
            cleanConclusionDocx = cleanConclusionDocx.substring("висновок:".length).trim();
        } else if (cleanConclusionDocx.toLowerCase().startsWith("висновок -")) {
            cleanConclusionDocx = cleanConclusionDocx.substring("висновок -".length).trim();
        }

        children.push(new Paragraph({
            alignment: AlignmentType.BOTH,
            indent: { firstLine: 720 },
            spacing: { line: 360, lineRule: LineRuleType.AUTO, before: 180, after: 0 },
            children: [
                new TextRun({
                    text: "Висновок: ",
                    font: "Times New Roman",
                    size: 28,
                    bold: true
                }),
                new TextRun({
                    text: cleanConclusionDocx || " ",
                    font: "Times New Roman",
                    size: 28
                })
            ]
        }));

        const doc = new Document({
            sections: [
                {
                    properties: {
                        page: {
                            size: { width: 11906, height: 16838 },
                            margin: { top: 1134, bottom: 1134, left: 1418, right: 567 }
                        },
                        titlePage: true
                    },
                    footers: {
                        first: new Footer({
                            children: []
                        }),
                        default: new Footer({
                            children: [
                                new Paragraph({
                                    alignment: AlignmentType.RIGHT,
                                    children: [
                                        new TextRun({
                                            children: [PageNumber.CURRENT],
                                            font: "Times New Roman",
                                            size: 28
                                        })
                                    ]
                                })
                            ]
                        })
                    },
                    children: children
                }
            ]
        });

            const blob = await window.docx.Packer.toBlob(doc);
            const filename = getDocxFileName();
            downloadBlob(blob, filename);

            dom.successFileNameDisplay.textContent = `Файл «${filename}» успішно згенеровано.`;
            dom.successModal.classList.add("active");
        } catch (err) {
            console.error("Помилка при створенні DOCX:", err);
            showAppNotice("Не вдалося сформувати документ: " + err.message, "error");
        }
    }

    function createEmptyParagraph() {
        return new window.docx.Paragraph({
            spacing: { line: 360, lineRule: window.docx.LineRuleType.AUTO, after: 0 },
            children: [new window.docx.TextRun({ text: "", font: "Times New Roman", size: 28 })]
        });
    }

    function processImageForDocx(dataUrl, maxWidthPx = 540, maxHeightPx = 420) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                if (width > maxWidthPx) {
                    height = Math.round((height * maxWidthPx) / width);
                    width = maxWidthPx;
                }
                if (height > maxHeightPx) {
                    width = Math.round((width * maxHeightPx) / height);
                    height = maxHeightPx;
                }

                const buffer = base64ToUint8Array(dataUrl);
                resolve({
                    buffer: buffer,
                    width: width,
                    height: height
                });
            };
            img.onerror = () => resolve(null);
            img.src = dataUrl;
        });
    }

    function base64ToUint8Array(base64String) {
        const parts = base64String.split(",");
        const base64 = parts.length > 1 ? parts[1] : parts[0];
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function escapeHtml(text) {
        if (!text) return "";
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
