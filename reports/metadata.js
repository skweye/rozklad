/* Report metadata only: one subject and variant feed the editor, preview and export. */
(function (root) {
    'use strict';
    const subjects = [
        ['АСД', 'Алгоритми та структури даних'],
        ['ОС', 'Операційні системи'],
        ['БД', 'Бази даних'],
        ['ПМА', 'Програмування мікроконтролерів сімейства Arduino'],
        ['ООП', "Об'єктно-орієнтоване програмування"]
    ];
    const normalize = value => String(value || '').toLowerCase().replace(/[’ʼ`]/g, "'").replace(/\s+/g, ' ').trim();
    const subjectFor = value => subjects.find(([code, name]) => normalize(value) === normalize(name) || normalize(value) === normalize(code));
    function number(value) {
        const text = String(value ?? '').trim();
        return /^\d{1,2}$/.test(text) && Number(text) >= 1 && Number(text) <= 99 ? String(Number(text)).padStart(2, '0') : '';
    }
    function cipher(code, variant, lab) {
        return subjects.some(item => item[0] === code) && number(variant) && number(lab)
            ? `ФКЗЕ.121${code}${number(variant)}.${number(lab)}ЛР` : '';
    }
    function restore(state) {
        const match = String(state.cipher || '').replace(/\s/g, '').match(/^ФКЗЕ\.121(?:АСД|ОС|БД|ПМА|ООП)(\d{2})\.\d{2}ЛР$/i);
        state.variant = number(state.variant) || (match ? number(match[1]) : '');
        state.cipherMode = state.cipherMode === 'auto' || !state.cipher ? 'auto' : 'preserved';
        if (state.cipherMode === 'auto') state.cipher = cipher(subjectFor(state.discipline)?.[0], state.variant, state.labNumber);
    }
    function mount(state, dom, onChange) {
        const option = (value, label) => {
            const node = root.document.createElement('option'); node.value = value; node.textContent = label; return node;
        };
        function render() {
            const subject = subjectFor(state.discipline);
            dom.disciplineInput.replaceChildren(option('', 'Оберіть дисципліну'), ...subjects.map(([, name]) => option(name, name)));
            if (state.discipline && !subject) dom.disciplineInput.append(option(state.discipline, state.discipline));
            dom.disciplineInput.value = subject?.[1] || state.discipline;
            dom.variantInput.value = state.variant;
            dom.cipherInput.replaceChildren(option('', 'Оберіть шифр'), ...subjects.map(([code]) => option(code,
                `ФКЗЕ.121${code}${number(state.variant) || '__'}.${number(state.labNumber) || '__'}ЛР`)));
            if (state.cipherMode === 'preserved' && state.cipher) dom.cipherInput.append(option('preserved', `Збережений: ${state.cipher}`));
            dom.cipherInput.value = state.cipherMode === 'preserved' ? 'preserved' : subject?.[0] || '';
        }
        function update() {
            if (state.cipherMode === 'auto') state.cipher = cipher(subjectFor(state.discipline)?.[0], state.variant, state.labNumber);
            render();
        }
        dom.disciplineInput.addEventListener('change', () => {
            state.discipline = dom.disciplineInput.value; state.cipherMode = 'auto'; update(); onChange();
        });
        dom.cipherInput.addEventListener('change', () => {
            const subject = subjects.find(([code]) => code === dom.cipherInput.value);
            if (!subject) return;
            state.discipline = subject[1]; state.cipherMode = 'auto'; update(); onChange();
        });
        dom.variantInput.addEventListener('input', () => {
            state.variant = dom.variantInput.value;
            // Keep the caret and incomplete numeric input intact while updating the dependent fields.
            const value = dom.variantInput.value;
            update(); dom.variantInput.value = value; onChange();
        });
        return { update, restore() { restore(state); render(); } };
    }
    root.ReportMetadata = { subjects, subjectFor, number, cipher, restore, mount };
})(typeof window !== 'undefined' ? window : globalThis);
