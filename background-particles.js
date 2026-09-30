/* Shared decorative background. No input interception or external dependencies. */
(() => {
    'use strict';
    if (document.querySelector('.background-particles')) return;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return;
    canvas.className = 'background-particles';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const coarsePointer = window.matchMedia('(pointer: coarse)');
    const lowPower = (navigator.hardwareConcurrency || 8) <= 4;
    const pointer = { x: 0, y: 0, clientX: 0, clientY: 0, active: false, strength: 0 };
    let width = 1;
    let height = 1;
    let particles = [];
    let color = '#e0e0e0';
    let frameId = 0;
    let lastTime = 0;
    let suspended = false;

    function updateColor() {
        color = getComputedStyle(canvas).color;
        draw();
    }

    function mapPointer(rect = canvas.getBoundingClientRect()) {
        if (!rect.width || !rect.height) return;
        // Pointer events use viewport CSS pixels; map them into the displayed canvas.
        // Do not multiply by devicePixelRatio: the drawing transform handles it.
        pointer.x = (pointer.clientX - rect.left) * width / rect.width;
        pointer.y = (pointer.clientY - rect.top) * height / rect.height;
    }

    function resize() {
        const rect = canvas.getBoundingClientRect();
        const previousWidth = width;
        const previousHeight = height;
        width = Math.max(1, rect.width);
        height = Math.max(1, rect.height);
        const ratio = Math.min(window.devicePixelRatio || 1, lowPower || coarsePointer.matches ? 1 : 1.5);
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        // Use the exact backing-store scale, including fractional CSS dimensions.
        context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
        const limit = coarsePointer.matches ? 22 : lowPower ? 32 : 64;
        const count = Math.min(limit, Math.max(14, Math.round(width * height / 24000)));
        // Keep existing particles in place when zooming or resizing the viewport.
        particles = particles.slice(0, count);
        for (const particle of particles) {
            particle.x *= width / previousWidth;
            particle.y *= height / previousHeight;
        }
        while (particles.length < count) particles.push({
            x: Math.random() * width,
            y: Math.random() * height,
            vx: (Math.random() - .5) * 12,
            vy: -(5 + Math.random() * 12),
            dx: 0,
            dy: 0,
            radius: .8 + Math.random() * 1.5,
            alpha: .2 + Math.random() * .3
        });
        mapPointer(rect);
        draw();
    }

    function draw() {
        context.clearRect(0, 0, width, height);
        context.fillStyle = color;
        context.strokeStyle = color;
        for (const particle of particles) {
            // Small translucent halos avoid expensive canvas shadow filters.
            context.globalAlpha = particle.alpha * .12;
            context.beginPath();
            context.arc(particle.x, particle.y, particle.radius * 3, 0, Math.PI * 2);
            context.fill();
            context.globalAlpha = particle.alpha;
            context.beginPath();
            context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
            context.fill();
            if (pointer.strength > .001 && !reducedMotion.matches) {
                const distance = Math.hypot(particle.x - pointer.x, particle.y - pointer.y);
                if (distance < 145) {
                    context.globalAlpha = (1 - distance / 145) ** 2 * .12 * pointer.strength;
                    context.lineWidth = .6;
                    context.beginPath();
                    context.moveTo(particle.x, particle.y);
                    context.lineTo(pointer.x, pointer.y);
                    context.stroke();
                }
            }
        }
        context.globalAlpha = 1;
    }

    function tick(time) {
        frameId = 0;
        if (document.hidden || suspended || reducedMotion.matches) return;
        // Render every display frame; elapsed time keeps speed consistent at 60/120Hz.
        const delta = Math.max(0, Math.min((time - lastTime) / 1000, .05));
        lastTime = time;
        pointer.strength += ((pointer.active ? 1 : 0) - pointer.strength) * (1 - Math.exp(-10 * delta));
        const decay = Math.exp(-4 * delta);
        const integral = (1 - decay) / 4;
        for (const particle of particles) {
            const x = particle.x - pointer.x;
            const y = particle.y - pointer.y;
            const distance = Math.hypot(x, y);
            let targetX = 0;
            let targetY = 0;
            if (pointer.strength > .001 && distance > .01 && distance < 145) {
                const falloff = (1 - distance / 145) ** 2;
                const speed = 55 * falloff * pointer.strength;
                targetX = x / distance * speed;
                targetY = y / distance * speed;
            }
            // Ease velocity rather than cursor position, so the reaction stays aligned.
            particle.x += particle.vx * delta + particle.dx * integral + targetX * (delta - integral);
            particle.y += particle.vy * delta + particle.dy * integral + targetY * (delta - integral);
            particle.dx = particle.dx * decay + targetX * (1 - decay);
            particle.dy = particle.dy * decay + targetY * (1 - decay);
            if (particle.x < -8) particle.x = width + 8;
            if (particle.x > width + 8) particle.x = -8;
            if (particle.y < -8) particle.y = height + 8;
            if (particle.y > height + 8) particle.y = -8;
        }
        draw();
        frameId = requestAnimationFrame(tick);
    }

    function syncMotion() {
        cancelAnimationFrame(frameId);
        frameId = 0;
        lastTime = performance.now();
        pointer.active = false;
        pointer.strength = 0;
        if (!document.hidden && !suspended) {
            draw();
            if (!reducedMotion.matches) frameId = requestAnimationFrame(tick);
        }
    }

    window.addEventListener('pointermove', event => {
        if (event.pointerType === 'touch' || reducedMotion.matches) return;
        pointer.clientX = event.clientX;
        pointer.clientY = event.clientY;
        mapPointer();
        pointer.active = true;
    }, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => { pointer.active = false; });
    window.addEventListener('blur', () => { pointer.active = false; });
    window.addEventListener('resize', resize, { passive: true });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(canvas);
    document.addEventListener('visibilitychange', syncMotion);
    window.addEventListener('pagehide', () => { suspended = true; syncMotion(); });
    window.addEventListener('pageshow', () => { suspended = false; syncMotion(); });
    reducedMotion.addEventListener('change', syncMotion);
    coarsePointer.addEventListener('change', resize);
    const themeObserver = new MutationObserver(updateColor);
    const themeAttributes = { attributes: true, attributeFilter: ['class', 'style'] };
    themeObserver.observe(document.body, themeAttributes);
    // Custom colour sliders update variables on <html> without changing the body class.
    themeObserver.observe(document.documentElement, themeAttributes);

    resize();
    updateColor();
    syncMotion();
})();
