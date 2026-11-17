/* View navigation only; document data and export belong to script.js. */
(() => {
    'use strict';
    const el = id => document.getElementById(id);
    const sections = [...document.querySelectorAll('.studio-section')];
    const links = [...document.querySelectorAll('.report-steps a')];
    let active = '#reportStudent';
    function reveal(hash, focus = false) {
        const target = sections.find(section => `#${section.id}` === hash);
        if (!target) return;
        active = hash;
        for (const link of links) {
            if (link.getAttribute('href') === hash) link.setAttribute('aria-current', 'step');
            else link.removeAttribute('aria-current');
        }
        if (focus) target.focus({ preventScroll: true });
        if (!el('reportsEditor').hidden) target.scrollIntoView({ block: 'start' });
    }
    function showEditor(hash = active) {
        el('reportsLibrary').hidden = true; el('reportsEditor').hidden = false;
        reveal(hash, true);
        if (hash === '#reportStudent') window.scrollTo({ top: 0 });
    }
    function showLibrary(focus = true) {
        el('reportsEditor').hidden = true; el('reportsLibrary').hidden = false;
        if (focus) { window.scrollTo({ top: 0 }); el('reportsTitle').focus(); }
    }
    links.forEach(link => link.addEventListener('click', event => { event.preventDefault(); reveal(link.getAttribute('href'), true); }));
    document.querySelector('.studio-skip').addEventListener('click', event => { event.preventDefault(); showEditor(); });
    const help = el('studioHelpDialog');
    el('btnStudioHelp').addEventListener('click', () => help.showModal());
    el('btnCloseStudioHelp').addEventListener('click', () => help.close());
    el('btnLibraryImport').addEventListener('click', () => el('btnImportDraft').click());
    const exportDialog = el('reportExportDialog');
    el('btnDownloadReport').addEventListener('click', () => {
        const checks = el('exportChecklist'); checks.replaceChildren();
        const fields = [['studentName', 'ПІБ студента'], ['studentGroup', 'Група'], ['studentTeacher', 'Викладач'], ['reportYear', 'Навчальний рік'], ['disciplineInput', 'Дисципліна'], ['labTheme', 'Тема роботи'], ['labGoal', 'Мета роботи']];
        for (const [id, label] of fields) {
            if (el(id).value.trim()) continue;
            const button = document.createElement('button'); button.type = 'button'; button.className = 'export-missing';
            button.textContent = `Заповнити: ${label} →`;
            button.addEventListener('click', () => { exportDialog.close(); reveal(`#${el(id).closest('.studio-section').id}`); el(id).focus(); });
            checks.append(button);
        }
        if (!checks.children.length) { const p = document.createElement('p'); p.textContent = '✓ Основні дані заповнено. Звіт готовий до скачування.'; checks.append(p); }
        exportDialog.showModal();
    });
    el('btnCloseExport').addEventListener('click', () => exportDialog.close());
    el('btnConfirmExport').addEventListener('click', () => { exportDialog.close(); el('btnGenerateDocx').click(); });
    document.addEventListener('click', event => {
        document.querySelectorAll('.report-file-menu[open]').forEach(menu => {
            if (!menu.contains(event.target)) menu.open = false;
        });
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') document.querySelectorAll('.report-file-menu[open]').forEach(menu => { menu.open = false; menu.querySelector('summary').focus(); });
    });
    window.addEventListener('hashchange', () => { if (sections.some(section => `#${section.id}` === location.hash)) showEditor(location.hash); });
    window.ReportStudio = { showEditor, showLibrary, reveal };
    reveal(active);
})();
