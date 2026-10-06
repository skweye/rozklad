/* Local report library. IndexedDB transactions keep photos and report switches atomic. */
(function (root) {
    "use strict";
    const copy = value => JSON.parse(JSON.stringify(value));
    const titleFor = state => `${state.discipline?.trim() || "Новий звіт"} · ЛР №${state.labNumber || 1}`;

    function openRepository(indexedDB = root.indexedDB) {
        return new Promise((resolve, reject) => {
            if (!indexedDB) return reject(new Error("storage_unavailable"));
            const request = indexedDB.open("study-report-drafts", 1);
            let blocked = false;
            request.onupgradeneeded = () => {
                request.result.createObjectStore("drafts", { keyPath: "id" });
                request.result.createObjectStore("meta", { keyPath: "key" });
            };
            request.onerror = () => reject(request.error);
            request.onblocked = () => { blocked = true; reject(new Error("storage_blocked")); };
            request.onsuccess = () => {
                const db = request.result;
                if (blocked) { db.close(); return; }
                db.onversionchange = () => db.close();
                function read(action) {
                    return new Promise((done, fail) => {
                        const tx = db.transaction(["drafts", "meta"], "readonly");
                        let value;
                        action(tx, result => { value = result; });
                        tx.oncomplete = () => done(value);
                        tx.onabort = () => fail(tx.error || new Error("storage_unavailable"));
                    });
                }
                resolve({
                    active: () => read((tx, done) => {
                        const request = tx.objectStore("meta").get("active");
                        request.onsuccess = () => {
                            if (!request.result) return done(null);
                            const draft = tx.objectStore("drafts").get(request.result.id);
                            draft.onsuccess = () => done(draft.result || null);
                        };
                    }),
                    list: () => read((tx, done) => {
                        const request = tx.objectStore("drafts").getAll();
                        request.onsuccess = () => done(request.result);
                    }),
                    commit({ writes = [], activateId, loadId, removeId }) {
                        return new Promise((done, fail) => {
                            const tx = db.transaction(["drafts", "meta"], "readwrite");
                            const drafts = tx.objectStore("drafts");
                            let result, problem;
                            const abort = code => { problem = new Error(code); tx.abort(); };
                            for (const { record, expected } of writes) {
                                const request = drafts.get(record.id);
                                request.onsuccess = () => {
                                    if ((request.result?.revision || 0) !== expected) return abort("draft_conflict");
                                    drafts.put(record);
                                };
                            }
                            if (loadId) {
                                const request = drafts.get(loadId);
                                request.onsuccess = () => {
                                    if (!request.result) return abort("draft_missing");
                                    result = request.result;
                                };
                            }
                            if (removeId) {
                                const request = tx.objectStore("meta").get("active");
                                request.onsuccess = () => {
                                    if (request.result?.id === removeId) return abort("draft_active");
                                    drafts.delete(removeId);
                                };
                            }
                            if (activateId) tx.objectStore("meta").put({ key: "active", id: activateId });
                            tx.oncomplete = () => done(result);
                            tx.onabort = () => fail(problem || tx.error || new Error("storage_unavailable"));
                        });
                    }
                });
            };
        });
    }

    function createLibrary(repository, { id = () => root.crypto.randomUUID(), now = () => new Date().toISOString() } = {}) {
        let current = null, queue = Promise.resolve();
        function serial(action) {
            const next = queue.then(action);
            queue = next.catch(() => {});
            return next;
        }
        const recordFor = (state, previous, title) => ({
            id: previous?.id || id(), revision: (previous?.revision || 0) + 1,
            title: (title ?? previous?.title ?? "").trim().slice(0, 120),
            updatedAt: now(), state
        });
        return {
            current: () => current ? { id: current.id, title: current.title } : null,
            restore: () => serial(async () => { current = await repository.active(); return current ? copy(current.state) : null; }),
            list: () => serial(async () => (await repository.list()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))),
            save(state, title) {
                const snapshot = copy(state);
                return serial(async () => {
                    const next = recordFor(snapshot, current, title);
                    await repository.commit({ writes: [{ record: next, expected: current?.revision || 0 }], activateId: next.id });
                    current = next;
                    return copy(next);
                });
            },
            switchTo(targetId, state) {
                const snapshot = copy(state);
                return serial(async () => {
                    if (targetId === current?.id) return copy(snapshot);
                    const outgoing = recordFor(snapshot, current);
                    const target = await repository.commit({ writes: [{ record: outgoing, expected: current?.revision || 0 }], activateId: targetId, loadId: targetId });
                    current = target;
                    return copy(target.state);
                });
            },
            startNew(state, blank, title) {
                const snapshot = copy(state), nextState = copy(blank);
                return serial(async () => {
                    const outgoing = recordFor(snapshot, current, title), next = recordFor(nextState);
                    await repository.commit({ writes: [
                        { record: outgoing, expected: current?.revision || 0 }, { record: next, expected: 0 }
                    ], activateId: next.id });
                    current = next;
                    return copy(next.state);
                });
            },
            remove: targetId => serial(async () => {
                if (targetId === current?.id) throw new Error("draft_active");
                await repository.commit({ removeId: targetId });
            })
        };
    }
    root.ReportDraftStore = { openRepository, createLibrary, titleFor };
})(typeof window !== "undefined" ? window : globalThis);
