// Lecture « en arrière-plan », sans fenêtre : l'extension interroge MMTE et le GUCE directement,
// comme le feraient leurs pages, avec les connexions de l'utilisateur. Lecture seule.
const MMTE = "https://mmte.benincontrol.com";
const GUCE = "https://guce.gouv.bj/emovement/gen/genHandlingUnit";
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
const parse = (html) => new DOMParser().parseFromString(html, "text/html");
const NC = { etat: "non_connecte" };
const KO = (m) => ({ etat: "page_indisponible", message: m });
async function get(url, opt) {
  try { return await fetch(url, { credentials: "include", redirect: "follow", ...(opt || {}) }); }
  catch (e) { return null; }
}

// ---------------- MMTE ----------------
let mmteCtx = null; // page de recherche chargée une fois (jeton et composant Livewire), renouvelée toutes les 15 min
async function mmteContext(force) {
  if (!force && mmteCtx && Date.now() - mmteCtx.at < 15 * 60000) return mmteCtx;
  mmteCtx = null;
  const r = await get(MMTE + "/roulant/chassis");
  if (!r) return KO("MMTE inaccessible (réseau).");
  if (!r.ok) return KO("MMTE a renvoyé l'erreur " + r.status + ".");
  if (!/\/roulant\/chassis/.test(r.url)) return NC;
  const doc = parse(await r.text());
  if (doc.querySelector("input[type=password]")) return NC;
  const csrf = (doc.querySelector("meta[name=csrf-token]") || {}).content;
  const comp = [...doc.querySelectorAll("[wire\\:initial-data]")].map((e) => { try { return JSON.parse(e.getAttribute("wire:initial-data")); } catch (x) { return null; } })
    .find((x) => x && x.fingerprint && x.fingerprint.name === "chassis-table");
  if (!csrf || !comp) return KO("Page de recherche MMTE non reconnue.");
  mmteCtx = { at: Date.now(), csrf, comp };
  return mmteCtx;
}
async function mmteSearch(ch, retried) {
  const ctx = await mmteContext(retried);
  if (ctx.etat) return ctx;
  const r = await get(MMTE + "/livewire/message/chassis-table", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/html, application/xhtml+xml", "X-CSRF-TOKEN": ctx.csrf, "X-Livewire": "true" },
    body: JSON.stringify({ fingerprint: ctx.comp.fingerprint, serverMemo: ctx.comp.serverMemo, updates: [{ type: "syncInput", payload: { id: Math.random().toString(36).slice(2, 6), name: "numeroAtp", value: ch } }] }),
  });
  if (!r) return KO("MMTE inaccessible (réseau).");
  if (!r.ok || !/json/.test(r.headers.get("content-type") || "")) {
    if (!retried) return mmteSearch(ch, true); // jeton expiré : on recharge la page de recherche une fois
    return r.status === 401 || r.status === 419 ? NC : KO("MMTE n'a pas répondu à la recherche (" + r.status + ").");
  }
  const j = await r.json();
  const d = parse((j.effects && j.effects.html) || "");
  const trs = [...d.querySelectorAll("table tr")];
  const headRow = trs.find((tr) => /CH[ÂA]SSIS/i.test(tr.textContent) && /MANIFESTE/i.test(tr.textContent));
  const hdr = headRow ? [...headRow.cells].map((c) => clean(c.textContent)) : [];
  const row = trs.filter((tr) => tr !== headRow && tr.cells.length > 3).find((tr) => [...tr.cells].some((c) => norm(c.textContent) === norm(ch)));
  if (!row) return { etat: "non_trouve" };
  const liste = {};
  [...row.cells].forEach((c, i) => {
    const k = hdr[i] || "";
    if (!k || /ACTIONS/i.test(k)) return;
    liste[k] = clean(c.textContent) || (c.querySelector("svg") ? "Oui" : "");
  });
  const f = row.querySelector("form");
  if (!f) return { etat: "trouve", liste, info: {}, historique: [], message: "Fiche détaillée non disponible." };
  const fd = new FormData();
  f.querySelectorAll("input").forEach((i) => i.name && fd.append(i.name, i.value));
  const s = await get(new URL(f.getAttribute("action"), MMTE).href, { method: "POST", body: fd });
  if (!s) return { etat: "page_indisponible", liste, message: "Fiche détaillée inaccessible." };
  if (!s.ok) return { etat: "erreur", liste, message: "MMTE a renvoyé l'erreur " + s.status + " sur la fiche." };
  return { etat: "trouve", liste, ...mmteFiche(parse(await s.text())) };
}
function mmteFiche(doc) {
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
  return { info, historique };
}

