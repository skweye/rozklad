/* Non-modal, anchored confirmation for local report deletion. */
(function () {
    "use strict";
    let dismiss = null;
    function request({ anchor, skipConfirmation = false, title = "Видалити?", message = "Цю дію не можна скасувати.", confirmLabel = "Видалити" }) {
        dismiss?.(false, false);
        if (!anchor?.isConnected) return Promise.resolve(false);
        if (skipConfirmation) return Promise.resolve(true);
        return new Promise(resolve => {
            const panel = document.createElement("div");
            panel.className = "delete-confirm";
            panel.setAttribute("role", "dialog");
            panel.setAttribute("aria-modal", "false");
            panel.setAttribute("aria-labelledby", "deleteConfirmTitle");
            panel.setAttribute("aria-describedby", "deleteConfirmMessage");
            panel.setAttribute("popover", "manual");
            const heading = document.createElement("h3"); heading.id = "deleteConfirmTitle"; heading.textContent = title;
            const description = document.createElement("p"); description.id = "deleteConfirmMessage"; description.textContent = message;
            const hint = document.createElement("small"); hint.textContent = "Shift + натискання — без підтвердження";
            const actions = document.createElement("div"); actions.className = "delete-confirm-actions";
            const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "btn btn-sm"; cancel.textContent = "Скасувати";
            const accept = document.createElement("button"); accept.type = "button"; accept.className = "btn btn-sm delete-confirm-accept"; accept.textContent = confirmLabel;
            actions.append(cancel, accept); panel.append(heading, description, hint, actions);
            // A popover must belong to the active dialog to remain interactive there.
            (anchor.closest?.("dialog[open]") || document.body).append(panel);
            if (typeof panel.showPopover === "function") panel.showPopover();
            else panel.removeAttribute("popover");
            anchor.setAttribute("aria-expanded", "true");
            let settled = false, observer;
            const finish = (value, restoreFocus = true) => {
                if (settled) return;
                settled = true;
                document.removeEventListener("pointerdown", outside, true);
                document.removeEventListener("focusin", focusOutside);
                document.removeEventListener("keydown", keydown, true);
                window.removeEventListener("resize", position);
                document.removeEventListener("scroll", position, true);
                window.visualViewport?.removeEventListener("resize", position);
                window.visualViewport?.removeEventListener("scroll", position);
                observer?.disconnect();
                panel.remove(); anchor.removeAttribute("aria-expanded");
                if (dismiss === finish) dismiss = null;
                if (restoreFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
                resolve(value);
            };
            const position = () => {
                if (!anchor.isConnected) { finish(false, false); return; }
                const rect = anchor.getBoundingClientRect(), viewport = window.visualViewport;
                const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
                const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
                if (rect.bottom < top || rect.top > top + height || rect.right < left || rect.left > left + width) { finish(false, false); return; }
                panel.style.maxWidth = `${Math.max(0, width - 20)}px`;
                panel.style.maxHeight = `${Math.max(0, height - 20)}px`;
                const size = panel.getBoundingClientRect();
                const below = rect.bottom + 8;
                const y = below + size.height <= top + height - 10 ? below : rect.top - size.height - 8;
                panel.style.left = `${Math.max(left + 10, Math.min(rect.right - size.width, left + width - size.width - 10))}px`;
                panel.style.top = `${Math.max(top + 10, Math.min(y, top + height - size.height - 10))}px`;
            };
            const outside = event => { if (!panel.contains(event.target)) finish(false, false); };
            const focusOutside = event => { if (!panel.contains(event.target) && event.target !== anchor) finish(false, false); };
            const keydown = event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false); } };
            cancel.addEventListener("click", () => finish(false));
            accept.addEventListener("click", () => finish(anchor.isConnected));
            dismiss = finish;
            document.addEventListener("pointerdown", outside, true);
            document.addEventListener("focusin", focusOutside);
            document.addEventListener("keydown", keydown, true);
            window.addEventListener("resize", position);
            document.addEventListener("scroll", position, true);
            window.visualViewport?.addEventListener("resize", position);
            window.visualViewport?.addEventListener("scroll", position);
            if (typeof MutationObserver !== "undefined") {
                observer = new MutationObserver(() => { if (!anchor.isConnected) finish(false, false); });
                observer.observe(document.body, { childList: true, subtree: true });
            }
            position();
            if (!settled) cancel.focus({ preventScroll: true });
        });
    }
    window.ReportDeleteConfirm = { request };
})();
