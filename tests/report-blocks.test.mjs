import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { inflateRawSync } from 'node:zlib';
const source = await readFile(new URL('../reports/blocks.js', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../reports/script.js', import.meta.url), 'utf8');
const context = { crypto: { randomUUID: (() => { let n = 0; return () => `id-${++n}`; })() } };
vm.runInNewContext(source, context);
const b = context.ReportBlocks;
const docx = createRequire(import.meta.url)('../reports/assets/libs/docx.umd.js');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=';
const plain = value => JSON.parse(JSON.stringify(value));
function zipEntry(buffer, name) {
    for (let i = 0; i < buffer.length - 46; i++) {
        if (buffer.readUInt32LE(i) !== 0x02014b50) continue;
        const len = buffer.readUInt16LE(i + 28);
        if (buffer.toString('utf8', i + 46, i + 46 + len) !== name) continue;
        const size = buffer.readUInt32LE(i + 20), offset = buffer.readUInt32LE(i + 42);
        const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
        const data = buffer.subarray(start, start + size);
        return (buffer.readUInt16LE(i + 10) === 8 ? inflateRawSync(data) : data).toString('utf8');
    }
    throw new Error(`Missing ZIP entry: ${name}`);
}
async function xmlFor(items) {
    const children = await b.toDocx(items, docx, async () => ({ buffer: Buffer.from(png.split(',')[1], 'base64'), width: 100, height: 80 }));
    return zipEntry(await docx.Packer.toBuffer(new docx.Document({ sections: [{ children }] })), 'word/document.xml');
}
test('legacy reports retain condition, code and all pictures in their original order', () => {
    const migrated = b.normalize([{ title: 'Завдання 1', conditionDescription: 'Умова', conditionImages: [{ dataUrl: png }], code: '  print(1)', flowchartImages: [{ dataUrl: png }], resultImages: [{ dataUrl: png }] }]);
    assert.deepEqual(plain(migrated.map(x => x.kind)), ['heading', 'text', 'image', 'code', 'image', 'image']);
    assert.equal(migrated[3].text, '  print(1)');
    assert.equal(migrated[2].dataUrl, png);
    assert.deepEqual(plain(b.normalize(migrated)), plain(migrated));
});
test('normalization rejects unsafe images, repairs duplicate IDs and rectangular tables', () => {
    const data = b.normalize([null, { kind: '__proto__' }, { kind: 'image', id: 'same', dataUrl: 'javascript:alert(1)' }, { kind: 'text', id: 'same', text: '<script>alert(1)</script>' }, { kind: 'table', rows: [['A', 'B'], ['C']] }]);
    assert.equal(data.length, 3);
    assert.equal(data[0].dataUrl, '');
    assert.equal(new Set(data.map(x => x.id)).size, 3);
    assert.deepEqual(plain(data[2].rows), [['A', 'B'], ['C', '']]);
    assert.doesNotMatch(b.preview(data), /<script>|javascript:/);
    assert.match(b.preview(data), /&lt;script&gt;/);
});
test('OS report has no compulsory code or diagram; numbering follows reordered content', () => {
    const blocks = [b.create('step', { text: 'Відкрито Windows' }), b.create('image', { dataUrl: png, caption: 'Середовище' }), b.create('step', { text: 'Перевірено систему' })];
    assert.equal(b.move(blocks, blocks[2].id, -1), true);
    const html = b.preview(blocks);
    assert.ok(html.indexOf('1. Відкрито') < html.indexOf('2. Перевірено'));
    assert.match(html, /Рисунок 1 – Середовище/);
    assert.doesNotMatch(html, /Код|Блок-схема/);
    assert.equal(b.move(blocks, blocks[0].id, -1), false);
    assert.equal(b.move(blocks, 'missing', 1), false);
    assert.equal(b.preview([b.create('code'), b.create('image'), b.create('table')]), '');
});
test('programming is an optional editable starter, not a mandatory report template', () => {
    assert.deepEqual(plain(b.preset('programming').map(x => x.kind)), ['heading', 'text', 'code', 'image']);
    assert.deepEqual(plain(b.preset('step').map(x => x.kind)), ['step']);
    assert.match(mainSource, /state\.tasks = \[\];/);
    assert.doesNotMatch(mainSource, /oopLab1Template|Код не додано|attachTaskListeners/);
});
test('DOCX preserves block order, typography, multiline text, tables, captions and page breaks', async () => {
    const xml = await xmlFor([
        b.create('heading', { text: 'SECTION', alignment: 'center' }),
        b.create('step', { text: 'FIRST\nSECOND', bold: true, italic: true }),
        b.create('code', { text: '  const x = 1;\n\treturn x;' }),
        b.create('image', { dataUrl: png, caption: 'SCREEN' }),
        b.create('table', { rows: [['COL1', 'COL2'], ['A', 'B']] }),
        b.create('list', { text: 'ONE\nTWO', ordered: true }),
        b.create('pageBreak'), b.create('text', { text: 'LAST' })
    ]);
    const labels = ['SECTION', 'FIRST', 'SECOND', 'const x', 'SCREEN', 'COL1', 'ONE', 'LAST'];
    for (let i = 1; i < labels.length; i++) assert.ok(xml.indexOf(labels[i - 1]) < xml.indexOf(labels[i]), labels[i]);
    for (const pattern of [/w:ascii="Times New Roman"/, /w:sz w:val="28"/, /w:line="360"/, /w:color w:val="000000"/, /w:ascii="Consolas"/, /w:sz w:val="22"/, /<w:tbl>/, /w:type="page"/, /Рисунок 1/, /<w:br\/>/]) assert.match(xml, pattern);
});
test('invalid image decoding fails visibly instead of silently losing a picture in export', async () => {
    await assert.rejects(b.toDocx([b.create('image', { dataUrl: png })], docx, async () => null), /зображення/);
});

test('each nonempty code block has a program heading in preview and Word, without orphan headings for empty blocks', async () => {
    const items = [b.create('code', { text: '  first();\n\tsecond();' }), b.create('code', { text: ' \n ' }), b.create('text', { text: 'Explanation' }), b.create('code', { text: 'last();' })];
    const html = b.preview(items), xml = await xmlFor(items);
    assert.equal((html.match(/Код програми/g) || []).length, 2);
    assert.equal((xml.match(/Код програми/g) || []).length, 2);
    assert.match(html, /Код програми<\/div><pre class="rb-preview-code">  first\(\);\n\tsecond\(\);<\/pre>/);
    const paragraphs = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map(match => match[0]);
    const headings = paragraphs.map((paragraph, index) => paragraph.includes('Код програми') ? index : -1).filter(index => index >= 0);
    for (const index of headings) {
        assert.match(paragraphs[index], /<w:keepNext/);
        assert.match(paragraphs[index], /w:jc w:val="center"/);
        assert.match(paragraphs[index], /<w:b\/>/);
        assert.match(paragraphs[index], /w:ascii="Times New Roman"/);
        assert.match(paragraphs[index + 1], /w:ascii="Consolas"/);
    }
    assert.equal(b.preview([b.create('code')]), '');
    assert.doesNotMatch(await xmlFor([b.create('code')]), /Код програми/);
});

test('photo captions have actual empty paragraphs above and below, kept with their image', async () => {
    const xml = await xmlFor([b.create('image', { dataUrl: png, caption: 'Фото' }), b.create('text', { text: 'Після фото' })]);
    const paragraphs = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map(match => match[0]);
    const index = paragraphs.findIndex(p => p.includes('Рисунок 1 – Фото'));
    assert.ok(index >= 2);
    assert.match(paragraphs[index - 2], /<w:drawing>/);
    for (const gap of [paragraphs[index - 1], paragraphs[index + 1]]) {
        assert.doesNotMatch(gap, /<w:t\b[^>]*>[^<]+<\/w:t>|<w:drawing>/);
        assert.match(gap, /w:line="360"/);
    }
    assert.match(paragraphs[index - 2], /<w:keepNext/);
    assert.match(paragraphs[index - 1], /<w:keepNext/);
    assert.match(paragraphs[index + 2], /Після фото/);
});

test('table captions are escaped, saved and independently renumbered on reorder/deletion', async () => {
    const blocks = b.normalize([
        b.create('table', { caption: 'Empty' }),
        b.create('image', { dataUrl: png, caption: 'Photo' }),
        b.create('table', { caption: 'Результат <1>', rows: [['A', 'B']] }),
        b.create('table', { caption: 'Перевірка', rows: [['C']] })
    ]);
    assert.equal(blocks[2].caption, 'Результат <1>');
    let html = b.preview(blocks);
    assert.match(html, /Таблиця 1 – Результат &lt;1&gt;/);
    assert.match(html, /Таблиця 2 – Перевірка/);
    assert.match(html, /Рисунок 1 – Photo/);
    assert.doesNotMatch(html, /Empty|Продовження таблиці/);
    b.move(blocks, blocks[3].id, -1);
    assert.match(b.preview(blocks), /Таблиця 1 – Перевірка/);
    blocks.splice(2, 1);
    const xml = await xmlFor(blocks);
    assert.match(xml, /Таблиця 1 – Результат &lt;1&gt;/);
    assert.doesNotMatch(xml, /Таблиця 2|Продовження таблиці/);
    assert.match(source, /Назва таблиці[\s\S]*?data-field="caption"/);
});

test('long tables start continuation on a new page and repeat its caption on further pages', async () => {
    const rows = Array.from({ length: 100 }, (_, index) => [`R${index}`, `V${index}`]);
    const table = b.create('table', { caption: 'Результат', rows });
    const before = JSON.stringify(table);
    const parts = b.tableParts(table, 1);
    assert.equal(parts.length, 2);
    assert.ok(parts[0].length > 1 && parts[0].length < rows.length);
    assert.deepEqual(plain(parts.flat()), rows);
    assert.equal(JSON.stringify(table), before);
    const xml = await xmlFor([table, b.create('text', { text: 'AFTER' })]);
    const tables = [...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map(match => match[0]);
    assert.equal(tables.length, 2);
    assert.match(tables[0], /Таблиця 1 – Результат/);
    assert.doesNotMatch(tables[0], /Продовження/);
    assert.match(tables[1], /Продовження таблиці №1/);
    const header = tables[1].match(/<w:tr>[\s\S]*?<\/w:tr>/)[0];
    assert.match(header, /<w:tblHeader(?:\s+w:val="true")?\/>/);
    assert.match(header, /w:gridSpan w:val="2"/);
    assert.match(xml.slice(xml.indexOf('</w:tbl>'), xml.indexOf(tables[1])), /<w:pageBreakBefore/);
    assert.match(tables[0], /<w:keepNext/);
    assert.match(tables[0], /w:lineRule="exact"/);
    assert.ok(xml.indexOf('AFTER') > xml.indexOf('V99'));
    for (let index = 0; index < 100; index++) assert.equal((xml.match(new RegExp(`>R${index}<`, 'g')) || []).length, 1);
    assert.match(b.preview([table]), /rb-table-continuation[\s\S]*?<thead>[\s\S]*?Продовження таблиці №1/);
});

test('a page-sized cell is split without dropping text or changing the saved row', async () => {
    const text = 'Дуже довгий результат перевірки. '.repeat(150);
    const table = b.create('table', { rows: [[text, 'Сусідня клітинка']], caption: 'Довга клітинка' });
    const parts = b.tableParts(table, 1);
    assert.equal(parts.length, 2);
    assert.equal(parts.map(part => part[0][0]).join('').replace(/\n/g, ''), text);
    assert.equal(parts.map(part => part[0][1]).join('').replace(/\n/g, ''), 'Сусідня клітинка');
    assert.equal(table.rows[0][0], text);
    const xml = await xmlFor([table]);
    assert.match(xml, /Продовження таблиці №1/);
    assert.doesNotMatch(xml, /w:hRule="exact"/); // No row height that could crop text.
});

test('every photo has its own figure and caption after reorder, deletion and legacy import', async () => {
    const blocks = b.normalize([{ resultImages: [{ dataUrl: png, caption: 'FIRST' }, { dataUrl: png, caption: 'SECOND' }] }]);
    blocks.push(b.create('image'), b.create('pageBreak'), b.create('image', { dataUrl: png, caption: 'THIRD' }));
    const verify = async labels => {
        const html = b.preview(blocks), xml = await xmlFor(blocks);
        assert.equal((html.match(/<figure /g) || []).length, labels.length);
        assert.equal((xml.match(/<w:drawing>/g) || []).length, labels.length);
        const captions = [...html.matchAll(/<figcaption>([^<]+)<\/figcaption>/g)].map(m => m[1]);
        assert.deepEqual(captions, labels.map((label, index) => `Рисунок ${index + 1} – ${label}`));
        for (const caption of captions) assert.ok(xml.includes(caption));
    };
    await verify(['FIRST', 'SECOND', 'THIRD']);
    b.move(blocks, blocks[1].id, -1);
    await verify(['SECOND', 'FIRST', 'THIRD']);
    blocks.splice(0, 1);
    await verify(['FIRST', 'THIRD']);
});

test('multi-file upload creates individual image blocks without absorbing following content', async () => {
    const start = source.indexOf('        async function uploadFiles(');
    const end = source.indexOf('        container.addEventListener("change"', start);
    const target = b.create('image', { caption: 'Existing caption' }), following = b.create('text', { text: 'Keep me' });
    const items = [target, following], uploads = [], notices = [];
    const scope = { getItems: () => items, create: b.create, changed() {}, notice: (...args) => notices.push(args), upload: async (file, id) => uploads.push({ file, id }) };
    vm.runInNewContext(source.slice(start, end), scope);
    const files = [{ type: 'image/png', size: 10 }, { type: 'image/jpeg', size: 20 }, { type: 'text/plain', size: 10 }, { type: 'image/webp', size: 16 * 1024 * 1024 }];
    await scope.uploadFiles(files, target.id);
    assert.equal(items.length, 3);
    assert.equal(items[0], target);
    assert.equal(items[1].kind, 'image');
    assert.equal(items[1].caption, '');
    assert.equal(items[2], following);
    assert.deepEqual(uploads.map(entry => entry.id), items.slice(0, 2).map(item => item.id));
    assert.equal(notices.length, 1);
    assert.match(source, /type="file" multiple accept=/);
    assert.match(source, /uploadFiles\(files, b.id\)/);
    assert.match(source, /uploadFiles\(e.dataTransfer.files, card.dataset.block\)/);
    assert.match(source, /`Рисунок \$\{\+\+figure\}`/);
});
test('full report export retains A4, margins, underlined student fields and title-page footer', async () => {
    const elements = new Map(); let documentModel;
    const element = id => { if (!elements.has(id)) elements.set(id, { value: '', textContent: '', classList: { add() {}, remove() {} }, appendChild() {}, click() {}, remove() {} }); return elements.get(id); };
    const document = { readyState: 'loading', getElementById: element, addEventListener() {}, createElement: () => element('download'), body: { appendChild() {}, removeChild() {} } };
    const window = { ReportBlocks: b, docx: { ...docx, Packer: { toBlob: async model => { documentModel = model; return new Blob(); } } } };
    const instrumented = mainSource.replace('    if (document.readyState === "loading")', '    window.reportTest = { state, generateDocxDocument };\n    if (document.readyState === "loading")');
    vm.runInNewContext(instrumented, { window, document, console, setTimeout() {}, clearTimeout() {}, Blob, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} } });
    Object.assign(window.reportTest.state, { studentName: 'Test Student', studentGroup: 'GROUP', studentTeacher: 'TEACHER', discipline: 'ОПЕРАЦІЙНІ СИСТЕМИ', tasks: [b.create('step', { text: 'Відкрито Windows' })] });
    window.reportTest.state.cipher = 'ФКЗЕ. 121ООП06. 02ЛР';
    window.reportTest.state.conclusionText = 'ВИСНОВОК:\nОпрацьовано ОС.\nМету досягнуто частково.';
    await window.reportTest.generateDocxDocument();
    assert.ok(documentModel);
    const packed = await docx.Packer.toBuffer(documentModel), xml = zipEntry(packed, 'word/document.xml');
    assert.match(xml, /w:w="11906" w:h="16838"/);
    for (const [side, amount] of Object.entries({ top: 1134, bottom: 1134, left: 1418, right: 567 })) assert.match(xml, new RegExp(`w:${side}="${amount}"`));
    assert.match(xml, /<w:titlePg/);
    assert.match(xml, /<w:u w:val="single"/);
    assert.match(xml, /1\. Відкрито Windows/);
    assert.doesNotMatch(xml, /Код програми|Блок-схема/);
    assert.match(xml, /w:type="first"/);
    assert.doesNotMatch(xml, /Шифр роботи/);
    assert.match(xml, /ФКЗЕ\. 121ООП06\. 02ЛР/);
    const conclusionParagraph = xml.match(/<w:p\b[^>]*>(?:(?!<w:p\b)[\s\S])*?Висновок: (?:(?!<w:p\b)[\s\S])*?<\/w:p>/)?.[0];
    assert.ok(conclusionParagraph);
    assert.match(conclusionParagraph, /w:jc w:val="both"/);
    assert.match(conclusionParagraph, /Опрацьовано ОС\./);
    assert.match(xml, /Опрацьовано ОС\./);
    assert.match(xml, /Мету досягнуто частково\./);
    assert.doesNotMatch(xml, /ВИСНОВОК/);
    assert.doesNotMatch(mainSource, /Шифр роботи/);
});
test('builder assets exist and are included in production build in dependency order', async () => {
    const html = await readFile(new URL('../reports/index.html', import.meta.url), 'utf8');
    const blocksAsset = 'src="blocks.js?v=20260930-code-heading"';
    const scriptAsset = 'src="script.js?v=20260929-auto-conclusion"';
    assert.ok(html.includes(blocksAsset));
    assert.ok(html.includes(scriptAsset));
    assert.ok(html.indexOf(blocksAsset) < html.indexOf(scriptAsset));
    assert.match(html, /Додати блок/);
    const build = await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
    for (const asset of ['reports/blocks.js', 'reports/blocks.css', 'neumorphism.css']) {
        assert.ok(build.includes(`'${asset}'`));
        assert.ok((await readFile(new URL(`../${asset}`, import.meta.url))).length > 0);
    }
});
