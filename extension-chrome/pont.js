// Pont entre l'application Inventaire MMTE et l'extension (messages de la page uniquement)
(() => {
  const V = chrome.runtime.getManifest().version;
  document.documentElement.setAttribute("data-bc-recherche", V);
  const OPS = new Set(["ping", "search", "open", "close", "retry_direct"]);
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.bcr !== "req" || !OPS.has(e.data.op)) return;
    const { id, op, args } = e.data;
    try {
      chrome.runtime.sendMessage({ op, args }, (res) => {
        const err = chrome.runtime.lastError;
        window.postMessage({ bcr: "res", id, ok: !err && !!res && res.ok, data: res && res.data, error: err ? err.message : res && res.error }, "*");
      });
    } catch (x) {
      window.postMessage({ bcr: "res", id, ok: false, error: "EXTENSION_RECHARGEE" }, "*");
    }
  });
  window.postMessage({ bcr: "ready", version: V }, "*");
})();
