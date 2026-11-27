// Bénin Control — Recherche MMTE et GUCE (lecture seule)
// L'application envoie un châssis ; l'extension le cherche dans MMTE et dans le GUCE avec les connexions
// de l'utilisateur — sans fenêtre (page offscreen, 1.1), ou à défaut dans une fenêtre de travail réduite —
// et renvoie la fiche et tout l'historique.
// Rien n'est jamais saisi ni validé sur les deux plateformes.

const SITES = {
  mmte: { url: "https://mmte.benincontrol.com/roulant/chassis", login: "https://mmte.benincontrol.com/" },
  guce: { url: "https://guce.gouv.bj/emovement/gen/genHandlingUnit/list", login: "https://guce.gouv.bj/emovement/gen/genHandlingUnit/list" },
};
const DELAI = 60000; // au-delà : « page indisponible »
let workWin = null;
const workTabs = {};
const queues = { mmte: Promise.resolve(), guce: Promise.resolve() };
let idleTimer = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms) => Promise.race([p, sleep(ms).then(() => ({ etat: "page_indisponible", message: "La plateforme ne répond pas." }))]);

async function waitComplete(tabId, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) return null;
    if (t.status === "complete") return t;
    await sleep(250);
  }
  return chrome.tabs.get(tabId).catch(() => null);
}

// Fenêtre de travail réduite, un onglet par plateforme, réutilisé d'une recherche à l'autre
async function workTab(k) {
  const site = SITES[k];
  let tab = workTabs[k] != null ? await chrome.tabs.get(workTabs[k]).catch(() => null) : null;
  if (!tab) {
    let win = workWin != null ? await chrome.windows.get(workWin).catch(() => null) : null;
    if (!win) {
      win = await chrome.windows.create({ url: site.url, focused: false, state: "minimized" });
      workWin = win.id;
      tab = win.tabs[0];
    } else {
      tab = await chrome.tabs.create({ windowId: workWin, url: site.url, active: false });
    }
    workTabs[k] = tab.id;
  } else if (!String(tab.url || tab.pendingUrl || "").startsWith(site.url)) {
    await chrome.tabs.update(tab.id, { url: site.url });
    await sleep(300);
  }
  tab = await waitComplete(tab.id);
  if (!tab) throw new Error("ONGLET_FERME");
  return tab;
}

function armIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(closeWork, 4 * 60000);
}
async function closeWork() {
  clearTimeout(idleTimer);
  if (workWin != null) await chrome.windows.remove(workWin).catch(() => {});
  workWin = null;
  delete workTabs.mmte;
  delete workTabs.guce;
}

