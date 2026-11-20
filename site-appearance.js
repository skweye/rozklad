/* Apply the shared palette before the first paint. */
(() => {
    'use strict';
    const key = 'studyAppearanceV1';
    const themes = {
        light: {
            label: 'Світла', ground: '#f1f3ee', panel: '#fff', inset: '#f6f8f4', soft: '#edf2eb',
            text: '#142722', muted: '#526862', line: '#d6dfd6',
            accent: '#14614f', accentRgb: '20,97,79', onAccent: '#ffffff', danger: '#a22d36'
        },
        dark: {
            label: 'Темна', ground: '#101b18', panel: '#182923', inset: '#15221e', soft: '#233831',
            text: '#eef6ec', muted: '#b0c4bb', line: '#3a5048',
            accent: '#b7e6ac', accentRgb: '183,230,172', onAccent: '#132820', danger: '#ffb2b4'
        }
    };
    const legacyLight = new Set(['light', 'minimal', 'neumorphism', 'university', 'dualshot', 'graphite']);
    const legacyDark = new Set(['dark', 'deep-tech', 'neumorphism-dark', 'cyber', 'amoled', 'green', 'purple', 'sunset', 'glass', 'coffee', 'neon-blue', 'midnight', 'frosted-glass', 'custom']);
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
    const lowPower = (navigator.hardwareConcurrency || 8) <= 4;
    let settings = null;
    let temporaryTheme;
    let theme = load();

    function load() {
        if (temporaryTheme) return temporaryTheme;
        try {
            let stored;
            try { stored = JSON.parse(localStorage.getItem(key) || 'null'); }
            catch { /* Fall back to the old preference. */ }
            const cookie = document.cookie?.match(/(?:^|;\s*)theme=([^;]+)/)?.[1];
            const previous = stored?.theme || localStorage.getItem('theme') || cookie;
            if (legacyLight.has(previous)) return 'light';
            if (legacyDark.has(previous)) return 'dark';
        } catch { /* Storage may be unavailable. */ }
        return systemDark.matches ? 'dark' : 'light';
    }

    function prime(target) {
        if (!target) return;
        const palette = themes[theme];
        const light = theme === 'light';
        target.classList.toggle('theme-light', light);
        target.dataset.theme = theme;
        target.dataset.lowPower = String(lowPower);
        target.style.colorScheme = theme;
        const values = {
            '--ui-ground': palette.ground, '--ui-panel': palette.panel, '--ui-inset': palette.inset, '--ui-soft': palette.soft,
            '--ui-text': palette.text, '--ui-muted': palette.muted, '--ui-line': palette.line,
            '--ui-accent': palette.accent, '--ui-on-accent': palette.onAccent, '--ui-danger': palette.danger,
            '--ui-glass-edge': palette.line, '--ui-glass-edge-hover': palette.accent, '--ui-glass-rim': 'none',
            '--accent-rgb': palette.accentRgb, '--accent-color-rgb': palette.accentRgb,
            '--accent-color': palette.accent, '--sky-primary': palette.accent,
            '--bg-color': palette.ground, '--card-bg': palette.panel, '--bg-card': palette.panel, '--glass-bg-card': palette.panel,
            '--text-primary': palette.text, '--text-secondary': palette.muted, '--text-muted': palette.muted,
            '--border-color': palette.line
        };
        for (const [name, value] of Object.entries(values)) target.style.setProperty(name, value);
        if (target === document.documentElement) target.style.setProperty('background-color', palette.ground);
    }

    function apply() {
        prime(document.documentElement);
        prime(document.body);
        settings?.querySelectorAll('[data-theme-choice]').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme));
        });
    }

    function init() {
        settings = document.querySelector('[data-appearance-settings]');
        if (settings) {
            settings.innerHTML = `
                <fieldset class="appearance-section">
                    <legend>Оформлення</legend>
                    <div class="theme-picker">
                        ${Object.entries(themes).map(([id, palette]) => `
                            <button type="button" data-theme-choice="${id}" aria-pressed="false">
                                <span class="theme-swatch" aria-hidden="true"></span>${palette.label}
                            </button>`).join('')}
                    </div>
                </fieldset>
                <p class="appearance-notice" data-appearance-notice role="status"></p>`;
            settings.querySelectorAll('[data-theme-choice]').forEach(button => {
                button.addEventListener('click', () => {
                    theme = button.dataset.themeChoice;
                    const status = settings.querySelector('[data-appearance-notice]');
                    status.textContent = '';
                    try { localStorage.setItem(key, JSON.stringify({ theme })); }
                    catch {
                        temporaryTheme = theme;
                        status.textContent = 'Тема діятиме до оновлення сторінки.';
                    }
                    apply();
                });
            });
        }
        const restore = () => { theme = load(); apply(); };
        window.addEventListener('pageshow', restore);
        window.addEventListener('storage', event => { if (event.key === key || event.key === null) restore(); });
        systemDark.addEventListener('change', restore);
        apply();
    }

    window.studyAppearance = { prime, snapshot: () => ({ theme }) };
    prime(document.documentElement);
    if (document.body) init();
    else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