// ---------------- GUCE ----------------
let guceCtx = null; // champs du formulaire de recherche, relus toutes les 15 min
function formFields(f) {
  const out = [];
  f.querySelectorAll("input,select,textarea").forEach((e) => {
    if (!e.name || e.disabled) return;
    if ((e.type === "checkbox" || e.type === "radio") && !e.checked) return;
    if (e.type === "submit" || e.type === "button") { if (e.name === "search") out.push([e.name, e.value || ""]); return; }
    out.push([e.name, e.tagName === "SELECT" ? (e.selectedOptions[0] ? e.selectedOptions[0].value : "") : e.value]);
  });
  return out;
}
async function guceContext(force) {
  if (!force && guceCtx && Date.now() - guceCtx.at < 15 * 60000) return guceCtx;
  guceCtx = null;
  const r = await get(GUCE + "/list");
  if (!r) return KO("GUCE inaccessible (réseau).");
  if (!r.ok) return KO("Le GUCE a renvoyé l'erreur " + r.status + ".");
  if (!/genHandlingUnit/.test(r.url)) return NC;
  const doc = parse(await r.text());
  if (doc.querySelector("input[type=password]")) return NC;
  const f = [...doc.forms].find((x) => /genHandlingUnit\/search/.test(x.getAttribute("action") || ""));
  if (!f) return NC;
  guceCtx = { at: Date.now(), action: new URL(f.getAttribute("action"), GUCE + "/list").href, fields: formFields(f) };
  return guceCtx;
}
function guceFields(root) {
  const o = {};
  if (!root) return o;
  root.querySelectorAll(".form-group").forEach((g) => {
    const l = g.querySelector("label.control-label");
    if (!l) return;
    const k = clean(l.textContent);
    if (!k || k in o) return;
    const vals = [];
    g.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea").forEach((e) => {
      const v = e.tagName === "SELECT" ? clean((e.selectedOptions[0] || {}).textContent) : clean(e.value || e.getAttribute("value"));
      if (v && !vals.includes(v)) vals.push(v);
    });
    o[k] = vals.join(" — ");
  });
  return o;
}
async function guceSearch(ch, retried) {
  const ctx = await guceContext(retried);
  if (ctx.etat) return ctx;
  const fd = new FormData();
  ctx.fields.forEach(([k, v]) => fd.append(k, k === "handlingUnitReference" ? ch : k === "max" ? "50" : v));
  const r = await get(ctx.action, { method: "POST", body: fd });
  if (!r) return KO("GUCE inaccessible (réseau).");
  if (!r.ok) return retried ? { etat: "erreur", message: "Le GUCE a renvoyé l'erreur " + r.status + "." } : guceSearch(ch, true);
  if (!/genHandlingUnit/.test(r.url)) return retried ? NC : guceSearch(ch, true);
  const doc = parse(await r.text());
  if (doc.querySelector("input[type=password]")) return retried ? NC : guceSearch(ch, true);
  const t = [...doc.querySelectorAll("table")].find((x) => /Référence unité de manutention/i.test(x.textContent));
  if (!t) {
    const normal = [...doc.forms].some((x) => /genHandlingUnit\/search/.test(x.getAttribute("action") || ""));
    return normal ? { etat: "non_trouve" } : retried ? KO("Réponse inattendue du GUCE.") : guceSearch(ch, true);
  }
  const heads = [...t.querySelectorAll("thead th")].map((x) => clean(x.textContent));
  const rows = [...t.querySelectorAll("tbody tr")].filter((tr) => tr.cells.length > 3).map((tr) => {
    const o = {};
    [...tr.cells].forEach((c, i) => { if (heads[i]) o[heads[i]] = clean(c.textContent); });
    const a = tr.querySelector('a[href*="/show/"]');
    return { liste: o, lien: a ? new URL(a.getAttribute("href"), ctx.action).href : null };
  });
  const hits = rows.filter((x) => norm(x.liste["Référence unité de manutention"]) === norm(ch));
  if (!hits.length) return { etat: "non_trouve" };
  const unites = [];
  for (const hit of hits.slice(0, 5)) {
    const u = { liste: hit.liste, lien: hit.lien, entete: {}, unite: {}, historique: [] };
    if (hit.lien) {
      const s = await get(hit.lien);
      if (s && s.ok) {
        const d = parse(await s.text());
        u.entete = guceFields(d.getElementById("header"));
        u.unite = guceFields(d.getElementById("handlingUnit"));
        const body = d.getElementById("historyOperationsBody");
        const ht = d.querySelector("#history table") || (body && body.closest("table"));
        if (ht) {
          const hh = [...ht.querySelectorAll("thead th")].map((x) => clean(x.textContent));
          u.historique = [...ht.querySelectorAll("tbody tr")].filter((tr) => tr.cells.length > 3).map((tr) => {
            const o = {};
            [...tr.cells].forEach((c, i) => { if (hh[i]) o[hh[i]] = clean(c.textContent); });
            return { operation: o["Opération"] || "", type: o["Type"] || "", date: o["Date"] || "", heure: o["Heure"] || "" };
          });
        }
      } else u.message = s ? "Fiche GUCE : erreur " + s.status : "Fiche GUCE inaccessible.";
    }
    unites.push(u);
  }
  return { etat: "trouve", unites, plus: hits.length > 5 ? hits.length - 5 : 0 };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.target !== "offscreen") return; // les messages de l'application vont au service de l'extension
  (msg.site === "mmte" ? mmteSearch(msg.chassis) : guceSearch(msg.chassis))
    .then((r) => reply(r), (e) => reply({ etat: "erreur", message: String((e && e.message) || e).slice(0, 200) }));
  return true;
});