// ---------------- MMTE (exécuté dans la page de recherche de châssis) ----------------
async function mmteInPage(ch) {
  const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  if (/login/i.test(location.pathname)) return { etat: "non_connecte" };
  const inp = [...document.querySelectorAll("input")].find((i) => /Rechercher/i.test(i.placeholder || ""));
  if (!inp || !document.querySelector("table")) return { etat: document.querySelector('input[type=password]') ? "non_connecte" : "page_indisponible", message: "Page de recherche introuvable." };
  const dataRows = () => [...document.querySelectorAll("table tbody tr")].filter((r) => r.cells.length > 3 && !/MANIFESTE/.test(r.cells[0].innerText));
  const sig = () => dataRows().map((r) => r.innerText).join("|");
  const exact = () => dataRows().find((r) => [...r.cells].some((c) => norm(c.innerText) === norm(ch)));
  // la recherche MMTE passe par Livewire : on attend la réponse du serveur (requête « livewire/message »)
  const lw = () => performance.getEntriesByType("resource").filter((e) => /livewire\/message/.test(e.name)).length;
  const typeAndWait = async (v) => {
    const n = lw();
    inp.value = v;
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      await pause(150);
      if (lw() > n) { await pause(300); return true; }
    }
    return false;
  };
  if (!exact()) {
    const answered = await typeAndWait(ch);
    if (!answered) return { etat: "page_indisponible", message: "MMTE n'a pas répondu à la recherche." };
  }
  const row = exact();
  if (!row) return { etat: "non_trouve" };
  const heads = [...document.querySelectorAll("table thead th, table tbody tr:first-child th")].map((h) => clean(h.innerText));
  const hdr = heads.length ? heads : [...(document.querySelector("table tr") || { cells: [] }).cells].map((c) => clean(c.innerText));
  const liste = {};
  [...row.cells].forEach((c, i) => {
    const k = hdr[i] || "";
    if (!k || /ACTIONS/i.test(k)) return;
    liste[k] = clean(c.innerText) || (c.querySelector("svg") ? "Oui" : "");
  });
  const f = row.querySelector("form");
  if (!f) return { etat: "trouve", liste, info: {}, historique: [], message: "Fiche détaillée non disponible." };
  let resp;
  try { resp = await fetch(f.action, { method: "POST", body: new FormData(f), credentials: "include" }); }
  catch (e) { return { etat: "page_indisponible", liste, message: "Fiche détaillée inaccessible." }; }
  if (!resp.ok) return { etat: "erreur", liste, message: "MMTE a renvoyé l'erreur " + resp.status + " sur la fiche." };
  const doc = new DOMParser().parseFromString(await resp.text(), "text/html");
  const info = {};
  const t = doc.querySelector("table");
  if (t) {
    const th = [...t.querySelectorAll("th")].map((x) => clean(x.textContent));
    const td = [...t.querySelectorAll("td")].map((x) => clean(x.textContent));
    th.forEach((k, i) => { if (k) info[k] = td[i] || ""; });
  }
  const historique = [];
  const h = [...doc.querySelectorAll("h3")].find((e) => /Historique/i.test(e.textContent));
  if (h) {
    const box = h.closest(".rounded-md") || doc.body;
    box.querySelectorAll("p.font-bold").forEach((p) => {
      const c = p.parentElement;
      let lines = [...c.querySelectorAll("p,li")].filter((x) => x !== p && !x.querySelector("p,li")).map((x) => clean(x.textContent)).filter(Boolean);
      if (!lines.length) lines = [clean(c.textContent.replace(p.textContent, ""))].filter(Boolean);
      lines = lines.flatMap((l) => l.split(/(?<=\.)\s+(?=[A-ZÉÈ])|(?<=\d{1,2}h\d{2}:\d{2})\s+(?=(?:La|Le|L'|Ce|Cette)\b)/)).map(clean).filter(Boolean);
      historique.push({ etape: clean(p.textContent), details: lines, existe: !lines.every((l) => /^Inexistant/i.test(l)) });
    });
  }
  if (!h && !t) return { etat: "erreur", liste, message: "Fiche MMTE illisible." };
  return { etat: "trouve", liste, info, historique };
}

// ---------------- GUCE (exécuté dans la page « Rechercher Unités de Manutention ») ----------------
async function guceInPage(ch) {
  const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const f = [...document.forms].find((x) => /genHandlingUnit\/search/.test(x.action));
  if (!f) return { etat: document.querySelector("input[type=password]") || !/genHandlingUnit/.test(location.pathname) ? "non_connecte" : "page_indisponible", message: "Formulaire de recherche introuvable." };
  const fd = new FormData(f);
  fd.set("handlingUnitReference", ch);
  fd.set("max", "50");
  let r;
  try { r = await fetch(f.action, { method: "POST", body: fd, credentials: "include" }); }
  catch (e) { return { etat: "page_indisponible", message: "GUCE inaccessible." }; }
  if (!r.ok) return { etat: "erreur", message: "Le GUCE a renvoyé l'erreur " + r.status + "." };
  if (!/genHandlingUnit/.test(r.url)) return { etat: "non_connecte" };
  const doc = new DOMParser().parseFromString(await r.text(), "text/html");
  if (doc.querySelector("input[type=password]")) return { etat: "non_connecte" };
  const t = [...doc.querySelectorAll("table")].find((x) => /Référence unité de manutention/i.test(x.textContent));
  if (!t) {
    const normal = [...doc.forms].some((x) => /genHandlingUnit\/search/.test(x.action));
    return normal ? { etat: "non_trouve" } : { etat: "page_indisponible", message: "Réponse inattendue du GUCE." };
  }
  const heads = [...t.querySelectorAll("thead th")].map((x) => clean(x.textContent));
  const rows = [...t.querySelectorAll("tbody tr")].filter((tr) => tr.cells.length > 3).map((tr) => {
    const o = {};
    [...tr.cells].forEach((c, i) => { if (heads[i]) o[heads[i]] = clean(c.textContent); });
    const a = tr.querySelector('a[href*="/show/"]');
    return { liste: o, lien: a ? a.href : null };
  });
  const hits = rows.filter((x) => norm(x.liste["Référence unité de manutention"]) === norm(ch));
  if (!hits.length) return { etat: "non_trouve" };
  const fields = (root) => {
    const o = {};
    if (!root) return o;
    root.querySelectorAll(".form-group").forEach((g) => {
      const l = g.querySelector("label.control-label");
      if (!l) return;
      const k = clean(l.textContent);
      if (!k || k in o) return;
      const vals = [];
      g.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea").forEach((e) => {
        const v = e.tagName === "SELECT" ? clean((e.selectedOptions[0] || {}).textContent) : clean(e.value);
        if (v && !vals.includes(v)) vals.push(v);
      });
      o[k] = vals.join(" — ");
    });
    return o;
  };
  const unites = [];
  for (const hit of hits.slice(0, 5)) {
    const u = { liste: hit.liste, lien: hit.lien, entete: {}, unite: {}, historique: [] };
    if (hit.lien) {
      try {
        const s = await fetch(hit.lien, { credentials: "include" });
        if (s.ok) {
          const d = new DOMParser().parseFromString(await s.text(), "text/html");
          u.entete = fields(d.getElementById("header"));
          u.unite = fields(d.getElementById("handlingUnit"));
          const ht = d.querySelector("#history table") || d.querySelector("#historyOperationsBody") && d.querySelector("#historyOperationsBody").closest("table");
          if (ht) {
            const hh = [...ht.querySelectorAll("thead th")].map((x) => clean(x.textContent));
            u.historique = [...ht.querySelectorAll("tbody tr")].filter((tr) => tr.cells.length > 3).map((tr) => {
              const o = {};
              [...tr.cells].forEach((c, i) => { if (hh[i]) o[hh[i]] = clean(c.textContent); });
              return { operation: o["Opération"] || "", type: o["Type"] || "", date: o["Date"] || "", heure: o["Heure"] || "" };
            });
          }
        } else u.message = "Fiche GUCE : erreur " + s.status;
      } catch (e) { u.message = "Fiche GUCE inaccessible."; }
    }
    unites.push(u);
  }
  return { etat: "trouve", unites, plus: hits.length > 5 ? hits.length - 5 : 0 };
}

// Mode par défaut (1.1) : lecture directe sans fenêtre, par la page « offscreen » de l'extension.
// Si la plateforme y paraît « non connectée », on vérifie une fois avec l'ancienne méthode (fenêtre réduite) ;
// si celle-ci voit l'utilisateur connecté, on la garde pour ce site jusqu'au prochain démarrage de Chrome.
const mode = { mmte: "direct", guce: "direct" };
const probed = { mmte: false, guce: false };
let offscreenReady = null;
async function ensureOffscreen() {
  if (offscreenReady) return offscreenReady;
  offscreenReady = (async () => {
    const ctxs = chrome.runtime.getContexts ? await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }) : [];
    if (!ctxs.length) await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["DOM_PARSER"], justification: "Lecture des pages MMTE et GUCE pour l'application Inventaire MMTE" });
  })().catch((e) => { offscreenReady = null; throw e; });
  return offscreenReady;
}
async function direct(k, ch) {
  await ensureOffscreen();
  const r = await withTimeout(chrome.runtime.sendMessage({ target: "offscreen", site: k, chassis: ch }), DELAI);
  return r || { etat: "erreur", message: "Aucune réponse." };
}
async function viaTab(k, ch) {
  try {
    const tab = await workTab(k);
    const host = new URL(SITES[k].url).host;
    if (!String(tab.url || "").includes(host)) return { etat: "non_connecte" };
    if (!String(tab.url || "").startsWith(SITES[k].url)) return { etat: "non_connecte" };
    const [res] = await withTimeout(chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: k === "mmte" ? mmteInPage : guceInPage, args: [ch] }), DELAI).then((x) => (Array.isArray(x) ? x : [{ result: x }]));
    return (res && res.result) || { etat: "erreur", message: "Aucune réponse de la page." };
  } catch (e) {
    const m = String((e && e.message) || e);
    if (/error page|ERR_|net::|ONGLET_FERME|No tab|Cannot access/i.test(m)) return { etat: "page_indisponible", message: "La plateforme est inaccessible (réseau coupé ou site en panne)." };
    return { etat: "erreur", message: m.slice(0, 200) };
  }
}
async function runOn(k, ch) {
  const job = queues[k].then(async () => {
    if (mode[k] === "tab") return viaTab(k, ch);
    let r;
    try { r = await direct(k, ch); } catch (e) { r = { etat: "erreur", message: String((e && e.message) || e).slice(0, 200) }; }
    if ((r.etat === "non_connecte" || (r.etat === "erreur" && /offscreen|Receiving end/i.test(r.message || ""))) && !probed[k]) {
      probed[k] = true;
      const t = await viaTab(k, ch);
      if (t.etat === "trouve" || t.etat === "non_trouve") mode[k] = "tab";
      return t;
    }
    return r;
  });
  queues[k] = job.catch(() => {});
  return job;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg && msg.target === "offscreen") return; // destiné à la page de lecture
  if (sender && sender.url && sender.url.startsWith(chrome.runtime.getURL(""))) return;
  (async () => {
    armIdle();
    const op = msg && msg.op;
    if (op === "ping") return { version: chrome.runtime.getManifest().version, mode };
    if (op === "search") {
      const ch = String((msg.args && msg.args.chassis) || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 40);
      if (ch.length < 4) throw new Error("CHASSIS_INVALIDE");
      const want = (msg.args && msg.args.sites) || ["mmte", "guce"];
      const [mmte, guce] = await Promise.all([want.includes("mmte") ? runOn("mmte", ch) : null, want.includes("guce") ? runOn("guce", ch) : null]);
      return { chassis: ch, mmte, guce, at: new Date().toISOString() };
    }
    if (op === "open") {
      const k = msg.args && msg.args.site;
      if (!SITES[k]) throw new Error("SITE_INCONNU");
      await chrome.tabs.create({ url: SITES[k].login, active: true });
      return { ok: true };
    }
    if (op === "close") { await closeWork(); return { ok: true }; }
    throw new Error("OPERATION_INCONNUE");
  })().then((data) => reply({ ok: true, data }), (e) => reply({ ok: false, error: String((e && e.message) || e) }));
  return true;
});

chrome.windows.onRemoved.addListener((id) => {
  if (id === workWin) { workWin = null; delete workTabs.mmte; delete workTabs.guce; }
});
