/* One appearance model for the timetable and report editor. No remote assets. */
(() => {
    'use strict';
    const key = 'studyAppearanceV1';
    const themes = {
        neumorphism: { name: 'Neumorphism', ground: '#e6ebf2', panel: '230,235,242', shade: '#edf1f7', light: true },
        'neumorphism-dark': { name: 'Neumorphism Dark', ground: '#252b34', panel: '37,43,52', shade: '#303946' },
        cyber: { name: 'Cyber / Neon', ground: '#080d14', panel: '15,23,34', shade: '#12322e' },
        amoled: { name: 'AMOLED', ground: '#000000', panel: '0,0,0', shade: '#000000' },
        minimal: { name: 'Minimal', ground: '#f5f6f8', panel: '255,255,255', shade: '#e6eaf0', light: true },
        green: { name: 'Green', ground: '#0c1814', panel: '19,36,29', shade: '#254d39' },
        purple: { name: 'Purple', ground: '#171121', panel: '36,27,48', shade: '#4d326b' },
        sunset: { name: 'Sunset', ground: '#211519', panel: '49,30,33', shade: '#743f31' },
        university: { name: 'University', ground: '#f3f0e8', panel: '255,253,248', shade: '#ddd5c4', light: true },
        glass: { name: 'Матове скло', ground: '#17191b', panel: '42,45,48', shade: '#363b40' },
        coffee: { name: 'М’яка кава', ground: '#29221e', panel: '57,47,40', shade: '#524235', text: '#f2e8dd', muted: '#c4b4a5', line: 'rgba(218,190,163,.2)' }
    };
    const read = name => { try { return localStorage.getItem(name); } catch { return null; } };
    const cookie = name => { try { return decodeURIComponent(document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1] || ''); } catch { return ''; } };
    function normalize(value = {}) {
        return {
            theme: Object.hasOwn(themes, value.theme) ? value.theme : 'neumorphism',
            accent: /^#[0-9a-f]{6}$/i.test(value.accent) ? value.accent.toLowerCase() : '#657caf',
            background: ['wallpaper', 'gradient', 'solid'].includes(value.background) ? value.background : 'gradient',
            transparency: [10, 20, 30].includes(Number(value.transparency)) ? Number(value.transparency) : 20
        };
    }
    function load() {
        try { const stored = JSON.parse(read(key)); if (stored && typeof stored === 'object') return normalize(stored); } catch { /* Migrate older settings below. */ }
        const legacy = read('theme') || cookie('theme');
        return normalize({
            theme: ({ dark: 'cyber', light: 'minimal', 'neon-blue': 'cyber', midnight: 'purple', 'frosted-glass': 'glass', sunset: 'sunset', custom: 'cyber' })[legacy],
            accent: read('customAccentColor') || cookie('customAccentColor'),
            background: read('customBackground') ? 'wallpaper' : 'gradient'
        });
    }
    function parseWallpaper(raw) {
        try {
            const value = raw?.startsWith('data:') ? { type: 'image', dataUrl: raw } : JSON.parse(raw);
            const image = /^data:image\/(?:png|jpeg|webp|gif|avif|bmp);base64,[a-z0-9+/=\s]+$/i;
            const video = /^data:video\/(?:mp4|webm|quicktime);base64,[a-z0-9+/=\s]+$/i;
            if (value && ((value.type === 'image' && image.test(value.dataUrl)) || (value.type === 'video' && video.test(value.dataUrl)))) return value;
        } catch { /* Invalid or unsupported stored wallpaper must not become CSS. */ }
        return null;
    }
    const channels = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
    function luminance(hex) {
        const values = channels(hex).map(value => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
        return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
    }
    function readableAccent(accent, ground) {
        const background = luminance(ground), target = background > .5 ? 0 : 255;
        let color = accent;
        for (let amount = 0; amount <= 1; amount += .05) {
            const level = luminance(color);
            if ((Math.max(level, background) + .05) / (Math.min(level, background) + .05) >= 4.5) return color;
            color = '#' + channels(accent).map(value => Math.round(value + (target - value) * amount).toString(16).padStart(2, '0')).join('');
        }
        return target ? '#ffffff' : '#000000';
    }
    let state = load(), wallpaper = parseWallpaper(read('customBackground'));
    let mount = null, video = null;
    const quiet = window.matchMedia('(prefers-reduced-motion: reduce), (max-width: 768px), (pointer: coarse)');
    const lowPower = (navigator.hardwareConcurrency || 8) <= 4;
    let lastWallpaper, lastMode;
    function notice(message) { const el = mount?.querySelector('[data-appearance-notice]'); if (el) el.textContent = message; }
    function persist() {
        try { localStorage.setItem(key, JSON.stringify(state)); }
        catch { notice('Налаштування діятимуть до оновлення сторінки: браузер не дозволив збереження.'); }
    }
    function playback() {
        document.body.dataset.pageHidden = String(document.hidden);
        if (!video?.src) return;
        if (state.background !== 'wallpaper' || quiet.matches || lowPower || document.hidden) video.pause();
        else video.play().catch(() => {});
    }
    function backgroundValue() {
        if (state.background === 'wallpaper' && wallpaper?.type === 'image') {
            return `linear-gradient(var(--wallpaper-veil),var(--wallpaper-veil)),url("${wallpaper.dataUrl}") center / cover no-repeat ${quiet.matches || lowPower ? 'scroll' : 'fixed'}`;
        }
        return state.background === 'solid' ? 'var(--ui-ground)' : 'var(--appearance-gradient)';
    }
    function background() {
        if (lastWallpaper === wallpaper && lastMode === state.background) return;
        lastWallpaper = wallpaper; lastMode = state.background;
        if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
        document.body.classList.remove('has-custom-bg', 'has-custom-bg-video', 'reports-has-custom-bg', 'reports-has-custom-bg-video');
        const value = backgroundValue();
        if (state.background === 'wallpaper' && wallpaper?.type === 'video' && video && !quiet.matches && !lowPower) {
            video.src = wallpaper.dataUrl;
            playback();
        }
        document.body.style.setProperty('background', value, 'important');
        document.body.dataset.wallpaperVideo = String(state.background === 'wallpaper' && wallpaper?.type === 'video');
    }
    function paintTheme(body) {
        const theme = themes[state.theme], light = Boolean(theme.light);
        // Remove only old theme classes; never erase application state or layout classes.
        for (const name of [...body.classList]) if (name.startsWith('theme-')) body.classList.remove(name);
        body.classList.toggle('theme-light', light);
        body.dataset.theme = state.theme;
        body.dataset.background = state.background;
        body.dataset.transparency = String(state.transparency);
        body.dataset.lowPower = String(lowPower);
        const accent = readableAccent(state.accent, theme.ground), rgb = channels(accent).join(',');
        const panel = `rgba(${theme.panel},${1 - state.transparency / 100})`;
        const values = {
            '--ui-ground': theme.ground, '--ui-panel': panel, '--ui-inset': light ? 'rgba(255,255,255,.9)' : 'rgba(8,11,16,.8)',
            '--ui-text': light ? '#202835' : '#edf1f5', '--ui-muted': light ? '#586373' : '#adb7c5',
            '--ui-line': light ? 'rgba(20,30,45,.16)' : 'rgba(220,230,245,.16)',
            '--ui-soft': light ? 'rgba(20,30,45,.045)' : 'rgba(220,230,245,.045)',
            '--ui-glass-edge': light ? 'rgba(20,30,45,.18)' : 'rgba(230,240,255,.21)',
            '--ui-glass-edge-hover': light ? 'rgba(20,30,45,.32)' : 'rgba(230,240,255,.35)',
            '--ui-glass-rim': light ? 'inset 0 1px 0 rgba(255,255,255,.65)' : 'inset 0 1px 0 rgba(255,255,255,.05)',
            '--ui-accent': accent, '--accent-color': accent, '--accent-rgb': rgb, '--accent-color-rgb': rgb,
            '--sky-primary': accent, '--appearance-accent': state.accent, '--bg-color': theme.ground,
            '--card-bg': panel, '--bg-card': panel, '--glass-bg-card': panel,
            '--text-primary': light ? '#202835' : '#edf1f5', '--text-secondary': light ? '#586373' : '#adb7c5',
            '--text-muted': light ? '#586373' : '#adb7c5', '--border-color': light ? 'rgba(20,30,45,.16)' : 'rgba(220,230,245,.16)',
            '--appearance-gradient': `radial-gradient(ellipse at 0% 0%,${theme.shade},transparent 65%),${theme.ground}`,
            '--wallpaper-veil': light ? 'rgba(246,247,250,.38)' : 'rgba(5,8,14,.38)'
        };
        if (theme.text) Object.assign(values, {
            '--ui-text': theme.text, '--text-primary': theme.text,
            '--ui-muted': theme.muted, '--text-secondary': theme.muted, '--text-muted': theme.muted,
            '--ui-line': theme.line, '--border-color': theme.line, '--ui-glass-edge': theme.line,
            '--ui-inset': 'rgba(32,26,22,.85)', '--ui-soft': 'rgba(218,190,163,.065)'
        });
        for (const [name, value] of Object.entries(values)) body.style.setProperty(name, value);
        body.style.colorScheme = light ? 'light' : 'dark';
    }
    // Called in <head>, then immediately after <body>: CSS never sees an unthemed body.
    // Reuse exactly the same tokens as settings; no second palette or cached CSS to drift.
    function prime(target) {
        if (!target) return;
        paintTheme(target);
        target.style.setProperty('background', target === document.documentElement ? themes[state.theme].ground : backgroundValue(), 'important');
        target.dataset.wallpaperVideo = String(state.background === 'wallpaper' && wallpaper?.type === 'video');
    }
    function apply() {
        prime(document.documentElement);
        paintTheme(document.body);
        background();
        if (!mount) return;
        mount.querySelectorAll('[data-theme-choice]').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.themeChoice === state.theme));
            button.style.setProperty('--theme-preview-accent', readableAccent(state.accent, themes[button.dataset.themeChoice].ground));
        });
        mount.querySelectorAll('[data-transparency-choice]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.transparencyChoice) === state.transparency)));
        mount.querySelector('[name="accent"]').value = state.accent;
        mount.querySelector('[name="accentHex"]').value = state.accent.toUpperCase();
        mount.querySelector('[name="background"]').value = state.background;
        mount.querySelector('[data-wallpaper-controls]').hidden = state.background !== 'wallpaper';
        mount.querySelector('[data-remove-wallpaper]').hidden = !wallpaper;
        mount.querySelector('[data-wallpaper-hint]').textContent = wallpaper ? (wallpaper.name || 'Збережені шпалери') + (wallpaper.type === 'video' && (quiet.matches || lowPower) ? ' · Відео вимкнено для економії ресурсів; показується градієнт.' : '') : 'Оберіть зображення або відео до 8 МБ. Без файлу показується градієнт.';
    }
    function change(patch) { state = normalize({ ...state, ...patch }); notice(''); apply(); persist(); }
    function init() {
        mount = document.querySelector('[data-appearance-settings]');
        video = document.getElementById('bgVideo') || document.getElementById('reportsBgVideo');
        if (video) video.autoplay = false;
        if (mount) {
            mount.innerHTML = `
                <fieldset class="appearance-section"><legend>Тема оформлення</legend><div class="appearance-themes">
                    ${Object.entries(themes).map(([id, theme]) => `<button type="button" data-theme-choice="${id}" aria-pressed="false"><span class="appearance-theme-name">${theme.name}</span><span class="appearance-palette" aria-hidden="true" style="--theme-preview-ground:${theme.ground};--theme-preview-shade:${theme.shade};--theme-preview-text:${theme.light ? '#202835' : '#edf1f5'}"><span></span><span></span><span></span></span></button>`).join('')}
                </div></fieldset>
                <fieldset class="appearance-section"><legend>Акцентний колір</legend><div class="appearance-accent-row">
                    <input type="color" name="accent" aria-label="Обрати акцентний колір" value="#00ff88">
                    <input type="text" name="accentHex" aria-label="HEX акцентного кольору" value="#00FF88" maxlength="7" spellcheck="false" pattern="#[0-9a-fA-F]{6}">
                </div><p class="appearance-hint">Незалежний від теми. Відтінок тексту адаптується для читабельності.</p></fieldset>
                <label class="appearance-section"><span>Фон</span><select name="background"><option value="wallpaper">Шпалери</option><option value="gradient">Градієнт</option><option value="solid">Однотонний</option></select></label>
                <div data-wallpaper-controls hidden><p class="appearance-hint" data-wallpaper-hint></p><div class="appearance-wallpaper-actions"><button type="button" data-upload-wallpaper>Завантажити</button><button type="button" data-remove-wallpaper hidden>Видалити</button></div><input type="file" name="wallpaper" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime" hidden></div>
                <fieldset class="appearance-section"><legend>Прозорість карток</legend><div class="appearance-transparency">${[10, 20, 30].map(value => `<button type="button" data-transparency-choice="${value}" aria-pressed="false">${value}%</button>`).join('')}</div><p class="appearance-hint">Більше значення — краще видно фон.</p></fieldset>
                <p class="appearance-notice" data-appearance-notice role="status" aria-live="polite"></p>`;
            mount.querySelectorAll('[data-theme-choice]').forEach(button => button.addEventListener('click', () => change({
                theme: button.dataset.themeChoice,
                ...(button.dataset.themeChoice === 'coffee' && state.accent === '#657caf' ? { accent: '#cda985' } : {})
            })));
            mount.querySelectorAll('[data-transparency-choice]').forEach(button => button.addEventListener('click', () => change({ transparency: Number(button.dataset.transparencyChoice) })));
            mount.querySelector('[name="accent"]').addEventListener('input', event => change({ accent: event.target.value }));
            mount.querySelector('[name="accentHex"]').addEventListener('change', event => {
                const value = event.target.value.trim();
                if (/^#[0-9a-f]{6}$/i.test(value)) change({ accent: value });
                else { event.target.value = state.accent.toUpperCase(); notice('Введіть HEX-код у форматі #00FF88.'); }
            });
            mount.querySelector('[name="background"]').addEventListener('change', event => change({ background: event.target.value }));
            const fileInput = mount.querySelector('[name="wallpaper"]');
            mount.querySelector('[data-upload-wallpaper]').addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', () => {
                const file = fileInput.files[0]; if (!file) return;
                if (file.size > 8 * 1024 * 1024) { notice('Оберіть файл до 8 МБ.'); fileInput.value = ''; return; }
                const reader = new FileReader();
                reader.onload = () => {
                    const raw = JSON.stringify({ type: file.type.startsWith('video/') ? 'video' : 'image', dataUrl: reader.result, name: file.name });
                    const parsed = parseWallpaper(raw);
                    if (!parsed) { notice('Непідтримуваний формат шпалер. Оберіть PNG, JPEG, WebP, GIF, AVIF, MP4 або WebM.'); return; }
                    wallpaper = parsed; change({ background: 'wallpaper' });
                    try { localStorage.setItem('customBackground', raw); }
                    catch { notice('Файл завеликий для сховища. Шпалери діятимуть до оновлення сторінки.'); }
                };
                reader.onerror = () => notice('Не вдалося прочитати файл.');
                reader.readAsDataURL(file); fileInput.value = '';
            });
            mount.querySelector('[data-remove-wallpaper]').addEventListener('click', () => {
                try { localStorage.removeItem('customBackground'); } catch { notice('Не вдалося видалити збережені шпалери.'); return; }
                wallpaper = null; change({ background: 'gradient' });
            });
        }
        window.addEventListener('storage', event => {
            if ([key, 'customBackground', null].includes(event.key)) { state = load(); wallpaper = parseWallpaper(read('customBackground')); apply(); }
        });
        document.addEventListener('visibilitychange', playback);
        quiet.addEventListener('change', () => { lastMode = undefined; apply(); playback(); });
        window.addEventListener('pagehide', () => video?.pause());
        window.addEventListener('pageshow', () => {
            state = load(); wallpaper = parseWallpaper(read('customBackground'));
            apply(); playback();
        });
        apply();
    }
    window.studyAppearance = { snapshot: () => ({ ...state }), normalize, readableAccent, prime };
    prime(document.documentElement);
    if (document.body) init();
    else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
