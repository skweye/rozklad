/* Ordered report content. Shared model for the editor, preview and Word export. */
(function (root) {
    "use strict";
    const types = {
        text: ["Текст", "Пояснення, умова або опис результату", "text"],
        step: ["Пункт роботи", "Нумерована дія: «Відкрито…», «Створено…»", "list"],
        heading: ["Заголовок", "Власний розділ або назва завдання", "text"],
        image: ["Зображення", "Скріншот, схема або фото з підписом", "image"],
        code: ["Код", "Програмний код зі збереженням відступів", "code"],
        list: ["Список", "Кожен рядок — окремий елемент", "list"],
        table: ["Таблиця", "Редаговані рядки та стовпці", "table"],
        pageBreak: ["Нова сторінка", "Продовження з наступного аркуша", "file"],
        programming: ["Завдання з програмування", "Набір: заголовок, умова, код і результат", "code"]
    };
    const paths = {
        text: "M4 5h16M4 10h16M4 15h10M4 20h7", list: "M8 5h12M8 12h12M8 19h12M3 5h1M3 12h1M3 19h1",
        image: "M3 3h18v18H3zM3 17l5-5 4 4 3-3 6 6M7 7h1", code: "m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18",
        table: "M3 3h18v18H3zM3 9h18M3 15h18M10 3v18", file: "M5 2h9l5 5v15H5zM14 2v6h5",
        up: "m6 14 6-6 6 6", down: "m6 10 6 6 6-6", copy: "M8 8h13v13H8zM16 8V3H3v13h5",
        remove: "M4 7h16M9 7V3h6v4M6 7l1 14h10l1-14M10 11v6M14 11v6", plus: "M12 4v16M4 12h16"
    };
    const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.text}"/></svg>`;
    const str = value => typeof value === "string" ? value : "";
    const escape = value => str(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const uid = () => root.crypto?.randomUUID?.() || `block-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const safeImage = value => /^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=\r\n]+$/i.test(str(value));
    function create(kind, values = {}) {
        return { id: uid(), kind, text: "", caption: "", alignment: kind === "heading" ? "center" : "justify", bold: false, italic: false, ordered: false, dataUrl: "", width: 100, rows: [["", ""], ["", ""]], ...values };
    }
    function normalize(items) {
        if (!Array.isArray(items)) return [];
        const result = [];
        for (const item of items) {
            if (!item || typeof item !== "object") continue;
            if (Object.hasOwn(types, item.kind) && item.kind !== "programming") {
                const b = create(item.kind);
                for (const key of ["text", "caption"]) b[key] = str(item[key]);
                b.id = typeof item.id === "string" && /^[\w-]+$/.test(item.id) ? item.id : uid();
                b.alignment = ["left", "center", "right", "justify"].includes(item.alignment) ? item.alignment : b.alignment;
                b.bold = item.bold === true; b.italic = item.italic === true; b.ordered = item.ordered === true;
                b.dataUrl = safeImage(item.dataUrl) ? item.dataUrl : "";
                b.width = [50, 75, 100].includes(item.width) ? item.width : 100;
                if (Array.isArray(item.rows) && item.rows.length) {
                    const rows = item.rows.filter(Array.isArray).map(row => row.slice(0, 6).map(str));
                    const columns = Math.max(1, ...rows.map(row => row.length));
                    if (rows.length) b.rows = rows.map(row => Array.from({ length: columns }, (_, i) => row[i] || ""));
                }
                result.push(b);
            } else if (!item.kind) {
                // v3 drafts: keep content in its original order, without mandatory empty sections.
                if (item.title) result.push(create("heading", { text: str(item.title), alignment: "left" }));
                if (item.conditionDescription) result.push(create("text", { text: str(item.conditionDescription) }));
                const addImages = (images, caption) => {
                    if (Array.isArray(images)) for (const img of images) {
                        if (safeImage(img?.dataUrl)) result.push(create("image", { dataUrl: img.dataUrl, caption: str(img.caption) || caption }));
                    }
                };
                addImages(item.conditionImages, "Умова завдання");
                if (item.code) result.push(create("code", { text: str(item.code) }));
                addImages(item.flowchartImages, "Блок-схема алгоритму");
                addImages(item.resultImages, "Результат виконання завдання");
            }
        }
        const seen = new Set();
        for (const b of result) { if (seen.has(b.id)) b.id = uid(); seen.add(b.id); }
        return result;
    }
    function preset(kind) {
        if (kind !== "programming") return [create(kind)];
        return [create("heading", { text: "Завдання", alignment: "left" }), create("text"), create("code"), create("image", { caption: "Результат виконання завдання" })];
    }
    function move(items, id, offset) {
        const index = items.findIndex(b => b.id === id), target = index + offset;
        if (index < 0 || target < 0 || target >= items.length) return false;
        items.splice(target, 0, items.splice(index, 1)[0]); return true;
    }
    const lines = text => str(text).replace(/\r\n?/g, "\n").split("\n");
    const hasTableContent = b => b.rows.some(row => row.some(cell => cell.trim()));
    const tableTitle = (b, number) => `Таблиця ${number}${b.caption.trim() ? ` – ${b.caption.trim()}` : ""}`;
    // A4 with the report's 25/10 mm horizontal margins (twips).
    const tableWidth = 11906 - 1418 - 567;
    let textMeasure;
    function measureText(text) {
        if (textMeasure === undefined) {
            try { textMeasure = root.document?.createElement("canvas").getContext("2d") || null; }
            catch { textMeasure = null; }
            // A 14px canvas font gives point-sized measurements for 14pt Word text.
            if (textMeasure) textMeasure.font = '14px "Times New Roman"';
        }
        return textMeasure ? textMeasure.measureText(text).width : Array.from(text).length * 14;
    }
    function wrapTableText(text, width) {
        const result = [];
        for (const line of lines(text)) {
            let current = "";
            for (const token of line.match(/\s+|\S+/gu) || []) {
                if (current && measureText(current + token) > width) { result.push(current); current = ""; }
                // Also wrap unbroken URLs/identifiers; never discard cell content.
                for (const char of token) {
                    if (current && measureText(current + char) > width) { result.push(current); current = ""; }
                    current += char;
                }
            }
            result.push(current);
        }
        return result;
    }
    function tableParts(b, number) {
        const columns = b.rows[0].length;
        // Padding + a font-substitution allowance. Explicit soft line breaks keep
        // the first part within one page without fixed/clipping row heights.
        const width = tableWidth / 20 / columns - 20;
        const rows = b.rows.map(row => row.map(cell => wrapTableText(cell, width)));
        const captionHeight = wrapTableText(tableTitle(b, number), tableWidth / 20 - 20).length * 21;
        const budget = Math.max(29, 640 - captionHeight);
        const first = [], rest = [];
        let used = 0;
        for (const row of rows) {
            const height = Math.max(...row.map(cell => cell.length)) * 21 + 8;
            if (!rest.length && used + height <= budget) { first.push(row); used += height; }
            else if (!first.length) {
                // Even a single cell taller than a page must have a continuation.
                const count = Math.max(1, Math.floor((budget - 8) / 21));
                first.push(row.map(cell => cell.slice(0, count)));
                rest.push(row.map(cell => cell.slice(count)));
            } else rest.push(row);
        }
        return [first, ...(rest.length ? [rest] : [])].map(part => part.map(row => row.map(cell => cell.join("\n"))));
    }
    function preview(items) {
        let step = 0, figure = 0, table = 0;
        return items.map(b => {
            if (b.kind === "pageBreak") return '<div class="rb-page-break" aria-label="Нова сторінка"></div>';
            if (b.kind === "image") return safeImage(b.dataUrl) ? `<figure class="rb-figure"><img src="${escape(b.dataUrl)}" style="max-width:${b.width}%" alt="${escape(b.caption)}"><figcaption>Рисунок ${++figure}${b.caption ? ` – ${escape(b.caption)}` : ""}</figcaption></figure>` : "";
            if (b.kind === "table") {
                if (!hasTableContent(b)) return "";
                const number = ++table;
                return tableParts(b, number).map((part, index) => `<div class="rb-table-part${index ? " rb-table-continuation" : ""}"><table class="rb-preview-table"><thead><tr><td colspan="${b.rows[0].length}" class="rb-table-caption">${escape(index ? `Продовження таблиці №${number}` : tableTitle(b, number))}</td></tr></thead><tbody>${part.map(row => `<tr>${row.map(cell => `<td>${escape(cell).replace(/\n/g, "<br>")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`).join("");
            }
            if (!b.text.trim()) return "";
            if (b.kind === "code") return `<div class="rb-preview-text rb-preview-heading" style="text-align:left;text-indent:1.25cm;font-weight:bold">Код програми:</div><pre class="rb-preview-code">${escape(b.text)}</pre>`;
            if (b.kind === "list") {
                const tag = b.ordered ? "ol" : "ul";
                return `<${tag} class="rb-preview-list">${lines(b.text).filter(s => s.trim()).map(s => `<li>${escape(s)}</li>`).join("")}</${tag}>`;
            }
            const text = `${b.kind === "step" ? `${++step}. ` : ""}${escape(b.text).replace(/\n/g, "<br>")}`;
            return `<div class="rb-preview-text${b.kind === "heading" ? " rb-preview-heading" : ""}" style="text-align:${b.alignment};font-weight:${b.bold || b.kind === "heading" ? "bold" : "normal"};font-style:${b.italic ? "italic" : "normal"}">${text}</div>`;
        }).join("");
    }
    async function toDocx(items, d, processImage) {
        const out = []; let step = 0, figure = 0, table = 0;
        const align = { left: d.AlignmentType.LEFT, right: d.AlignmentType.RIGHT, center: d.AlignmentType.CENTER, justify: d.AlignmentType.BOTH };
        const paragraph = (text, options = {}, runOptions = {}) => new d.Paragraph({
            alignment: d.AlignmentType.BOTH, spacing: { line: 360, lineRule: d.LineRuleType.AUTO, after: 0 },
            ...options, children: lines(text).map((line, i) => new d.TextRun({ text: line, ...(i ? { break: 1 } : {}), font: "Times New Roman", size: 28, color: "000000", ...runOptions }))
        });
        for (const b of items) {
            if (b.kind === "pageBreak") { out.push(new d.Paragraph({ children: [new d.PageBreak()] })); continue; }
            if (b.kind === "image") {
                if (!safeImage(b.dataUrl)) continue;
                const image = await processImage(b.dataUrl, 660 * b.width / 100, 760);
                if (!image) throw new Error("Не вдалося обробити зображення. Замініть його та повторіть експорт.");
                out.push(new d.Paragraph({ alignment: d.AlignmentType.CENTER, keepNext: true, children: [new d.ImageRun({ data: image.buffer, transformation: { width: image.width, height: image.height } })] }));
                out.push(paragraph("", { keepNext: true }));
                out.push(paragraph(`Рисунок ${++figure}${b.caption ? ` – ${b.caption}` : ""}`, { alignment: d.AlignmentType.CENTER }));
                out.push(paragraph(""));
                continue;
            }
            if (b.kind === "table") {
                if (!hasTableContent(b)) continue;
                const number = ++table, columns = b.rows[0].length;
                const cellWidth = Math.floor(tableWidth / columns);
                const cellSpacing = { before: 0, after: 0, line: 420, lineRule: d.LineRuleType.EXACT };
                const none = { style: d.BorderStyle.NIL, size: 0, color: "FFFFFF" };
                tableParts(b, number).forEach((part, index) => {
                    if (index) out.push(paragraph("", { pageBreakBefore: true, keepNext: true, spacing: { before: 0, after: 0, line: 1, lineRule: d.LineRuleType.EXACT } }));
                    // Only continuation parts have a repeated caption. A PAGE field
                    // in a repeated table row is cached by Word, not recalculated.
                    const caption = new d.TableRow({ tableHeader: index > 0, cantSplit: true, children: [new d.TableCell({
                        columnSpan: columns, width: { size: tableWidth, type: d.WidthType.DXA },
                        borders: { top: none, bottom: none, left: none, right: none },
                        margins: { top: 0, bottom: 80, left: 0, right: 0 },
                        children: [paragraph(index ? `Продовження таблиці №${number}` : tableTitle(b, number), { alignment: d.AlignmentType.LEFT, keepNext: true, spacing: cellSpacing })]
                    })] });
                    out.push(new d.Table({ width: { size: tableWidth, type: d.WidthType.DXA }, columnWidths: Array(columns).fill(cellWidth), layout: d.TableLayoutType.FIXED,
                        margins: { top: 80, bottom: 80, left: 108, right: 108 },
                        rows: [caption, ...part.map((row, rowIndex) => new d.TableRow({ cantSplit: index === 0,
                            children: row.map(cell => new d.TableCell({ width: { size: cellWidth, type: d.WidthType.DXA },
                                children: [paragraph(cell, { alignment: d.AlignmentType.LEFT, keepNext: index === 0 && rowIndex < part.length - 1, spacing: cellSpacing })]
                            })) }))] }));
                });
                out.push(paragraph("")); continue;
            }
            if (!b.text.trim()) continue;
            if (b.kind === "code") {
                out.push(paragraph("Код програми:", { alignment: d.AlignmentType.LEFT, indent: { firstLine: 709 }, keepNext: true, spacing: { line: 360, before: 180, after: 120 } }, { bold: true }));
                for (const line of lines(b.text)) out.push(paragraph(line, { alignment: d.AlignmentType.LEFT, spacing: { line: 240, lineRule: d.LineRuleType.AUTO, after: 0 } }, { font: "Consolas", size: 22 }));
            } else if (b.kind === "list") {
                lines(b.text).filter(s => s.trim()).forEach((line, i) => out.push(paragraph(`${b.ordered ? `${i + 1}.` : "•"} ${line}`, { alignment: d.AlignmentType.LEFT, indent: { left: 360, hanging: 360 } })));
            } else {
                out.push(paragraph(`${b.kind === "step" ? `${++step}. ` : ""}${b.text}`, { alignment: align[b.alignment], ...(b.kind === "heading" ? { keepNext: true, spacing: { line: 360, before: 180, after: 120 } } : { indent: { firstLine: 720 } }) }, { bold: b.bold || b.kind === "heading", italics: b.italic }));
            }
        }
        return out;
    }
    function editor({ container, getItems, onChange, confirm, notice, resize }) {
        let selectedId = null, insertAfter = null, returnFocus = null;
        const dialog = document.createElement("dialog");
        dialog.className = "rb-picker";
        dialog.setAttribute("aria-labelledby", "rbPickerTitle");
        dialog.innerHTML = `<header><div><h2 id="rbPickerTitle">Додати до звіту</h2><p>Оберіть блок. Порядок можна змінити будь-коли.</p></div><button type="button" class="btn rb-icon-button" data-close aria-label="Закрити">×</button></header><div class="rb-picker-grid">${Object.entries(types).map(([kind, [name, description, symbol]]) => `<button type="button" class="rb-choice" data-kind="${kind}">${icon(symbol)}<span><strong>${name}</strong><small>${description}</small></span></button>`).join("")}</div><p class="rb-hint">Код і блок-схема потрібні лише для відповідних завдань. Для ОС достатньо пунктів роботи, пояснень та скріншотів.</p>`;
        document.body.append(dialog);
        dialog.querySelector("[data-close]").onclick = () => dialog.close();
        dialog.addEventListener("click", e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } });
        dialog.addEventListener("close", () => returnFocus?.isConnected && returnFocus.focus());
        const open = (after = null) => { insertAfter = after; returnFocus = document.activeElement; dialog.showModal(); };
        const focusBlock = id => { const card = container.querySelector(`[data-block="${id}"]`); (card?.querySelector("textarea, input, button") || container.querySelector("[data-add]"))?.focus(); };
        const changed = (redraw = false) => { if (redraw) render(); onChange(); };
        dialog.querySelectorAll("[data-kind]").forEach(button => button.onclick = () => {
            const items = getItems(), blocks = preset(button.dataset.kind);
            const afterIndex = items.findIndex(b => b.id === insertAfter);
            items.splice(afterIndex < 0 ? items.length : afterIndex + 1, 0, ...blocks);
            dialog.close(); changed(true); focusBlock(blocks[0].id);
        });
        function render() {
            const items = getItems(); let step = 0, figure = 0;
            container.innerHTML = items.length ? items.map((b, i) => {
                const name = b.kind === "image" && safeImage(b.dataUrl) ? `Рисунок ${++figure}` : types[b.kind][0] + (b.kind === "step" ? ` ${++step}` : "");
                const action = (type, label, disabled = false) => `<button type="button" class="btn rb-icon-button" data-action="${type}" aria-label="${label}" title="${label}${type === "remove" ? " · Shift — без підтвердження" : ""}" ${disabled ? "disabled" : ""}>${icon(type)}</button>`;
                let body = "";
                if (b.kind === "image") {
                    body = `<div class="rb-image-drop" tabindex="0" role="group" aria-label="Зображення: вставте з буфера Ctrl+V або завантажте файл">${safeImage(b.dataUrl) ? `<img src="${escape(b.dataUrl)}" alt="${escape(b.caption)}">` : `<div class="rb-image-placeholder">${icon("image")}<span>Перетягніть зображення або вставте Ctrl+V</span></div>`}<label class="btn btn-secondary rb-upload">${b.dataUrl ? "Замінити зображення" : "Обрати файл"}<input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" data-image-file></label></div><label class="rb-field">Підпис рисунка <span class="rb-hint">Кожне фото має окремий номер і підпис</span><textarea class="form-control" rows="1" data-field="caption">${escape(b.caption)}</textarea></label><label class="rb-field">Ширина у документі<select class="form-control" data-field="width">${[50, 75, 100].map(n => `<option value="${n}" ${n === b.width ? "selected" : ""}>${n}%</option>`).join("")}</select></label>`;
                } else if (b.kind === "table") {
                    body = `<label class="rb-field">Назва таблиці <span class="rb-hint">Наприклад: Результат. Номер додається автоматично.</span><textarea class="form-control" rows="1" data-field="caption" placeholder="Результат">${escape(b.caption)}</textarea></label>`;
                    body += `<div class="rb-table-scroll"><table class="rb-edit-table"><tbody>${b.rows.map((row, r) => `<tr>${row.map((cell, c) => `<td><textarea class="form-control" rows="2" data-row="${r}" data-column="${c}" aria-label="Рядок ${r + 1}, стовпець ${c + 1}">${escape(cell)}</textarea></td>`).join("")}</tr>`).join("")}</tbody></table></div><div class="rb-table-tools"><button type="button" class="btn btn-sm" data-action="add-row">+ Рядок</button><button type="button" class="btn btn-sm" data-action="add-column" ${b.rows[0].length >= 6 ? "disabled" : ""}>+ Стовпець</button><button type="button" class="btn btn-sm" data-action="remove-row" ${b.rows.length <= 1 ? "disabled" : ""}>− Останній рядок</button><button type="button" class="btn btn-sm" data-action="remove-column" ${b.rows[0].length <= 1 ? "disabled" : ""}>− Останній стовпець</button></div><p class="rb-hint">У Word довга таблиця продовжиться на новій сторінці з написом «Продовження таблиці №…».</p>`;
                } else if (b.kind === "pageBreak") {
                    body = '<p class="rb-hint">Наступний блок почнеться з нової сторінки у Word.</p>';
                } else {
                    body = `<label class="rb-field">${b.kind === "step" ? "Що було зроблено" : b.kind === "list" ? "Кожен рядок — новий елемент" : name}<textarea class="form-control${b.kind === "code" ? " code-editor-textarea" : ""}" rows="${b.kind === "heading" ? 1 : 3}" data-field="text" ${b.kind === "code" ? 'spellcheck="false"' : ""}>${escape(b.text)}</textarea></label>`;
                    if (["text", "step", "heading"].includes(b.kind)) body += `<div class="rb-format"><label>Вирівнювання<select class="form-control" data-field="alignment">${Object.entries({ justify: "За шириною", left: "Ліворуч", center: "По центру", right: "Праворуч" }).map(([v, label]) => `<option value="${v}" ${b.alignment === v ? "selected" : ""}>${label}</option>`).join("")}</select></label><label><input type="checkbox" data-field="bold" ${b.bold || b.kind === "heading" ? "checked" : ""} ${b.kind === "heading" ? "disabled" : ""}> Напівжирний</label><label><input type="checkbox" data-field="italic" ${b.italic ? "checked" : ""}> Курсив</label></div>`;
                    if (b.kind === "list") body += `<label class="rb-check"><input type="checkbox" data-field="ordered" ${b.ordered ? "checked" : ""}> Нумерований список</label>`;
                }
                return `<section class="rb-block" data-block="${b.id}"><header><h3>${icon(types[b.kind][2])}${name}</h3><div class="rb-actions">${action("up", "Перемістити вище", i === 0)}${action("down", "Перемістити нижче", i === items.length - 1)}${action("copy", "Дублювати блок")}${action("remove", "Видалити блок")}</div></header>${body}<button type="button" class="btn btn-sm rb-insert" data-action="plus">${icon("plus")}Додати після цього блоку</button></section>`;
            }).join("") : `<div class="rb-empty">${icon("file")}<h3>Ваш звіт — ваша послідовність</h3><p>Додайте перший пункт, текст або скріншот. Зайвих розділів не буде.</p></div>`;
            container.insertAdjacentHTML("beforeend", `<button type="button" class="btn btn-secondary rb-add-bottom" data-add>${icon("plus")}Додати блок</button>`);
            resize(container);
        }
        container.addEventListener("focusin", e => { selectedId = e.target.closest("[data-block]")?.dataset.block || null; });
        container.addEventListener("input", e => {
            const b = getItems().find(b => b.id === e.target.closest("[data-block]")?.dataset.block);
            if (!b) return;
            if (e.target.dataset.field) {
                const field = e.target.dataset.field;
                b[field] = e.target.type === "checkbox" ? e.target.checked : field === "width" ? Number(e.target.value) : e.target.value;
            } else if (e.target.dataset.row !== undefined) b.rows[Number(e.target.dataset.row)][Number(e.target.dataset.column)] = e.target.value;
            else return;
            changed();
        });
        container.addEventListener("keydown", e => {
            if (e.key !== "Tab" || !e.target.matches(".code-editor-textarea")) return;
            e.preventDefault(); const t = e.target; t.setRangeText("    ", t.selectionStart, t.selectionEnd, "end"); t.dispatchEvent(new Event("input", { bubbles: true }));
        });
        container.addEventListener("click", async e => {
            const button = e.target.closest("button"); if (!button) return;
            if (button.hasAttribute("data-add")) { open(); return; }
            const id = button.closest("[data-block]")?.dataset.block, items = getItems(), b = items.find(b => b.id === id);
            if (!b) return;
            const action = button.dataset.action;
            if (action === "plus") { open(id); return; }
            if (action === "remove" || action === "remove-row" || action === "remove-column") {
                if (!await confirm({ anchor: button, skipConfirmation: e.shiftKey, title: action === "remove" ? "Видалити блок?" : action === "remove-row" ? "Видалити останній рядок?" : "Видалити останній стовпець?", message: "Вміст буде видалено без можливості скасування.", confirmLabel: "Видалити" })) return;
                if (!getItems().includes(b)) return;
            }
            const index = items.indexOf(b);
            if (action === "up" || action === "down") move(items, id, action === "up" ? -1 : 1);
            else if (action === "copy") { const copy = normalize([b])[0]; copy.id = uid(); items.splice(index + 1, 0, copy); }
            else if (action === "remove") items.splice(index, 1);
            else if (action === "add-row") b.rows.push(Array(b.rows[0].length).fill(""));
            else if (action === "add-column" && b.rows[0].length < 6) b.rows.forEach(row => row.push(""));
            else if (action === "remove-row" && b.rows.length > 1) b.rows.pop();
            else if (action === "remove-column" && b.rows[0].length > 1) b.rows.forEach(row => row.pop());
            else return;
            changed(true); focusBlock(items.find(x => x.id === id)?.id || items[Math.min(index, items.length - 1)]?.id);
        });
        async function upload(file, id) {
            if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { notice("Оберіть PNG, JPEG, WebP або GIF.", "error"); return; }
            if (file.size > 15 * 1024 * 1024) { notice("Зображення завелике. Максимум — 15 МБ.", "error"); return; }
            // Capture identity and generation, not an index: reordering/removing blocks must be safe.
            const target = getItems().find(b => b.id === id); if (!target) return;
            const token = uid(); target.uploadToken = token;
            try {
                const dataUrl = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
                const image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = dataUrl; });
                const scale = Math.min(1, 2200 / Math.max(image.naturalWidth, image.naturalHeight));
                const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
                const ctx = canvas.getContext("2d"); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
                if (!getItems().includes(target) || target.uploadToken !== token) return;
                target.dataUrl = canvas.toDataURL("image/jpeg", 0.92); delete target.uploadToken;
                changed(true); focusBlock(id); notice("Зображення додано.", "success");
            } catch { notice("Не вдалося прочитати зображення. Спробуйте інший файл.", "error"); }
        }
        async function uploadFiles(files, id) {
            const items = getItems(), target = items.find(b => b.id === id);
            if (!target) return;
            const accepted = [...files].filter(file => /^image\/(png|jpeg|webp|gif)$/.test(file.type) && file.size <= 15 * 1024 * 1024);
            if (!accepted.length) { notice("Оберіть PNG, JPEG, WebP або GIF до 15 МБ кожне.", "error"); return; }
            // One file is one figure: never combine several photos under a single caption.
            const extra = accepted.slice(1).map(() => create("image"));
            items.splice(items.indexOf(target) + 1, 0, ...extra);
            const targets = [target, ...extra];
            if (extra.length) changed(true);
            for (let i = 0; i < accepted.length; i++) {
                if (getItems().includes(targets[i])) await upload(accepted[i], targets[i].id);
            }
            if (accepted.length !== files.length) notice("Деякі файли пропущено: потрібні зображення PNG, JPEG, WebP або GIF до 15 МБ кожне.", "info");
        }
        container.addEventListener("change", e => { if (e.target.matches("[data-image-file]")) uploadFiles(e.target.files, e.target.closest("[data-block]").dataset.block); });
        container.addEventListener("dragover", e => { if (e.target.closest(".rb-image-drop")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
        container.addEventListener("drop", e => { const card = e.target.closest(".rb-image-drop")?.closest("[data-block]"); if (card) { e.preventDefault(); uploadFiles(e.dataTransfer.files, card.dataset.block); } });
        container.addEventListener("paste", e => {
            const files = [...(e.clipboardData?.items || [])].filter(item => item.kind === "file" && item.type.startsWith("image/")).map(item => item.getAsFile()).filter(Boolean);
            if (!files.length) return;
            e.preventDefault(); const items = getItems(); let b = items.find(b => b.id === selectedId && b.kind === "image");
            if (!b) { b = create("image"); const index = items.findIndex(b => b.id === selectedId); items.splice(index < 0 ? items.length : index + 1, 0, b); changed(true); }
            uploadFiles(files, b.id);
        });
        return { render, open };
    }
    root.ReportBlocks = { create, normalize, preset, move, preview, toDocx, editor, tableParts };
})(typeof window === "undefined" ? globalThis : window);
