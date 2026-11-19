/* The two glass palettes are shared and applied before the first paint. */
(() => {
    'use strict';
    const key = 'studyAppearanceV1';
    const themes = {
        light: {
            label: 'Світла', ground: '#eef3fc', surface: '255,255,255', text: '#182237',
            muted: '#495873', accent: '#0759c7', onAccent: '#ffffff',
            blue: '#c5dcff', violet: '#e6d9fa', aqua: '#d5f1ef', danger: '#a62f48'
        },
        dark: {
            label: 'Темна', ground: '#111726', surface: '32,42,63', text: '#f0f4ff',
            muted: '#b7c3da', accent: '#a9cbff', onAccent: '#102545',
            blue: '#1e365a', violet: '#322345', aqua: '#16383f', danger: '#ff9eac'
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
        const line = light ? '#53698638' : '#acc7fa35';
        const panel = `rgba(${palette.surface},.78)`;
        const inset = light ? '#f6f9ffd9' : '#131b2cba';
        const soft = light ? '#284a8010' : '#d1e0ff12';
        target.classList.toggle('theme-light', light);
        target.dataset.theme = theme;
        target.dataset.lowPower = String(lowPower);
        target.style.colorScheme = theme;
        const values = {
            '--ui-ground': palette.ground, '--ui-panel': panel, '--ui-inset': inset, '--ui-soft': soft,
            '--ui-text': palette.text, '--ui-muted': palette.muted, '--ui-line': line,
            '--ui-accent': palette.accent, '--ui-on-accent': palette.onAccent, '--ui-danger': palette.danger,
            '--ui-glass-edge': line, '--ui-glass-edge-hover': palette.accent,
            '--ui-glass-rim': light ? 'inset 0 1px #fffc' : 'inset 0 1px #ffffff24',
            '--glass-rgb': palette.surface, '--glass-blue': palette.blue, '--glass-violet': palette.violet,
            '--glass-aqua': palette.aqua, '--accent-rgb': light ? '7,89,199' : '169,203,255',
            '--accent-color-rgb': light ? '7,89,199' : '169,203,255',
            '--accent-color': palette.accent, '--sky-primary': palette.accent,
            '--bg-color': palette.ground, '--card-bg': panel, '--bg-card': panel, '--glass-bg-card': panel,
            '--text-primary': palette.text, '--text-secondary': palette.muted, '--text-muted': palette.muted,
            '--border-color': line
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
                    <div class="glass-theme-picker">
                        ${Object.entries(themes).map(([id, palette]) => `
                            <button type="button" data-theme-choice="${id}" aria-pressed="false">
                                <span class="glass-theme-swatch" aria-hidden="true"></span>${palette.label}
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
