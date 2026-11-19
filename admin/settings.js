/* Sound preview for the administration page. */
(() => {
    'use strict';
    const test = document.getElementById('adminTestSound'), status = document.getElementById('adminSoundStatus');
    const sound = new Audio('/sound.mp3');
    test.addEventListener('click', async () => {
        if (test.disabled) return;
        test.disabled = true; status.textContent = '';
        try { sound.currentTime = 0; await sound.play(); }
        catch { status.textContent = 'Не вдалося відтворити звук. Перевірте дозвіл браузера та спробуйте ще раз.'; }
        finally { test.disabled = false; }
    });
    window.addEventListener('pagehide', () => sound.pause());
})();
