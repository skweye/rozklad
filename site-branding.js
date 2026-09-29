/* Reuse the header's vector mark for a theme-aware browser tab icon. */
(() => {
    const mark = document.querySelector('.brand-mark');
    const glyph = mark?.querySelector('svg');
    const favicon = document.getElementById('siteFavicon');
    if (!glyph || !favicon) return;
    let lastPalette = '';

    function updateIcon() {
        const style = getComputedStyle(mark);
        const background = style.backgroundColor;
        // Preserve legibility when a custom accent is very dark or very light.
        const rgb = background.match(/^rgba?\(([^)]+)\)$/)?.[1].match(/[\d.]+/g);
        if (rgb && rgb.length >= 3) {
            const channels = rgb.slice(0, 3).map(value => {
                const channel = Number(value) / 255;
                return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
            });
            const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
            mark.style.color = luminance > .2 ? '#18201b' : '#ffffff';
        }
        const foreground = getComputedStyle(mark).color;
        const palette = background + foreground;
        if (palette === lastPalette) return;
        lastPalette = palette;
        const icon = glyph.cloneNode(true);
        icon.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        icon.setAttribute('width', '40');
        icon.setAttribute('height', '40');
        icon.setAttribute('fill', foreground);
        icon.removeAttribute('class');
        icon.removeAttribute('aria-hidden');
        const backdrop = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        backdrop.setAttribute('width', '40');
        backdrop.setAttribute('height', '40');
        backdrop.setAttribute('rx', '11');
        backdrop.setAttribute('fill', background);
        icon.prepend(backdrop);
        favicon.href = 'data:image/svg+xml,' + encodeURIComponent(new XMLSerializer().serializeToString(icon));
    }

    const observer = new MutationObserver(updateIcon);
    const attributes = { attributes: true, attributeFilter: ['class', 'style'] };
    observer.observe(document.body, attributes);
    observer.observe(document.documentElement, attributes);
    updateIcon();
})();
