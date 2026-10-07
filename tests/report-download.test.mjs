import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../reports/script.js', import.meta.url), 'utf8');
function fixture() {
    const elements = new Map(), downloads = [], blobs = [], revoked = [], timers = [];
    const element = id => {
        if (!elements.has(id)) elements.set(id, {
            textContent: '', open: false, events: {}, shows: 0,
            addEventListener(name, fn) { this.events[name] = fn; },
            showModal() { this.open = true; this.shows++; },
            close() { this.open = false; this.events.close?.(); }
        });
        return elements.get(id);
    };
    const document = {
        readyState: 'loading', getElementById: element, addEventListener() {},
        body: { appendChild() {}, removeChild() {} },
        createElement: () => ({ click() { downloads.push({ filename: this.download, url: this.href }); } })
    };
    const window = {};
    const instrumented = source.replace('    if (document.readyState === "loading")',
        '    window.downloadTest = { setupDownloadDialog, showReportDownload, state };\n    if (document.readyState === "loading")');
    vm.runInNewContext(instrumented, {
        window, document, console,
        URL: { createObjectURL(blob) { blobs.push(blob); return `blob:test-${blobs.length}`; }, revokeObjectURL(url) { revoked.push(url); } },
        setTimeout(fn) { timers.push(fn); }
    });
    window.downloadTest.setupDownloadDialog();
    return { ...window.downloadTest, element, downloads, blobs, revoked, timers };
}

test('download receipt shows literal filename, document size and reuses the generated file for retries', () => {
    const f = fixture(), blob = new Blob(['x'.repeat(2500)]), filename = 'ЛР_Дуже_довга_назва_<img src=x>.docx';
    f.state.labTheme = 'Незавершена робота';
    f.showReportDownload(blob, filename);
    assert.equal(f.element('successModal').open, true);
    assert.equal(f.element('successFileNameDisplay').textContent, filename);
    assert.equal(f.element('successFileMeta').textContent, 'Документ Word · 3 КБ');
    assert.equal(f.downloads.length, 0, 'The receipt itself must not start another download');
    f.element('btnDownloadAgain').events.click();
    f.element('btnDownloadAgain').events.click();
    assert.equal(f.downloads.length, 2);
    assert.ok(f.downloads.every(file => file.filename === filename));
    assert.ok(f.blobs.every(file => file === blob), 'Retry the same bytes rather than regenerating the report');
    for (const timer of f.timers) timer();
    assert.deepEqual(f.revoked, ['blob:test-1', 'blob:test-2']);
    assert.equal(f.state.labTheme, 'Незавершена робота');
});

test('closing by either button or native Escape releases the cached file and permits a fresh export', () => {
    for (const trigger of ['btnCloseSuccess', 'btnDismissSuccess', 'escape']) {
        const f = fixture();
        f.showReportDownload(new Blob(['old']), 'old.docx');
        if (trigger === 'escape') f.element('successModal').close();
        else f.element(trigger).events.click();
        assert.equal(f.element('successModal').open, false);
        f.element('btnDownloadAgain').events.click();
        assert.equal(f.downloads.length, 0);
        const blob = new Blob(['x'.repeat(1572864)]);
        f.showReportDownload(blob, 'new.docx');
        assert.equal(f.element('successFileMeta').textContent, 'Документ Word · 1,5 МБ');
        f.element('btnDownloadAgain').events.click();
        assert.equal(f.blobs[0], blob);
        assert.equal(f.downloads[0].filename, 'new.docx');
        f.showReportDownload(blob, 'updated.docx');
        assert.equal(f.element('successModal').shows, 2, 'Do not reopen an already open native dialog');
        assert.equal(f.element('successFileNameDisplay').textContent, 'updated.docx');
    }
});

test('download receipt has native focus management, a named close action and no full-screen blur', async () => {
    const html = await readFile(new URL('../reports/index.html', import.meta.url), 'utf8');
    const css = await readFile(new URL('../reports/style.css', import.meta.url), 'utf8');
    assert.match(html, /<dialog[^>]*id="successModal"[^>]*aria-labelledby="downloadTitle"[^>]*aria-describedby="downloadDescription"/);
    assert.match(html, /id="btnCloseSuccess" autofocus/);
    assert.match(html, /id="btnDismissSuccess" aria-label="[^"]+"/);
    assert.doesNotMatch(html, /success-icon|success-card|успішно згенеровано/);
    assert.match(css, /dialog\.download-dialog:not\(\[open\]\) \{ display: none/);
    assert.match(css, /dialog\.download-dialog::backdrop \{ background: [^;]+; \}/);
    assert.match(css, /\.download-file-copy strong[^}]*overflow-wrap: anywhere/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*dialog\.download-dialog \{ animation: none/);
});
